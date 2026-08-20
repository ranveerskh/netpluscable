import { $, esc, fmt, metricWidth, daysLeft, suggestOffer, calcFigures } from "./utils.js";
import { customers, customerSummary } from "./customers.js";
import { renewals, canonicalRenewalGroups, openRenewModal } from "./renewals.js";
import { openCustomerModal, viewCustomer } from "./customers.js";
import { printInvoice } from "./invoices.js";
import { settingNear } from "./app.js";

export let dashboardPeriod = { type:'year', year:new Date().getFullYear() };
export let loyaltySortMode = 'spent';
export let dashboardBottomView = '';
export const accordionState = { dashboardView:new Set(), loyalty:new Set(), customers:new Set() };

export function periodMatches(dateStr, period = dashboardPeriod){
  if(period.type === 'lifetime') return true;
  if(!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return false;
  if(period.type === 'year') return d.getFullYear() === period.year;
  return false;
}

export function periodText(period = dashboardPeriod){
  if(period.type === 'year') return String(period.year);
  return 'Lifetime';
}

export function availableYears(){
  const set = new Set();
  customers.forEach(c=>{
    const dates = [c.originalStartDate, c.currentPlan?.startDate];
    dates.forEach(v=>{
      if(v && /^\d{4}-\d{2}-\d{2}$/.test(v)) set.add(Number(v.slice(0,4)));
    });
  });
  renewals.forEach(r=>{
    if(r.startDate && /^\d{4}-\d{2}-\d{2}$/.test(r.startDate)) set.add(Number(r.startDate.slice(0,4)));
  });
  const years = [...set].filter(Boolean).sort((a,b)=> b-a);
  const nowYear = new Date().getFullYear();
  if(!years.includes(nowYear)) years.unshift(nowYear);
  return years;
}

export function openPeriodModal(){
  const wrap = $("#periodOptions");
  const years = availableYears();
  wrap.innerHTML = `
    <button class="btn ${dashboardPeriod.type === 'year' && dashboardPeriod.year === new Date().getFullYear() ? 'ok' : 'ghost'}" data-period-type="year" data-period-year="${new Date().getFullYear()}" type="button">Current Year (${new Date().getFullYear()})</button>
    ${years.map(y=> `<button class="btn ${dashboardPeriod.type === 'year' && dashboardPeriod.year === y ? 'ok' : 'ghost'}" data-period-type="year" data-period-year="${y}" type="button">${y}</button>`).join('')}
    <button class="btn ${dashboardPeriod.type === 'lifetime' ? 'ok' : 'ghost'}" data-period-type="lifetime" type="button">Lifetime</button>
  `;
  wrap.querySelectorAll('[data-period-type]').forEach(btn=>{
    btn.onclick = ()=>{
      const type = btn.dataset.periodType;
      dashboardPeriod = type === 'year' ? { type:'year', year:+btn.dataset.periodYear } : { type:'lifetime' };
      $("#periodLabel").textContent = periodText();
      $("#modalPeriod").classList.remove('open');
      renderDashboard();
    };
  });
  $("#modalPeriod").classList.add('open');
}

export function getDashboardBaseCustomers(){
  return customers.filter(c => {
    const currentPlan = c.currentPlan || {};
    const refDate = currentPlan.startDate || c.originalStartDate || '';
    return periodMatches(refDate);
  });
}

export function dashboardFinancials(){
  const grouped = canonicalRenewalGroups();
  const rows = [];
  grouped.forEach(list=> list.forEach(r=> { if(periodMatches(r.startDate || '')) rows.push(r); }));
  let turnover = 0, expense = 0, profit = 0;
  rows.forEach(r=>{
    const f = calcFigures({ cost:r.cost, wholesale:r.wholesale, actual:r.actual, stbIncluded:r.stbIncluded, stbCost:r.stbCost, stbWholesale:r.stbWholesale, stbActual:r.stbActual });
    turnover += f.turnover; expense += f.expense; profit += f.profit;
  });
  return { rows, turnover, expense, profit };
}

export function renderMetricBar(label, value, maxMetric){
  return `
    <div class="metric-bar">
      <div class="metric-top">
        <div><strong>${label}</strong><span> (${esc(periodText())})</span></div>
        <strong>${fmt(value)}</strong>
      </div>
      <div class="track"><div class="fill" style="width:${metricWidth(Math.max(value, 0), maxMetric)}%"></div></div>
    </div>`;
}

export function detailGridHtml(item, offer=''){
  const cp = item.currentPlan || {};
  const figs = calcFigures({ cost:cp.cost, wholesale:cp.wholesale, actual:cp.actual, stbIncluded:cp.stbIncluded, stbCost:cp.stbCost, stbWholesale:cp.stbWholesale, stbActual:cp.stbActual });
  return `
    <div class="detail-grid">
      <div class="detail-box"><div class="detail-label">Email</div><div class="detail-value">${esc(item.c.email || 'Not given')}</div></div>
      <div class="detail-box"><div class="detail-label">User ID / MAC</div><div class="detail-value">${esc([item.c.userId, item.c.mac].filter(Boolean).join(' • ') || 'Not given')}</div></div>
      <div class="detail-box"><div class="detail-label">Start</div><div class="detail-value">${esc(cp.startDate || '-')}</div></div>
      <div class="detail-box"><div class="detail-label">Expiry</div><div class="detail-value">${esc(cp.expiryDate || '-')}</div></div>
      <div class="detail-box"><div class="detail-label">Total Paid</div><div class="detail-value">${esc(fmt(item.history.totalSpent))}</div></div>
      <div class="detail-box"><div class="detail-label">Renewals</div><div class="detail-value">${esc(item.history.renewalCount)}</div></div>
      <div class="detail-box"><div class="detail-label">This Plan Profit</div><div class="detail-value">${esc(fmt(figs.profit))}</div></div>
      <div class="detail-box"><div class="detail-label">Suggested Offer</div><div class="detail-value">${esc(offer || suggestOffer({ tenureDays:item.tenureDays, renewalCount:item.history.renewalCount, totalSpent:item.history.totalSpent, statusKey:item.status.key }))}</div></div>
    </div>`;
}

export function dashboardAccordionHtml(item, stateKey, includeRenew){
  const open = accordionState[stateKey].has(String(item.c.id));
  const cp = item.currentPlan;
  const statusText = item.status.key === 'expired' ? `Expired ${Math.abs(item.status.days)}d` : `${item.status.days}d left`;
  return `
    <div class="accordion-item ${open ? 'open' : ''}" data-acc="${stateKey}" data-id="${esc(item.c.id)}">
      <div class="accordion-head">
        <div class="accordion-left">
          <div class="accordion-name">${esc(item.c.name || '')}</div>
          <div class="accordion-meta">
            <span>${esc(cp.planName || cp.planId || '-')}</span>
            <span>•</span>
            <span>${esc(item.c.phone || 'No phone')}</span>
          </div>
          <div class="accordion-meta">
            <span class="mini-badge ${item.status.cls}">${esc(statusText)}</span>
            ${cp.paymentReceived === 'yes' ? `<span class="mini-badge badge-ok">Paid</span>` : `<span class="mini-badge badge-warn">Unpaid</span>`}
          </div>
        </div>
        <div class="accordion-actions">
          ${includeRenew ? `<button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>` : ''}
          <button class="mini-btn ghost" data-action="toggle" data-state="${stateKey}" data-id="${esc(item.c.id)}" type="button">${open ? 'Hide' : 'Open'}</button>
        </div>
      </div>
      <div class="accordion-body">
        ${detailGridHtml(item)}
        <div class="detail-actions">
          <button class="mini-btn ghost" data-action="view" data-id="${esc(item.c.id)}" type="button">View</button>
          <button class="mini-btn ghost" data-action="edit" data-id="${esc(item.c.id)}" type="button">Edit</button>
          <button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>
          <button class="mini-btn ghost" data-action="invoice" data-id="${esc(item.c.id)}" type="button">Slip</button>
        </div>
      </div>
    </div>`;
}

export function loyaltyAccordionHtml(item){
  const open = accordionState.loyalty.has(String(item.c.id));
  return `
    <div class="accordion-item ${open ? 'open' : ''}" data-acc="loyalty" data-id="${esc(item.c.id)}">
      <div class="accordion-head">
        <div class="accordion-left">
          <div class="accordion-name">${esc(item.c.name || '')}</div>
          <div class="accordion-meta">
            <span class="mini-badge badge-ok">Paid ${esc(fmt(item.history.totalSpent))}</span>
            <span class="mini-badge badge-warn">Renewals ${esc(item.history.renewalCount)}</span>
            <span class="mini-badge ${item.status.cls}">${esc(item.status.label)}</span>
          </div>
        </div>
        <div class="accordion-actions">
          <button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>
          <button class="mini-btn ghost" data-action="toggle" data-state="loyalty" data-id="${esc(item.c.id)}" type="button">${open ? 'Hide' : 'Open'}</button>
        </div>
      </div>
      <div class="accordion-body">
        ${detailGridHtml(item, suggestOffer({ tenureDays:item.tenureDays, renewalCount:item.history.renewalCount, totalSpent:item.history.totalSpent, statusKey:item.status.key }))}
        <div class="detail-actions">
          <button class="mini-btn ghost" data-action="view" data-id="${esc(item.c.id)}" type="button">View</button>
          <button class="mini-btn ghost" data-action="edit" data-id="${esc(item.c.id)}" type="button">Edit</button>
          <button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>
          <button class="mini-btn ghost" data-action="invoice" data-id="${esc(item.c.id)}" type="button">Slip</button>
        </div>
      </div>
    </div>`;
}

export function renderDashboard(){
  const dashboard = $("#tab-dashboard");
  if(!dashboard) return;
  const boxCustomers = getDashboardBaseCustomers();
  
  // Real-time period calculation (match: 57 Active + 6 Expired = 63 Total for 2026)
  const activeCount = boxCustomers.filter(c => { const d = daysLeft((c.currentPlan || {}).expiryDate); return d >= 0; }).length;
  const nearCount = boxCustomers.filter(c => { const d = daysLeft((c.currentPlan || {}).expiryDate); return d >= 0 && d <= settingNear; }).length;
  const expiredCount = boxCustomers.filter(c => daysLeft((c.currentPlan || {}).expiryDate) < 0).length;
  
  const financials = dashboardFinancials();
  const maxMetric = Math.max(financials.turnover, financials.expense, financials.profit, 1);

  const nearList = customers.map(customerSummary)
    .filter(x => x.status.key === 'near')
    .sort((a,b)=> (a.status.days ?? 9999) - (b.status.days ?? 9999));
  const expiredList = customers.map(customerSummary)
    .filter(x => x.status.key === 'expired')
    .sort((a,b)=> (b.status.days ?? -99999) - (a.status.days ?? -99999));
  const recentlyExpiredList = expiredList.filter(x => (x.status.days ?? -99999) >= -90);
  const olderExpiredList = expiredList.filter(x => (x.status.days ?? 0) < -90);

  const loyaltyList = customers.map(customerSummary).sort((a,b)=>{
    if(loyaltySortMode === 'renewals'){
      const diff = b.history.renewalCount - a.history.renewalCount;
      if(diff !== 0) return diff;
      return b.history.totalSpent - a.history.totalSpent;
    }
    const diff = b.history.totalSpent - a.history.totalSpent;
    if(diff !== 0) return diff;
    return b.history.renewalCount - a.history.renewalCount;
  }).slice(0,20);

  let bottomContent = `<div class="empty-state">Choose one of the buttons above to view the list.</div>`;
  if(dashboardBottomView === 'near'){
    bottomContent = nearList.length ? nearList.map(item => dashboardAccordionHtml(item, 'dashboardView', true)).join('') : `<div class="empty-state">No customers are expiring soon.</div>`;
  }else if(dashboardBottomView === 'expired'){
    if(!expiredList.length){
      bottomContent = `<div class="empty-state">No expired customers right now.</div>`;
    }else{
      bottomContent = `
        ${recentlyExpiredList.length ? recentlyExpiredList.map(item => dashboardAccordionHtml(item, 'dashboardView', true)).join('') : `<div class="empty-state">No customers expired in the last 90 days.</div>`}
        ${olderExpiredList.length ? `
          <details class="dashboard-old-expired">
            <summary>Older expired customers (${olderExpiredList.length}) • more than 90 days ago</summary>
            <div class="list-stack">${olderExpiredList.map(item => dashboardAccordionHtml(item, 'dashboardView', true)).join('')}</div>
          </details>
        ` : ''}
      `;
    }
  }else if(dashboardBottomView === 'top'){
    bottomContent = loyaltyList.length ? loyaltyList.map(item => loyaltyAccordionHtml(item)).join('') : `<div class="empty-state">No loyalty data available yet.</div>`;
  }

  dashboard.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Dashboard</h2>
          <div class="muted">Showing ${esc(periodText())}</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="kpi-card"><div class="kpi-label">Customers (${esc(periodText())})</div><div class="kpi-value">${boxCustomers.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Active</div><div class="kpi-value">${activeCount}</div></div>
        <div class="kpi-card"><div class="kpi-label">Expiring Soon</div><div class="kpi-value">${nearCount}</div></div>
        <div class="kpi-card"><div class="kpi-label">Expired</div><div class="kpi-value">${expiredCount}</div></div>
      </div>
      <div class="metric-stack">
        ${renderMetricBar('Profit', financials.profit, maxMetric)}
        ${renderMetricBar('Expense', financials.expense, maxMetric)}
        ${renderMetricBar('Turnover', financials.turnover, maxMetric)}
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="section-title">
        <div>
          <h3>Customer Insights</h3>
          <div class="helper">Lists open only after you press a button.</div>
        </div>
      </div>
      <div class="segmented">
        <button class="btn ${dashboardBottomView === 'near' ? 'ok' : 'ghost'}" id="dashBtnNear" type="button">Expiring Soon</button>
        <button class="btn ${dashboardBottomView === 'expired' ? 'ok' : 'ghost'}" id="dashBtnExpired" type="button">Expired</button>
        <button class="btn ${dashboardBottomView === 'top' ? 'ok' : 'ghost'}" id="dashBtnTop" type="button">Top Customers</button>
      </div>
      ${dashboardBottomView === 'top' ? `
        <div class="flex" style="margin-top:12px">
          <button class="mini-btn ${loyaltySortMode === 'spent' ? 'ok' : 'ghost'}" id="loyalSortSpent" type="button">Paid more</button>
          <button class="mini-btn ${loyaltySortMode === 'renewals' ? 'ok' : 'ghost'}" id="loyalSortRenewals" type="button">Renewed more</button>
        </div>
      ` : ''}
      <div class="list-stack" style="margin-top:12px">${bottomContent}</div>
    </div>
  `;

  $("#dashBtnNear").onclick = ()=>{ dashboardBottomView = dashboardBottomView === 'near' ? '' : 'near'; renderDashboard(); };
  $("#dashBtnExpired").onclick = ()=>{ dashboardBottomView = dashboardBottomView === 'expired' ? '' : 'expired'; renderDashboard(); };
  $("#dashBtnTop").onclick = ()=>{ dashboardBottomView = dashboardBottomView === 'top' ? '' : 'top'; renderDashboard(); };
  const sortSpent = $("#loyalSortSpent");
  const sortRenewals = $("#loyalSortRenewals");
  if(sortSpent) sortSpent.onclick = ()=>{ loyaltySortMode = 'spent'; renderDashboard(); };
  if(sortRenewals) sortRenewals.onclick = ()=>{ loyaltySortMode = 'renewals'; renderDashboard(); };
  bindDashboardClicks(dashboard);
}

function bindDashboardClicks(root){
  root.querySelectorAll('[data-action="toggle"]').forEach(btn=>{
    btn.onclick = ()=>{
      const stateKey = btn.dataset.state;
      const id = String(btn.dataset.id);
      if(accordionState[stateKey].has(id)) accordionState[stateKey].delete(id); else accordionState[stateKey].add(id);
      renderDashboard();
    };
  });
  root.querySelectorAll('[data-action="renew"]').forEach(btn=> btn.onclick = ()=> openRenewModal(btn.dataset.id));
  root.querySelectorAll('[data-action="edit"]').forEach(btn=> btn.onclick = ()=> openCustomerModal(btn.dataset.id));
  root.querySelectorAll('[data-action="view"]').forEach(btn=> btn.onclick = ()=> viewCustomer(btn.dataset.id));
  root.querySelectorAll('[data-action="invoice"]').forEach(btn=> btn.onclick = ()=> printInvoice(btn.dataset.id));
}
