// db.js — data access layer backed by Supabase Postgres.
// Every function here returns data shaped exactly the same way regardless
// of storage, so server.js and the frontend don't need to know the
// storage details underneath.

const supabase = require('./supabaseClient');

function mapItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    buyingPrice: Number(row.buying_price),
    sellingPrice: Number(row.selling_price)
  };
}

// ---------------------------------------------------------------------
// ITEMS
// ---------------------------------------------------------------------

async function listItems() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(mapItem);
}

async function createItem({ name, category, buyingPrice, sellingPrice }) {
  const { data, error } = await supabase
    .from('items')
    .insert({
      name,
      category: category || 'Liquor',
      buying_price: Number(buyingPrice),
      selling_price: Number(sellingPrice)
    })
    .select()
    .single();
  if (error) throw error;
  return mapItem(data);
}

async function updateItem(id, fields) {
  const patch = {};
  if (fields.name != null) patch.name = fields.name;
  if (fields.category != null) patch.category = fields.category;
  if (fields.buyingPrice != null) patch.buying_price = Number(fields.buyingPrice);
  if (fields.sellingPrice != null) patch.selling_price = Number(fields.sellingPrice);

  const { data, error } = await supabase
    .from('items')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapItem(data);
}

async function deleteItem(id) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// DAYS
// ---------------------------------------------------------------------

function blankDay(date) {
  return {
    date,
    shifts: [],
    cash: {
      openingCash: 0, closingCash: 0, mpesaCashIn: 0,
      poolGames: 0, poolRate: 20, openingPoolCoins: 0,
      closingPoolCoins: 0, poolCoinExchanges: 0
    },
    stock: {},
    previousStock: {},
    previousStockRecordedAt: null,
    expenses: []
  };
}

async function getPreviousStock(date) {
  const { data, error } = await supabase
    .from('stock_entries')
    .select('item_id, closing, recorded_at, day_date')
    .lt('day_date', date)
    .order('day_date', { ascending: false })
    .order('recorded_at', { ascending: false });
  if (error) throw error;

  const previousStock = {};
  let previousStockRecordedAt = null;
  (data || []).forEach(row => {
    if (Object.prototype.hasOwnProperty.call(previousStock, row.item_id)) return;
    previousStock[row.item_id] = Number(row.closing);
    if (!previousStockRecordedAt && row.recorded_at) {
      previousStockRecordedAt = new Date(row.recorded_at).toISOString();
    }
  });
  return { previousStock, previousStockRecordedAt };
}

function intervalHours(start, end) {
  if (!start || !end) return 0;
  const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 100) / 100 : 0;
}

async function getDay(date) {
  const [shiftsRes, cashRes, stockRes, expensesRes, previous] = await Promise.all([
    supabase.from('day_shifts').select('*').eq('day_date', date),
    supabase.from('day_cash').select('*').eq('day_date', date).maybeSingle(),
    supabase.from('stock_entries').select('*').eq('day_date', date),
    supabase.from('day_expenses').select('*').eq('day_date', date),
    getPreviousStock(date)
  ]);
  if (shiftsRes.error) throw shiftsRes.error;
  if (cashRes.error) throw cashRes.error;
  if (stockRes.error) throw stockRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const day = blankDay(date);
  day.previousStock = previous.previousStock;
  day.previousStockRecordedAt = previous.previousStockRecordedAt;
  const firstStockRow = (stockRes.data || [])[0];
  day.stockRecordedAt = firstStockRow && firstStockRow.recorded_at
    ? new Date(firstStockRow.recorded_at).toISOString()
    : null;
  day.shifts = (shiftsRes.data || []).map(r => ({
    name: r.staff_name,
    hours: Number(r.hours),
    timeIn: r.time_in ? String(r.time_in).slice(0, 5) : '',
    timeOut: r.time_out ? String(r.time_out).slice(0, 5) : '',
    timeInAt: r.time_in_at ? new Date(r.time_in_at).toISOString() : null,
    timeOutAt: r.time_out_at ? new Date(r.time_out_at).toISOString() : null
  }));

  if (cashRes.data) {
    day.cash = {
      openingCash: Number(cashRes.data.opening_cash),
      closingCash: Number(cashRes.data.closing_cash),
      mpesaCashIn: Number(cashRes.data.mpesa_cash_in) || 0,
      poolGames: Number(cashRes.data.pool_games) || 0,
      poolRate: Number(cashRes.data.pool_rate) || 20,
      openingPoolCoins: Number(cashRes.data.opening_pool_coins) || 0,
      closingPoolCoins: Number(cashRes.data.closing_pool_coins) || 0,
      poolCoinExchanges: Number(cashRes.data.pool_coin_exchanges) || 0
    };
  }

  (stockRes.data || []).forEach(r => {
    day.stock[r.item_id] = {
      opening: Number(r.opening),
      added: Number(r.added),
      closing: Number(r.closing),
      recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : null
    };
  });

  day.expenses = (expensesRes.data || []).map(r => ({
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    category: r.category
  }));

  return day;
}

async function saveDay(date, payload) {
  const shifts = payload.shifts || [];
  const cash = payload.cash || {};
  const stock = payload.stock || {};
  const requestedStockRecordedAt = payload.stockRecordedAt ? new Date(payload.stockRecordedAt) : null;
  const stockRecordedAt = requestedStockRecordedAt && !Number.isNaN(requestedStockRecordedAt.getTime())
    ? requestedStockRecordedAt.toISOString()
    : null;
  if (!stockRecordedAt) throw new Error('Enter a valid stock close date and time');
  const previous = await getPreviousStock(date);
  const expenses = payload.expenses || [];

  // Replace this day's shifts wholesale (simplest way to handle add/remove/edit).
  const delShifts = await supabase.from('day_shifts').delete().eq('day_date', date);
  if (delShifts.error) throw delShifts.error;

  const shiftRows = shifts
    .filter(s => s.name && String(s.name).trim() !== '')
    .map(s => ({
      day_date: date,
      staff_name: s.name,
      hours: previous.previousStockRecordedAt ? intervalHours(previous.previousStockRecordedAt, stockRecordedAt) : (Number(s.hours) || 0),
      time_in: previous.previousStockRecordedAt ? new Date(previous.previousStockRecordedAt).toISOString().slice(11, 16) : (s.timeIn || null),
      time_out: new Date(stockRecordedAt).toISOString().slice(11, 16),
      time_in_at: previous.previousStockRecordedAt,
      time_out_at: stockRecordedAt
    }));
  if (shiftRows.length) {
    const insShifts = await supabase.from('day_shifts').insert(shiftRows);
    if (insShifts.error) throw insShifts.error;
  }

  // Replace this day's expenses wholesale too — same pattern as shifts.
  const delExpenses = await supabase.from('day_expenses').delete().eq('day_date', date);
  if (delExpenses.error) throw delExpenses.error;

  const expenseRows = expenses
    .filter(e => e.description && String(e.description).trim() !== '')
    .map(e => ({
      day_date: date,
      description: e.description,
      amount: Number(e.amount) || 0,
      category: e.category || 'Other'
    }));
  if (expenseRows.length) {
    const insExpenses = await supabase.from('day_expenses').insert(expenseRows);
    if (insExpenses.error) throw insExpenses.error;
  }

  // Upsert cash and M-Pesa inflow for the day.
  const cashUpsert = await supabase.from('day_cash').upsert(
    {
      day_date: date,
      opening_cash: Number(cash.openingCash) || 0,
      closing_cash: Number(cash.closingCash) || 0,
      mpesa_cash_in: Number(cash.mpesaCashIn) || 0,
      pool_games: Number(cash.poolGames) || 0,
      pool_rate: Number(cash.poolRate) || 20,
      opening_pool_coins: Number(cash.openingPoolCoins) || 0,
      closing_pool_coins: Number(cash.closingPoolCoins) || 0,
      pool_coin_exchanges: Number(cash.poolCoinExchanges) || 0
    },
    { onConflict: 'day_date' }
  );
  if (cashUpsert.error) throw cashUpsert.error;

  // Upsert stock movement rows, one per item.
  const stockRows = Object.entries(stock).map(([itemId, e]) => ({
    day_date: date,
    item_id: itemId,
    opening: Object.prototype.hasOwnProperty.call(previous.previousStock, itemId)
      ? previous.previousStock[itemId]
      : Number(e.opening) || 0,
    added: Number(e.added) || 0,
    closing: Number(e.closing) || 0,
    recorded_at: stockRecordedAt
  }));
  if (stockRows.length) {
    const stockUpsert = await supabase
      .from('stock_entries')
      .upsert(stockRows, { onConflict: 'day_date,item_id' });
    if (stockUpsert.error) throw stockUpsert.error;
  }

  return getDay(date);
}

async function saveDailyRecord(summary) {
  const { data, error } = await supabase
    .from('daily_records')
    .upsert({
      day_date: summary.date,
      total_income: Number(summary.totalRevenue) || 0,
      total_cost: Number(summary.totalCost) || 0,
      total_expenses: Number(summary.totalExpenses) || 0,
      net_profit: Number(summary.netProfit) || 0,
      loss_amount: Math.max(0, -(Number(summary.netProfit) || 0)),
      recorded_at: new Date().toISOString()
    }, { onConflict: 'day_date' })
    .select()
    .single();
  if (error) throw error;
  return {
    date: data.day_date,
    totalIncome: Number(data.total_income),
    totalCost: Number(data.total_cost),
    totalExpenses: Number(data.total_expenses),
    netProfit: Number(data.net_profit),
    lossAmount: Number(data.loss_amount),
    recordedAt: data.recorded_at
  };
}

async function listDailyRecords() {
  const { data, error } = await supabase
    .from('daily_records')
    .select('*')
    .order('day_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({
    date: row.day_date,
    totalIncome: Number(row.total_income),
    totalCost: Number(row.total_cost),
    totalExpenses: Number(row.total_expenses),
    netProfit: Number(row.net_profit),
    lossAmount: Number(row.loss_amount),
    recordedAt: row.recorded_at
  }));
}

async function listAllDayDates() {
  const [c, s, st] = await Promise.all([
    supabase.from('day_cash').select('day_date'),
    supabase.from('day_shifts').select('day_date'),
    supabase.from('stock_entries').select('day_date')
  ]);
  if (c.error) throw c.error;
  if (s.error) throw s.error;
  if (st.error) throw st.error;

  const set = new Set();
  (c.data || []).forEach(r => set.add(r.day_date));
  (s.data || []).forEach(r => set.add(r.day_date));
  (st.data || []).forEach(r => set.add(r.day_date));
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------
// DEBTS — customer credit ("on the tab"). A debt can be paid off
// gradually via multiple payments over time.
// ---------------------------------------------------------------------

function mapDebt(row, payments) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return {
    id: row.id,
    customerName: row.customer_name,
    dateIncurred: row.date_incurred,
    originalAmount: Number(row.original_amount),
    notes: row.notes || '',
    payments,
    paidAmount: paid,
    outstanding: Number(row.original_amount) - paid
  };
}

async function listDebts() {
  const [debtsRes, paymentsRes] = await Promise.all([
    supabase.from('debts').select('*').order('date_incurred', { ascending: false }),
    supabase.from('debt_payments').select('*')
  ]);
  if (debtsRes.error) throw debtsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const paymentsByDebt = {};
  (paymentsRes.data || []).forEach(p => {
    const entry = { id: p.id, datePaid: p.date_paid, amount: Number(p.amount) };
    (paymentsByDebt[p.debt_id] = paymentsByDebt[p.debt_id] || []).push(entry);
  });

  return (debtsRes.data || []).map(row => {
    const payments = (paymentsByDebt[row.id] || []).sort((a, b) => a.datePaid.localeCompare(b.datePaid));
    return mapDebt(row, payments);
  });
}

async function createDebt({ customerName, dateIncurred, originalAmount, notes }) {
  const { data, error } = await supabase
    .from('debts')
    .insert({
      customer_name: customerName,
      date_incurred: dateIncurred,
      original_amount: Number(originalAmount),
      notes: notes || ''
    })
    .select()
    .single();
  if (error) throw error;
  return mapDebt(data, []);
}

async function addDebtPayment(debtId, { datePaid, amount }) {
  const { error } = await supabase
    .from('debt_payments')
    .insert({ debt_id: debtId, date_paid: datePaid, amount: Number(amount) });
  if (error) throw error;
}

async function deleteDebt(id) {
  const { error } = await supabase.from('debts').delete().eq('id', id);
  if (error) throw error;
}

// Builds a { date -> {newCredit, repayments} } map across ALL dates in one
// pass, so day-list/balance-sheet routes don't need one query per date.
// IMPORTANT: repayments are assigned to the original credit date, not the
// actual payment date. This keeps a debt payment from distorting the day the
// cash was collected in the till, and instead offsets the debt day it was given.
async function getDebtDayMap() {
  const [debtsRes, paymentsRes] = await Promise.all([
    supabase.from('debts').select('id, date_incurred, original_amount'),
    supabase.from('debt_payments').select('debt_id, amount')
  ]);
  if (debtsRes.error) throw debtsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const debtDates = {};
  (debtsRes.data || []).forEach(r => {
    debtDates[r.id] = r.date_incurred;
  });

  const map = {};
  const ensure = date => (map[date] = map[date] || { newCredit: 0, repayments: 0 });
  (debtsRes.data || []).forEach(r => { ensure(r.date_incurred).newCredit += Number(r.original_amount); });
  (paymentsRes.data || []).forEach(r => {
    const debtDate = debtDates[r.debt_id];
    if (!debtDate) return;
    ensure(debtDate).repayments += Number(r.amount);
  });
  return map;
}

module.exports = {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  getDay,
  saveDay,
  saveDailyRecord,
  listDailyRecords,
  listAllDayDates,
  listDebts,
  createDebt,
  addDebtPayment,
  deleteDebt,
  getDebtDayMap
};
