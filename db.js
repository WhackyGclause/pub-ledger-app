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
    cash: { openingCash: 0, closingCash: 0, openingMomo: 0, closingMomo: 0 },
    stock: {}
  };
}

async function getDay(date) {
  const [shiftsRes, cashRes, stockRes] = await Promise.all([
    supabase.from('day_shifts').select('*').eq('day_date', date),
    supabase.from('day_cash').select('*').eq('day_date', date).maybeSingle(),
    supabase.from('stock_entries').select('*').eq('day_date', date)
  ]);
  if (shiftsRes.error) throw shiftsRes.error;
  if (cashRes.error) throw cashRes.error;
  if (stockRes.error) throw stockRes.error;

  const day = blankDay(date);
  day.shifts = (shiftsRes.data || []).map(r => ({ name: r.staff_name, hours: Number(r.hours) }));

  if (cashRes.data) {
    day.cash = {
      openingCash: Number(cashRes.data.opening_cash),
      closingCash: Number(cashRes.data.closing_cash),
      openingMomo: Number(cashRes.data.opening_momo),
      closingMomo: Number(cashRes.data.closing_momo)
    };
  }

  (stockRes.data || []).forEach(r => {
    day.stock[r.item_id] = {
      opening: Number(r.opening),
      added: Number(r.added),
      closing: Number(r.closing)
    };
  });

  return day;
}

async function saveDay(date, payload) {
  const shifts = payload.shifts || [];
  const cash = payload.cash || {};
  const stock = payload.stock || {};

  // Replace this day's shifts wholesale (simplest way to handle add/remove/edit).
  const delShifts = await supabase.from('day_shifts').delete().eq('day_date', date);
  if (delShifts.error) throw delShifts.error;

  const shiftRows = shifts
    .filter(s => s.name && String(s.name).trim() !== '')
    .map(s => ({ day_date: date, staff_name: s.name, hours: Number(s.hours) || 0 }));
  if (shiftRows.length) {
    const insShifts = await supabase.from('day_shifts').insert(shiftRows);
    if (insShifts.error) throw insShifts.error;
  }

  // Upsert cash/mobile money for the day.
  const cashUpsert = await supabase.from('day_cash').upsert(
    {
      day_date: date,
      opening_cash: Number(cash.openingCash) || 0,
      closing_cash: Number(cash.closingCash) || 0,
      opening_momo: Number(cash.openingMomo) || 0,
      closing_momo: Number(cash.closingMomo) || 0
    },
    { onConflict: 'day_date' }
  );
  if (cashUpsert.error) throw cashUpsert.error;

  // Upsert stock movement rows, one per item.
  const stockRows = Object.entries(stock).map(([itemId, e]) => ({
    day_date: date,
    item_id: itemId,
    opening: Number(e.opening) || 0,
    added: Number(e.added) || 0,
    closing: Number(e.closing) || 0
  }));
  if (stockRows.length) {
    const stockUpsert = await supabase
      .from('stock_entries')
      .upsert(stockRows, { onConflict: 'day_date,item_id' });
    if (stockUpsert.error) throw stockUpsert.error;
  }

  return getDay(date);
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

module.exports = {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  getDay,
  saveDay,
  listAllDayDates
};
