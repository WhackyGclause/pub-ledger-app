// server.js — backend API + static frontend/PWA host for the Pub Ledger app.
// Data layer: Supabase Postgres (see db.js / supabaseClient.js).

const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = ['Liquor', 'Tobacco Snuff', 'Khat', 'Soft Drinks'];

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
  if (!name || buyingPrice == null || sellingPrice == null) {
    return res.status(400).json({ error: 'name, buyingPrice and sellingPrice are required' });
  }
  const item = await db.createItem({ name, category, buyingPrice, sellingPrice });
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
  res.json(await db.getDay(req.params.date));
}));

app.put('/api/days/:date', asyncRoute(async (req, res) => {
  res.json(await db.saveDay(req.params.date, req.body));
}));

app.get('/api/days', asyncRoute(async (req, res) => {
  const [dates, items] = await Promise.all([db.listAllDayDates(), db.listItems()]);
  const summaries = [];
  for (const date of dates) {
    const day = await db.getDay(date);
    summaries.push(computeSummary(day, items));
  }
  res.json(summaries);
}));

// ---------------------------------------------------------------------
// BALANCE SHEET — cumulative totals across every recorded day.
// ---------------------------------------------------------------------

app.get('/api/balance-sheet', asyncRoute(async (req, res) => {
  const [dates, items] = await Promise.all([db.listAllDayDates(), db.listItems()]);
  let cum = 0, totalRevenue = 0, totalCost = 0, lossDays = 0;
  const points = [];
  for (const date of dates) {
    const day = await db.getDay(date);
    const s = computeSummary(day, items);
    cum += s.netProfit;
    totalRevenue += s.totalRevenue;
    totalCost += s.totalCost;
    if (s.netProfit < 0) lossDays++;
    points.push({ date, cum, netProfit: s.netProfit });
  }
  res.json({
    points,
    totalRevenue,
    totalCost,
    cumulativeProfit: cum,
    lossDays,
    daysRecorded: dates.length
  });
}));

function computeSummary(day, items) {
  let totalRevenue = 0, totalCost = 0;
  items.forEach(it => {
    const e = day.stock[it.id] || { opening: 0, added: 0, closing: 0 };
    const sold = (Number(e.opening) || 0) + (Number(e.added) || 0) - (Number(e.closing) || 0);
    totalRevenue += sold * it.sellingPrice;
    totalCost += sold * it.buyingPrice;
  });
  const netProfit = totalRevenue - totalCost;
  const cash = day.cash || {};
  const actualInflow =
    ((Number(cash.closingCash) || 0) - (Number(cash.openingCash) || 0)) +
    ((Number(cash.closingMomo) || 0) - (Number(cash.openingMomo) || 0));
  const discrepancy = actualInflow - totalRevenue;
  const totalBalance = (Number(cash.closingCash) || 0) + (Number(cash.closingMomo) || 0);
  const totalHours = (day.shifts || []).reduce((s, p) => s + (Number(p.hours) || 0), 0);
  return {
    date: day.date,
    totalRevenue,
    totalCost,
    netProfit,
    actualInflow,
    discrepancy,
    totalBalance,
    totalHours,
    staffCount: (day.shifts || []).length
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pub Ledger running at http://localhost:${PORT}`));
