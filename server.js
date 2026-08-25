// server.js — backend API + static frontend/PWA host for the Pub Ledger app.
// Data layer: Supabase Postgres (see db.js / supabaseClient.js).

const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = ['Liquor', 'Tobacco Snuff', 'Khat', 'Soft Drinks', 'Cigarettes', 'Nuts'];
const SELLING_PRICE_ONLY_CATEGORIES = new Set(['Tobacco Snuff', 'Khat']);

function isNonNegativeNumber(value) {
  return value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function firstInvalidStockField(stock) {
  for (const [itemId, entry] of Object.entries(stock)) {
    if (!entry) return `${itemId}: missing stock entry`;
    for (const field of ['opening', 'added', 'closing']) {
      if (!isNonNegativeNumber(entry[field])) return `${itemId}: ${field} must be a non-negative number`;
    }
  }
  return null;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// Small helper so we don't repeat try/catch in every route.
function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  });
}

// ---------------------------------------------------------------------
// ITEMS  — each item has a FIXED buying price and selling price,
// set once here and reused automatically on every day sheet.
// ---------------------------------------------------------------------

app.get('/api/items', asyncRoute(async (req, res) => {
  res.json(await db.listItems());
}));

app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

app.post('/api/items', asyncRoute(async (req, res) => {
  const { name, category, buyingPrice, sellingPrice } = req.body;
  const buyingPriceValid = SELLING_PRICE_ONLY_CATEGORIES.has(category)
    ? (buyingPrice == null || buyingPrice === '' || isNonNegativeNumber(buyingPrice))
    : isNonNegativeNumber(buyingPrice);
  if (!String(name || '').trim() || !buyingPriceValid || !isNonNegativeNumber(sellingPrice)) {
    const priceMessage = SELLING_PRICE_ONLY_CATEGORIES.has(category)
      ? 'Enter a name and non-negative selling price'
      : 'Enter a name and non-negative buying and selling prices';
    return res.status(400).json({ error: priceMessage });
  }
  const item = await db.createItem({ name, category, buyingPrice: buyingPrice || 0, sellingPrice });
  res.status(201).json(item);
}));

app.put('/api/items/:id', asyncRoute(async (req, res) => {
  const item = await db.updateItem(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'item not found' });
  res.json(item);
}));

app.delete('/api/items/:id', asyncRoute(async (req, res) => {
  await db.deleteItem(req.params.id);
  res.status(204).end();
}));

// ---------------------------------------------------------------------
// DAYS — one record per trading day: staff shifts, stock movement, cash.
// ---------------------------------------------------------------------

app.get('/api/days/:date', asyncRoute(async (req, res) => {
  if (!isDate(req.params.date)) return res.status(400).json({ error: 'Invalid date; use YYYY-MM-DD' });
  res.json(await db.getDay(req.params.date));
}));

app.put('/api/days/:date', asyncRoute(async (req, res) => {
  if (!isDate(req.params.date)) return res.status(400).json({ error: 'Invalid date; use YYYY-MM-DD' });
  const payload = req.body || {};
  const cashValues = Object.values(payload.cash || {});
  const invalidStockField = firstInvalidStockField(payload.stock || {});
  if (invalidStockField) {
    return res.status(400).json({ error: `Stock quantity error (${invalidStockField})` });
  }
  if (cashValues.some(value => !isNonNegativeNumber(value))) {
    return res.status(400).json({ error: 'Cash values must be non-negative numbers' });
  }
  res.json(await db.saveDay(req.params.date, req.body));
}));

app.get('/api/days', asyncRoute(async (req, res) => {
  const [dates, items, debtDayMap] = await Promise.all([db.listAllDayDates(), db.listItems(), db.getDebtDayMap()]);
  const summaries = [];
  for (const date of dates) {
    const day = await db.getDay(date);
    summaries.push(computeSummary(day, items, debtDayMap[date]));
  }
  res.json(summaries);
}));

// ---------------------------------------------------------------------
// DEBTS — customer credit ("on the tab").
// ---------------------------------------------------------------------

app.get('/api/debts', asyncRoute(async (req, res) => {
  res.json(await db.listDebts());
}));

app.post('/api/debts', asyncRoute(async (req, res) => {
  const { customerName, dateIncurred, originalAmount, notes } = req.body;
  if (!customerName || !dateIncurred || originalAmount == null) {
    return res.status(400).json({ error: 'customerName, dateIncurred and originalAmount are required' });
  }
  const debt = await db.createDebt({ customerName, dateIncurred, originalAmount, notes });
  res.status(201).json(debt);
}));

app.post('/api/debts/:id/payments', asyncRoute(async (req, res) => {
  const { datePaid, amount } = req.body;
  if (!datePaid || amount == null) {
    return res.status(400).json({ error: 'datePaid and amount are required' });
  }
  await db.addDebtPayment(req.params.id, { datePaid, amount });
  res.status(201).json({ ok: true });
}));

app.delete('/api/debts/:id', asyncRoute(async (req, res) => {
  await db.deleteDebt(req.params.id);
  res.status(204).end();
}));

// Lightweight per-day figure the Day Sheet needs for its reconciliation math.
app.get('/api/debts/day-summary/:date', asyncRoute(async (req, res) => {
  const debtDayMap = await db.getDebtDayMap();
  res.json(debtDayMap[req.params.date] || { newCredit: 0, repayments: 0 });
}));

// ---------------------------------------------------------------------
// BALANCE SHEET — cumulative totals across every recorded day.
// ---------------------------------------------------------------------

app.get('/api/balance-sheet', asyncRoute(async (req, res) => {
  const [dates, items, debtDayMap] = await Promise.all([db.listAllDayDates(), db.listItems(), db.getDebtDayMap()]);
  let cum = 0, totalRevenue = 0, totalCost = 0, totalExpenses = 0, lossDays = 0;
  const points = [];
  for (const date of dates) {
    const day = await db.getDay(date);
    const s = computeSummary(day, items, debtDayMap[date]);
    cum += s.netProfit;
    totalRevenue += s.totalRevenue;
    totalCost += s.totalCost;
    totalExpenses += s.totalExpenses;
    if (s.netProfit < 0) lossDays++;
    points.push({ date, cum, netProfit: s.netProfit });
  }
  res.json({
    points,
    totalRevenue,
    totalCost,
    totalExpenses,
    cumulativeProfit: cum,
    lossDays,
    daysRecorded: dates.length
  });
}));

function computeSummary(day, items, debtDay) {
  debtDay = debtDay || { newCredit: 0, repayments: 0 };
  let totalRevenue = 0, totalCost = 0;
  items.forEach(it => {
    const e = day.stock[it.id] || { opening: 0, added: 0, closing: 0 };
    const sold = (Number(e.opening) || 0) + (Number(e.added) || 0) - (Number(e.closing) || 0);
    totalRevenue += sold * it.sellingPrice;
    totalCost += sold * it.buyingPrice;
  });
  const totalExpenses = (day.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netProfit = totalRevenue - totalCost - totalExpenses;

  const cash = day.cash || {};
  const actualInflow =
    ((Number(cash.closingCash) || 0) - (Number(cash.openingCash) || 0)) +
    (Number(cash.mpesaCashIn) || 0);

  // Expected till movement: what should have come in, given today's stock
  // sales, minus new credit sales (no cash received yet), plus any debt
  // repayments collected today (cash in, unrelated to today's stock), minus
  // expenses paid out of the till today.
  const newCredit = Number(debtDay.newCredit) || 0;
  const repayments = Number(debtDay.repayments) || 0;
  const expectedInflow = totalRevenue - newCredit + repayments - totalExpenses;
  const discrepancy = actualInflow - expectedInflow;

  const totalBalance = Number(cash.closingCash) || 0;
  const totalHours = (day.shifts || []).reduce((s, p) => s + (Number(p.hours) || 0), 0);
  return {
    date: day.date,
    totalRevenue,
    totalCost,
    totalExpenses,
    netProfit,
    newCredit,
    repayments,
    expectedInflow,
    actualInflow,
    discrepancy,
    totalBalance,
    totalHours,
    staffCount: (day.shifts || []).length
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pub Ledger running at http://localhost:${PORT}`));
