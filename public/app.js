// app.js — frontend logic. Talks to the Express backend via fetch().

function todayStr(){ return new Date().toISOString().slice(0,10); }
function fmt(n){ return (Math.round((n||0)*100)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const CATEGORIES = ['Liquor','Tobacco Snuff','Khat','Soft Drinks'];

let inventory = [];
let currentDate = todayStr();
let currentDay = null;

// ---------- PWA: service worker + install prompt ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('/sw.js').catch(err=> console.warn('Service worker registration failed', err));
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});
window.addEventListener('appinstalled', ()=>{
  deferredInstallPrompt = null;
  hideInstallBanner();
});

function showInstallBanner(){
  const el = document.getElementById('installBanner');
  if(!el || sessionStorage.getItem('installBannerDismissed')) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="install-banner">
      <span>Install The Day Book on this device for one-tap access.</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="installBtn">Install</button>
        <button class="dismiss" id="dismissInstallBtn" aria-label="Dismiss">&times;</button>
      </div>
    </div>
  `;
  document.getElementById('installBtn').onclick = async ()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hideInstallBanner();
  };
  document.getElementById('dismissInstallBtn').onclick = ()=>{
    sessionStorage.setItem('installBannerDismissed','1');
    hideInstallBanner();
  };
}
function hideInstallBanner(){
  const el = document.getElementById('installBanner');
  if(el){ el.style.display = 'none'; el.innerHTML=''; }
}

// ---------- API helpers ----------
async function api(path, opts){
  const res = await fetch('/api'+path, {
    headers: {'Content-Type':'application/json'},
    ...opts
  });
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    throw new Error(body.error || ('Request failed: '+res.status));
  }
  if(res.status===204) return null;
  return res.json();
}
const apiGet = (p) => api(p);
const apiPost = (p,data) => api(p, {method:'POST', body: JSON.stringify(data)});
const apiPut = (p,data) => api(p, {method:'PUT', body: JSON.stringify(data)});
const apiDelete = (p) => api(p, {method:'DELETE'});

// ---------- Data loading ----------
async function loadInventory(){
  inventory = await apiGet('/items');
}
async function loadDay(date){
  currentDay = await apiGet('/days/'+date);
  inventory.forEach(it=>{
    if(!currentDay.stock[it.id]) currentDay.stock[it.id] = {opening:0, added:0, closing:0};
  });
}
async function saveDay(){
  const statusEl = document.getElementById('saveStatus');
  if(statusEl) statusEl.textContent = 'Saving…';
  try{
    await apiPut('/days/'+currentDay.date, currentDay);
    if(statusEl) statusEl.textContent = 'Saved ✓ ' + new Date().toLocaleTimeString();
  }catch(e){
    if(statusEl) statusEl.textContent = 'Save failed — ' + e.message;
  }
}

// ---------- Computation (mirrors backend logic, for live preview) ----------
function computeDayTotals(day){
  let totalRevenue=0, totalCost=0;
  const lines = inventory.map(it=>{
    const e = day.stock[it.id] || {opening:0,added:0,closing:0};
    const sold = (Number(e.opening)||0) + (Number(e.added)||0) - (Number(e.closing)||0);
    const revenue = sold * it.sellingPrice;
    const cost = sold * it.buyingPrice;
    totalRevenue += revenue;
    totalCost += cost;
    return {item:it, e, sold, revenue, cost};
  });
  const netProfit = totalRevenue - totalCost;
  const cash = day.cash || {openingCash:0,closingCash:0,openingMomo:0,closingMomo:0};
  const actualInflow = ((Number(cash.closingCash)||0) - (Number(cash.openingCash)||0)) + ((Number(cash.closingMomo)||0) - (Number(cash.openingMomo)||0));
  const discrepancy = actualInflow - totalRevenue;
  const totalBalance = (Number(cash.closingCash)||0) + (Number(cash.closingMomo)||0);
  const totalHours = (day.shifts||[]).reduce((s,p)=> s + (Number(p.hours)||0), 0);
  return {lines, totalRevenue, totalCost, netProfit, actualInflow, discrepancy, totalBalance, totalHours};
}

// ---------- Rendering: Day Sheet ----------
function renderDayTab(){
  const totals = computeDayTotals(currentDay);
  const el = document.getElementById('dayTab');

  const staffRows = (currentDay.shifts||[]).map((p, idx)=>`
    <div class="staff-row" data-idx="${idx}">
      <input type="text" class="staff-name" placeholder="Staff name" value="${escapeHtml(p.name||'')}">
      <input type="number" class="staff-hours" placeholder="Hours" min="0" step="0.5" value="${p.hours||''}" onfocus="this.select()">
      <button class="btn danger small remove-staff">Remove</button>
    </div>
  `).join('') || '<div class="empty-note">No staff added for this shift yet.</div>';

  const stockRows = totals.lines.map(l=>`
    <tr data-item="${l.item.id}">
      <td class="name-cell">${escapeHtml(l.item.name)}<br><span class="category-tag">${l.item.category}</span></td>
      <td class="num-col"><input type="number" min="0" class="in-opening" value="${l.e.opening}" onfocus="this.select()"></td>
      <td class="num-col"><input type="number" min="0" class="in-added" value="${l.e.added}" onfocus="this.select()"></td>
      <td class="num-col"><input type="number" min="0" class="in-closing" value="${l.e.closing}" onfocus="this.select()"></td>
      <td class="computed ${l.sold<0?'neg':''}" id="sold-${l.item.id}">${l.sold}</td>
      <td class="computed">${fmt(l.item.buyingPrice)}</td>
      <td class="computed">${fmt(l.item.sellingPrice)}</td>
      <td class="computed" id="revenue-${l.item.id}">${fmt(l.revenue)}</td>
      <td class="computed ${l.revenue-l.cost<0?'neg':''}" id="profit-${l.item.id}">${fmt(l.revenue-l.cost)}</td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty-note">No items yet — add stock items in the "Stock Setup" tab first.</td></tr>';

  const discClass = Math.abs(totals.discrepancy) < 1 ? 'balanced' : (totals.discrepancy < 0 ? 'shortfall' : 'over');
  const discLabel = Math.abs(totals.discrepancy) < 1 ? 'Balanced' : (totals.discrepancy < 0 ? 'Shortfall' : 'Over / Untracked income');

  el.innerHTML = `
    <div class="card">
      <h2><span class="eyebrow">Shift</span> Staff on duty</h2>
      <div id="staffRows">${staffRows}</div>
      <div class="row-actions">
        <button class="btn ghost small" id="addStaffBtn">+ Add staff</button>
        <span class="save-status" style="margin-left:auto;">Total hours: <span id="totalHoursVal">${fmt(totals.totalHours)}</span></span>
      </div>
    </div>

    <div class="card">
      <h2><span class="eyebrow">Counter</span> Stock movement</h2>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr>
          <th>Item</th><th>Opening</th><th>Added</th><th>Closing</th><th>Sold</th>
          <th>Buy price</th><th>Sell price</th><th>Revenue</th><th>Profit</th>
        </tr></thead>
        <tbody id="stockBody">${stockRows}</tbody>
      </table>
      </div>
      <p class="save-status" style="margin-top:8px;">Prices are fixed per item — edit them in Stock Setup, not here.</p>
    </div>

    <div class="card">
      <h2><span class="eyebrow">Till</span> Cash &amp; mobile money</h2>
      <div class="grid-2">
        <div class="field"><label>Opening cash</label><input type="number" id="openingCash" value="${currentDay.cash.openingCash||0}" onfocus="this.select()"></div>
        <div class="field"><label>Closing cash</label><input type="number" id="closingCash" value="${currentDay.cash.closingCash||0}" onfocus="this.select()"></div>
        <div class="field"><label>Opening mobile money</label><input type="number" id="openingMomo" value="${currentDay.cash.openingMomo||0}" onfocus="this.select()"></div>
        <div class="field"><label>Closing mobile money</label><input type="number" id="closingMomo" value="${currentDay.cash.closingMomo||0}" onfocus="this.select()"></div>
      </div>
    </div>

    <div class="card">
      <h2><span class="eyebrow">Summary</span> ${currentDay.date}</h2>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">Total revenue</div><div class="value" id="totalRevenueVal">${fmt(totals.totalRevenue)}</div></div>
        <div class="summary-item"><div class="label">Total cost</div><div class="value" id="totalCostVal">${fmt(totals.totalCost)}</div></div>
        <div class="summary-item"><div class="label">Net profit</div><div class="value ${totals.netProfit<0?'neg':'pos'}" id="netProfitVal">${fmt(totals.netProfit)}</div></div>
        <div class="summary-item"><div class="label">Total balance (till)</div><div class="value" id="totalBalanceVal">${fmt(totals.totalBalance)}</div></div>
        <div class="summary-item"><div class="label">Cash+MoMo collected</div><div class="value" id="actualInflowVal">${fmt(totals.actualInflow)}</div></div>
        <div class="summary-item"><div class="label">Discrepancy</div><div class="value ${totals.discrepancy<0?'neg':(totals.discrepancy>0?'':'pos')}" id="discrepancyVal">${fmt(totals.discrepancy)}</div></div>
      </div>
      <div class="stamp-wrap" id="stampWrap"><div class="stamp ${discClass}">${discLabel}</div></div>
      <div class="save-bar">
        <span class="save-status" id="saveStatus"></span>
        <button class="btn brass" id="saveDayBtn">Save this day</button>
      </div>
    </div>
  `;

  document.getElementById('addStaffBtn').onclick = ()=>{
    currentDay.shifts.push({name:'',hours:''});
    renderDayTab();
  };
  document.querySelectorAll('.remove-staff').forEach(btn=>{
    btn.onclick = (e)=>{
      const idx = Number(e.target.closest('.staff-row').dataset.idx);
      currentDay.shifts.splice(idx,1);
      renderDayTab();
    };
  });
  document.querySelectorAll('.staff-name').forEach((inp,i)=> inp.oninput = ()=>{ currentDay.shifts[i].name = inp.value; });
  document.querySelectorAll('.staff-hours').forEach((inp,i)=> inp.oninput = ()=>{ currentDay.shifts[i].hours = inp.value; updateDayComputedUI(); });

  document.querySelectorAll('#stockBody tr[data-item]').forEach(tr=>{
    const itemId = tr.dataset.item;
    const e = currentDay.stock[itemId];
    tr.querySelector('.in-opening').oninput = (ev)=>{ e.opening = ev.target.value; updateDayComputedUI(); };
    tr.querySelector('.in-added').oninput = (ev)=>{ e.added = ev.target.value; updateDayComputedUI(); };
    tr.querySelector('.in-closing').oninput = (ev)=>{ e.closing = ev.target.value; updateDayComputedUI(); };
  });

  ['openingCash','closingCash','openingMomo','closingMomo'].forEach(id=>{
    document.getElementById(id).oninput = (ev)=>{ currentDay.cash[id] = ev.target.value; updateDayComputedUI(); };
  });

  document.getElementById('saveDayBtn').onclick = saveDay;
}

// Updates only the computed numbers (sold/revenue/profit/summary/stamp)
// WITHOUT touching any <input> elements. This is what stops the cursor
// from jumping while typing — the field being typed in is never re-created.
function updateDayComputedUI(){
  if(!currentDay) return;
  const totals = computeDayTotals(currentDay);
  const setText = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };

  totals.lines.forEach(l=>{
    const soldEl = document.getElementById('sold-'+l.item.id);
    if(soldEl){ soldEl.textContent = l.sold; soldEl.className = 'computed' + (l.sold<0?' neg':''); }
    setText('revenue-'+l.item.id, fmt(l.revenue));
    const profitEl = document.getElementById('profit-'+l.item.id);
    if(profitEl){ const p = l.revenue-l.cost; profitEl.textContent = fmt(p); profitEl.className = 'computed' + (p<0?' neg':''); }
  });

  setText('totalHoursVal', fmt(totals.totalHours));
  setText('totalRevenueVal', fmt(totals.totalRevenue));
  setText('totalCostVal', fmt(totals.totalCost));
  setText('totalBalanceVal', fmt(totals.totalBalance));
  setText('actualInflowVal', fmt(totals.actualInflow));
  setText('netProfitVal', fmt(totals.netProfit));
  const netEl = document.getElementById('netProfitVal');
  if(netEl) netEl.className = 'value' + (totals.netProfit<0?' neg':' pos');
  setText('discrepancyVal', fmt(totals.discrepancy));
  const discEl = document.getElementById('discrepancyVal');
  if(discEl) discEl.className = 'value' + (totals.discrepancy<0?' neg':(totals.discrepancy>0?'':' pos'));

  const stampWrap = document.getElementById('stampWrap');
  if(stampWrap){
    const discClass = Math.abs(totals.discrepancy) < 1 ? 'balanced' : (totals.discrepancy < 0 ? 'shortfall' : 'over');
    const discLabel = Math.abs(totals.discrepancy) < 1 ? 'Balanced' : (totals.discrepancy < 0 ? 'Shortfall' : 'Over / Untracked income');
    stampWrap.innerHTML = `<div class="stamp ${discClass}">${discLabel}</div>`;
  }
}

// ---------- Rendering: Inventory Setup ----------
function renderInventoryTab(){
  const el = document.getElementById('inventoryTab');
  const rows = inventory.map(it=>`
    <tr data-id="${it.id}">
      <td class="name-cell">${escapeHtml(it.name)}</td>
      <td><span class="category-tag">${it.category}</span></td>
      <td class="computed">${fmt(it.buyingPrice)}</td>
      <td class="computed">${fmt(it.sellingPrice)}</td>
      <td><button class="btn danger small remove-item">Remove</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-note">No stock items yet — add your first one below.</td></tr>';

  el.innerHTML = `
    <div class="card">
      <h2><span class="eyebrow">Setup</span> Counter stock list</h2>
      <p class="save-status" style="margin-top:-6px;">Every item's buying and selling price is fixed here, once, and reused on every day sheet automatically.</p>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Item</th><th>Category</th><th>Buying price</th><th>Selling price</th><th></th></tr></thead>
        <tbody id="invBody">${rows}</tbody>
      </table>
      </div>
    </div>

    <div class="card">
      <h2><span class="eyebrow">Add</span> New stock item</h2>
      <div class="grid-2">
        <div class="field"><label>Item name</label><input type="text" id="newItemName" placeholder="e.g. Whisky (750ml)"></div>
        <div class="field"><label>Category</label>
          <select id="newItemCat">${CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Buying price (fixed)</label><input type="number" id="newItemBuy" placeholder="Unit buying price"></div>
        <div class="field"><label>Selling price (fixed)</label><input type="number" id="newItemSell" placeholder="Unit selling price"></div>
      </div>
      <div class="row-actions">
        <button class="btn brass" id="addItemBtn">Add item</button>
        <span class="save-status" id="invSaveStatus"></span>
      </div>
    </div>
  `;

  document.querySelectorAll('#invBody .remove-item').forEach(btn=>{
    btn.onclick = async (e)=>{
      const id = e.target.closest('tr').dataset.id;
      if(!confirm('Remove this item? Past sales history for it will remain, but it will disappear from future day sheets.')) return;
      await apiDelete('/items/'+id);
      await loadInventory();
      renderInventoryTab();
    };
  });

  document.getElementById('addItemBtn').onclick = async ()=>{
    const name = document.getElementById('newItemName').value.trim();
    const category = document.getElementById('newItemCat').value;
    const buyingPrice = document.getElementById('newItemBuy').value;
    const sellingPrice = document.getElementById('newItemSell').value;
    const statusEl = document.getElementById('invSaveStatus');
    if(!name || buyingPrice==='' || sellingPrice===''){
      statusEl.textContent = 'Please fill in name, buying price and selling price.';
      return;
    }
    statusEl.textContent = 'Saving…';
    try{
      await apiPost('/items', {name, category, buyingPrice, sellingPrice});
      await loadInventory();
      renderInventoryTab();
    }catch(e){
      statusEl.textContent = 'Failed: '+e.message;
    }
  };
}

// ---------- Rendering: History ----------
async function renderHistoryTab(){
  const el = document.getElementById('historyTab');
  el.innerHTML = '<div class="loading">Loading sales records…</div>';
  const days = await apiGet('/days');
  if(days.length===0){
    el.innerHTML = '<div class="card"><div class="empty-note">No days recorded yet. Save a Day Sheet to see it here.</div></div>';
    return;
  }
  const rowsHtml = days.slice().reverse().map(t=>{
    const statusClass = Math.abs(t.discrepancy)<1 ? 'ok' : (t.discrepancy<0 ? 'bad' : 'over');
    const statusLabel = Math.abs(t.discrepancy)<1 ? 'Balanced' : (t.discrepancy<0 ? 'Shortfall' : 'Over');
    return `<tr class="history-row" data-date="${t.date}">
      <td class="name-cell">${t.date}</td>
      <td>${t.staffCount}</td>
      <td>${fmt(t.totalRevenue)}</td>
      <td class="${t.netProfit<0?'neg':''}">${fmt(t.netProfit)}</td>
      <td>${fmt(t.totalBalance)}</td>
      <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <h2><span class="eyebrow">Records</span> Day-by-day sales</h2>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Date</th><th>Staff</th><th>Revenue</th><th>Net profit</th><th>Total balance</th><th>Status</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      </div>
      <p class="save-status" style="margin-top:10px;">Click any row to open that day in the Day Sheet.</p>
    </div>
  `;
  document.querySelectorAll('.history-row').forEach(tr=>{
    tr.onclick = async ()=>{
      currentDate = tr.dataset.date;
      document.getElementById('dateInput').value = currentDate;
      await loadDay(currentDate);
      switchTab('day');
    };
  });
}

// ---------- Rendering: Balance Sheet ----------
async function renderBalanceTab(){
  const el = document.getElementById('balanceTab');
  el.innerHTML = '<div class="loading">Building balance sheet…</div>';
  const data = await apiGet('/balance-sheet');
  if(data.daysRecorded===0){
    el.innerHTML = '<div class="card"><div class="empty-note">No data yet. Once days are saved, the running balance sheet will appear here.</div></div>';
    return;
  }
  const points = data.points;
  const latest = points[points.length-1];

  const W=Math.max(600, points.length*70), H=220, pad=36;
  const vals = points.map(p=>p.cum);
  const minV = Math.min(0,...vals), maxV = Math.max(0,...vals);
  const range = (maxV-minV)||1;
  const xStep = (W-2*pad)/Math.max(1,points.length-1);
  const yOf = v => H-pad - ((v-minV)/range)*(H-2*pad);
  const xOf = i => pad + i*xStep;
  const pathD = points.map((p,i)=> `${i===0?'M':'L'} ${xOf(i)} ${yOf(p.cum)}`).join(' ');
  const zeroY = yOf(0);
  const dots = points.map((p,i)=>`<circle cx="${xOf(i)}" cy="${yOf(p.cum)}" r="3.5" fill="${p.cum<0?'#A23B2E':'#2F6B5E'}"><title>${p.date}: ${fmt(p.cum)}</title></circle>`).join('');
  const labels = points.map((p,i)=> i%Math.ceil(points.length/10||1)===0 ? `<text x="${xOf(i)}" y="${H-10}" font-size="9" fill="#6b5c47" text-anchor="middle" font-family="IBM Plex Mono, monospace">${p.date.slice(5)}</text>` : '').join('');

  el.innerHTML = `
    <div class="card">
      <h2><span class="eyebrow">Overview</span> Running balance sheet — updated to ${latest.date}</h2>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">All-time revenue</div><div class="value">${fmt(data.totalRevenue)}</div></div>
        <div class="summary-item"><div class="label">All-time cost</div><div class="value">${fmt(data.totalCost)}</div></div>
        <div class="summary-item"><div class="label">Cumulative net profit</div><div class="value ${data.cumulativeProfit<0?'neg':'pos'}">${fmt(data.cumulativeProfit)}</div></div>
        <div class="summary-item"><div class="label">Days recorded</div><div class="value">${data.daysRecorded}</div></div>
        <div class="summary-item"><div class="label">Loss days</div><div class="value ${data.lossDays>0?'neg':''}">${data.lossDays}</div></div>
      </div>
    </div>
    <div class="card">
      <h2><span class="eyebrow">Trend</span> Cumulative profit over time</h2>
      <div class="chart-wrap">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <line x1="${pad}" y1="${zeroY}" x2="${W-pad}" y2="${zeroY}" stroke="#3B2417" stroke-width="1" stroke-dasharray="3,3"/>
          <path d="${pathD}" fill="none" stroke="#C08A28" stroke-width="2.5"/>
          ${dots}
          ${labels}
        </svg>
      </div>
    </div>
  `;
}

// ---------- Tabs ----------
function switchTab(name){
  document.querySelectorAll('nav.tabs button').forEach(b=> b.classList.toggle('active', b.dataset.tab===name));
  ['day','inventory','history','balance'].forEach(t=>{
    document.getElementById(t+'Tab').style.display = (t===name)?'block':'none';
  });
  if(name==='day') renderDayTab();
  if(name==='inventory') renderInventoryTab();
  if(name==='history') renderHistoryTab();
  if(name==='balance') renderBalanceTab();
}

document.getElementById('tabs').addEventListener('click', (e)=>{
  if(e.target.tagName==='BUTTON') switchTab(e.target.dataset.tab);
});

document.getElementById('dateInput').addEventListener('change', async (e)=>{
  currentDate = e.target.value || todayStr();
  await loadDay(currentDate);
  renderDayTab();
});

// ---------- Init ----------
(async function init(){
  document.getElementById('dateInput').value = currentDate;
  await loadInventory();
  await loadDay(currentDate);
  renderDayTab();
})();
