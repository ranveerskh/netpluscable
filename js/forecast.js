import { $, esc, fmt, metricWidth, isoToDate, addMonthsDate, monthsBetween, clamp, average } from "./utils.js";
import { plans } from "./plans.js";
import { customers, getExpiryStatus } from "./customers.js";
import { canonicalRenewalGroups } from "./renewals.js";

export let forecastPeriodKey = 'month';
export let forecastScenarioKey = 'expected';
export let forecastShowAllMonths = false;

const FORECAST_RECENT_EXPIRED_DAYS = 90;
const FORECAST_RENEWAL_GRACE_DAYS = 14;
const FORECAST_MONTHLY_ASSUMPTION = 0.99;
const FORECAST_OTHER_FALLBACK = 0.85;

function startOfMonthDate(date=new Date()){
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthKeyFromDate(date){
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthLabelFromDate(date){
  return new Intl.DateTimeFormat('en-CA', { month:'short', year:'numeric' }).format(new Date(date));
}
function monthIndexFrom(startMonth, date){
  const s = startOfMonthDate(startMonth);
  const d = startOfMonthDate(date);
  return (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
}
function addDaysDate(date, days){
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function recordKind(list, row, index){
  return row.renewalType || row.recordType || (index === 0 ? 'activation' : 'renewal');
}
function rowFigures(row){
  const sellPlan = +row?.cost || 0;
  const whPlan = +row?.wholesale || 0;
  const msrpPlan = +row?.actual || 0;
  const sellSTB = +row?.stbCost || 0;
  const whSTB = +row?.stbWholesale || 0;
  const msrpSTB = +row?.stbActual || 0;
  const turnover = sellPlan + (row?.stbIncluded === 'yes' ? sellSTB : 0);
  const expense = whPlan + (row?.stbIncluded === 'yes' ? whSTB : 0);
  const profit = turnover - expense;
  return { turnover, expense, profit };
}
function durationForRecord(row){
  return Math.max(1, +row?.durationMonths || +plans[row?.planId]?.duration_months || 1);
}
function planKeyForRecord(row){
  const duration = durationForRecord(row);
  return String(row?.planId || `DURATION-${duration}`);
}
function recencyOpportunityWeight(expiry){
  const ageDays = Math.max(0, Math.floor((new Date() - expiry) / 86400000));
  if(ageDays <= 180) return 1;
  if(ageDays <= 365) return .75;
  return .5;
}
function forecastActivationRows(){
  const out = [];
  canonicalRenewalGroups().forEach(list=>{
    list.forEach((row, index)=>{
      if(recordKind(list, row, index) === 'activation') out.push(row);
    });
  });
  return out;
}
function forecastHistoryMonths(){
  const rows = forecastActivationRows().filter(r => isoToDate(r.startDate));
  if(!rows.length) return 0;
  const earliest = rows.map(r => isoToDate(r.startDate)).sort((a,b)=> a-b)[0];
  const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth()-1, 1);
  return Math.max(1, Math.min(12, monthsBetween(earliest, previousMonth)));
}
function activationSeries(months=12){
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  const counts = Array.from({length:months}, ()=>0);
  forecastActivationRows().forEach(row=>{
    const d = isoToDate(row.startDate);
    if(!d || d < start || d > end) return;
    const idx = monthIndexFrom(start, d);
    if(idx >= 0 && idx < counts.length) counts[idx] += 1;
  });
  return { counts, start, end };
}
function simpleExponentialLevel(values, alpha=.45){
  if(!values.length) return 0;
  let level = values[0] || 0;
  for(let i=1;i<values.length;i++) level = alpha * (+values[i] || 0) + (1-alpha) * level;
  return Math.max(0, level);
}
function newCustomerModel(){
  const series12 = activationSeries(12);
  const available = forecastHistoryMonths();
  const usable = available ? series12.counts.slice(Math.max(0, 12-available)) : series12.counts;
  const smoothed = simpleExponentialLevel(usable, .45);
  const recent3 = average(usable.slice(-3));
  const monthlyBase = usable.length ? Math.max(0, smoothed * .65 + recent3 * .35) : 0;

  const recentCutoff = new Date();
  recentCutoff.setMonth(recentCutoff.getMonth()-12);
  const recentRows = forecastActivationRows().filter(r=>{
    const d = isoToDate(r.startDate);
    return d && d >= recentCutoff;
  });
  const sourceRows = recentRows.length ? recentRows : forecastActivationRows();
  const mixCounts = new Map();
  sourceRows.forEach(r=>{
    const key = planKeyForRecord(r);
    mixCounts.set(key, (mixCounts.get(key) || 0) + 1);
  });
  if(!mixCounts.size){
    customers.forEach(c=>{
      const cp = c.currentPlan || {};
      if(!cp.planId && !cp.durationMonths) return;
      const key = planKeyForRecord(cp);
      mixCounts.set(key, (mixCounts.get(key) || 0) + 1);
    });
  }
  const totalMix = [...mixCounts.values()].reduce((a,b)=>a+b,0) || 1;
  const planMix = [...mixCounts.entries()].map(([planKey,count])=>({ planKey, share:count/totalMix }));

  return {
    monthlyBase,
    planMix,
    historyMonths:available,
    counts:series12.counts,
    sourceLabel: available >= 12 ? '12 completed months' : `${available || 0} completed month${available === 1 ? '' : 's'}`
  };
}
function forecastEconomicsByPlan(){
  const map = new Map();
  const ensure = (key, row={})=>{
    if(!map.has(key)){
      map.set(key, {
        planKey:key,
        planId:row.planId || (String(key).startsWith('DURATION-') ? '' : key),
        duration:durationForRecord(row),
        activation:[],
        renewal:[]
      });
    }
    return map.get(key);
  };

  canonicalRenewalGroups().forEach(list=>{
    list.forEach((row,index)=>{
      const key = planKeyForRecord(row);
      const entry = ensure(key,row);
      const figs = rowFigures(row);
      if(recordKind(list,row,index) === 'renewal') entry.renewal.push(figs);
      else entry.activation.push(figs);
    });
  });

  customers.forEach(c=>{
    const cp = c.currentPlan || {};
    if(!cp.planId && !cp.durationMonths) return;
    ensure(planKeyForRecord(cp), cp);
  });
  Object.entries(plans).forEach(([id,p])=> ensure(String(id), { planId:id, durationMonths:p.duration_months }));

  map.forEach(entry=>{
    const p = entry.planId ? (plans[entry.planId] || {}) : {};
    const defaultTurnover = +p.retail_price || 0;
    const defaultProfit = Math.max(0, defaultTurnover - (+p.wholesale_cost || 0));
    entry.activationTurnover = average(entry.activation.map(x=>x.turnover)) || average(entry.renewal.map(x=>x.turnover)) || defaultTurnover;
    entry.activationProfit = average(entry.activation.map(x=>x.profit)) || average(entry.renewal.map(x=>x.profit)) || defaultProfit;
    entry.renewalTurnover = average(entry.renewal.map(x=>x.turnover)) || average(entry.activation.map(x=>x.turnover)) || defaultTurnover;
    entry.renewalProfit = average(entry.renewal.map(x=>x.profit)) || average(entry.activation.map(x=>x.profit)) || defaultProfit;
  });
  return map;
}
function renewalModelStats(){
  const raw = new Map();
  const now = new Date();
  const resolvedCutoff = addDaysDate(now, -FORECAST_RENEWAL_GRACE_DAYS);
  let globalOpp = 0;
  let globalRenewed = 0;

  const ensure = duration=>{
    if(!raw.has(duration)){
      raw.set(duration, { duration, opportunities:0, renewed:0, activeCount:0, renewalRows:[] });
    }
    return raw.get(duration);
  };

  canonicalRenewalGroups().forEach(list=>{
    list.forEach((row,index)=>{
      const duration = durationForRecord(row);
      const stat = ensure(duration);
      if(recordKind(list,row,index) === 'renewal') stat.renewalRows.push(rowFigures(row));
      const expiry = isoToDate(row.expiryDate);
      if(!expiry || expiry > resolvedCutoff) return;
      const next = list[index+1];
      const weight = recencyOpportunityWeight(expiry);
      stat.opportunities += weight;
      globalOpp += weight;
      if(next){
        stat.renewed += weight;
        globalRenewed += weight;
      }
    });
  });

  customers.forEach(c=>{
    const cp = c.currentPlan || {};
    const duration = +cp.durationMonths || +plans[cp.planId]?.duration_months || 0;
    if(!duration) return;
    const stat = ensure(duration);
    if(getExpiryStatus(cp.expiryDate).key !== 'expired') stat.activeCount += 1;
  });
  Object.values(plans).forEach(p=> ensure(Math.max(1,+p.duration_months || 1)));

  const globalRate = globalOpp > 0 ? clamp(globalRenewed/globalOpp, .25, .995) : FORECAST_OTHER_FALLBACK;
  raw.forEach(stat=>{
    const observed = stat.opportunities > 0 ? stat.renewed/stat.opportunities : null;
    if(stat.duration === 1){
      const historyWeight = Math.min(.35, stat.opportunities / 40);
      stat.rate = clamp(FORECAST_MONTHLY_ASSUMPTION * (1-historyWeight) + (observed ?? FORECAST_MONTHLY_ASSUMPTION) * historyWeight, .70, .995);
      stat.source = stat.opportunities > 0 ? '99% monthly assumption + history' : '99% monthly business assumption';
    }else{
      const priorStrength = 4;
      stat.rate = clamp((stat.renewed + globalRate * priorStrength) / (stat.opportunities + priorStrength), .20, .995);
      stat.source = stat.opportunities > 0 ? 'Plan history, smoothed for small samples' : 'Overall renewal history fallback';
    }
    stat.observedRate = observed;
  });
  return { byDuration:raw, globalRate, totalOpportunities:globalOpp, totalRenewed:globalRenewed };
}
function scenarioConfig(key){
  return {
    conservative:{ label:'Conservative', newFactor:.80, renewalMode:'down' },
    expected:{ label:'Expected', newFactor:1, renewalMode:'base' },
    growth:{ label:'Growth', newFactor:1.20, renewalMode:'up' }
  }[key] || { label:'Expected', newFactor:1, renewalMode:'base' };
}
function scenarioRenewalRate(baseRate, scenarioKey){
  if(scenarioKey === 'conservative') return clamp(baseRate - Math.max(.05, (1-baseRate)*.35), .05, .995);
  if(scenarioKey === 'growth') return clamp(baseRate + (1-baseRate)*.35, .05, .995);
  return clamp(baseRate, .05, .995);
}
function makeForecastRows(monthsAhead){
  const start = startOfMonthDate(new Date());
  return Array.from({length:monthsAhead}, (_,index)=>{
    const monthStart = addMonthsDate(start,index);
    return {
      index,
      key:monthKeyFromDate(monthStart),
      label:monthLabelFromDate(monthStart),
      monthStart,
      expiring:0,
      overdue:0,
      expectedRenewals:0,
      newCustomers:0,
      activationRevenue:0,
      activationProfit:0,
      renewalRevenue:0,
      renewalProfit:0,
      revenue:0,
      profit:0
    };
  });
}
function forecastPlanMeta(planKey, economics){
  if(economics.has(planKey)) return economics.get(planKey);
  const durationMatch = String(planKey).match(/^DURATION-(\d+)$/);
  const duration = durationMatch ? +durationMatch[1] : Math.max(1,+plans[planKey]?.duration_months || 1);
  const p = plans[planKey] || {};
  const turnover = +p.retail_price || 0;
  return {
    planKey,
    planId:String(planKey).startsWith('DURATION-') ? '' : planKey,
    duration,
    activationTurnover:turnover,
    activationProfit:Math.max(0, turnover-(+p.wholesale_cost || 0)),
    renewalTurnover:turnover,
    renewalProfit:Math.max(0, turnover-(+p.wholesale_cost || 0))
  };
}

export function buildForecastScenario(monthsAhead, scenarioKey='expected'){
  const rows = makeForecastRows(monthsAhead);
  const startMonth = rows[0]?.monthStart || startOfMonthDate(new Date());
  const economics = forecastEconomicsByPlan();
  const renewalStats = renewalModelStats();
  const newModel = newCustomerModel();
  const scenario = scenarioConfig(scenarioKey);

  const addFutureRenewalStream = ({ dueDate, duration, survival, planKey })=>{
    let due = new Date(dueDate);
    let probability = Math.max(0, survival || 0);
    const meta = forecastPlanMeta(planKey, economics);
    const stat = renewalStats.byDuration.get(duration);
    const baseRate = stat?.rate ?? (duration === 1 ? FORECAST_MONTHLY_ASSUMPTION : renewalStats.globalRate);
    const rate = scenarioRenewalRate(baseRate, scenarioKey);

    while(probability >= .01){
      const idx = monthIndexFrom(startMonth, due);
      if(idx >= monthsAhead) break;
      if(idx >= 0){
        rows[idx].expiring += probability;
        const expected = probability * rate;
        rows[idx].expectedRenewals += expected;
        rows[idx].renewalRevenue += expected * meta.renewalTurnover;
        rows[idx].renewalProfit += expected * meta.renewalProfit;
        probability = expected;
      }
      due = addMonthsDate(due, duration);
      if(idx < 0 && due < startMonth) continue;
    }
  };

  customers.forEach(c=>{
    const cp = c.currentPlan || {};
    const duration = Math.max(1, +cp.durationMonths || +plans[cp.planId]?.duration_months || 0);
    const expiry = isoToDate(cp.expiryDate);
    if(!duration || !expiry) return;
    const planKey = planKeyForRecord(cp);

    if(expiry < startMonth){
      const overdueDays = Math.floor((startMonth - expiry) / 86400000);
      if(overdueDays > FORECAST_RECENT_EXPIRED_DAYS) return;
      const stat = renewalStats.byDuration.get(duration);
      const baseRate = stat?.rate ?? (duration === 1 ? FORECAST_MONTHLY_ASSUMPTION : renewalStats.globalRate);
      const recoveryRate = scenarioRenewalRate(baseRate, scenarioKey) * .65;
      const meta = forecastPlanMeta(planKey, economics);
      rows[0].overdue += 1;
      rows[0].expectedRenewals += recoveryRate;
      rows[0].renewalRevenue += recoveryRate * meta.renewalTurnover;
      rows[0].renewalProfit += recoveryRate * meta.renewalProfit;
      addFutureRenewalStream({
        dueDate:addMonthsDate(startMonth,duration),
        duration,
        survival:recoveryRate,
        planKey
      });
      return;
    }

    addFutureRenewalStream({ dueDate:expiry, duration, survival:1, planKey });
  });

  rows.forEach((row)=>{
    const expectedNew = newModel.monthlyBase * scenario.newFactor;
    row.newCustomers += expectedNew;
    newModel.planMix.forEach(mix=>{
      const count = expectedNew * mix.share;
      const meta = forecastPlanMeta(mix.planKey, economics);
      row.activationRevenue += count * meta.activationTurnover;
      row.activationProfit += count * meta.activationProfit;
      addFutureRenewalStream({
        dueDate:addMonthsDate(row.monthStart,meta.duration),
        duration:meta.duration,
        survival:count,
        planKey:mix.planKey
      });
    });
  });

  rows.forEach(row=>{
    row.revenue = row.activationRevenue + row.renewalRevenue;
    row.profit = row.activationProfit + row.renewalProfit;
  });

  const totals = rows.reduce((acc,row)=>{
    acc.expiring += row.expiring;
    acc.overdue += row.overdue;
    acc.expectedRenewals += row.expectedRenewals;
    acc.newCustomers += row.newCustomers;
    acc.revenue += row.revenue;
    acc.profit += row.profit;
    return acc;
  }, { expiring:0, overdue:0, expectedRenewals:0, newCustomers:0, revenue:0, profit:0 });

  const quality = newModel.historyMonths >= 12 && renewalStats.totalOpportunities >= 20
    ? { key:'high', label:'Higher confidence' }
    : (newModel.historyMonths >= 6 || renewalStats.totalOpportunities >= 8)
      ? { key:'medium', label:'Medium confidence' }
      : { key:'low', label:'Early estimate' };

  return { rows, totals, newModel, renewalStats, economics, quality, scenario, monthsAhead };
}

export function forecastPeriodMonths(key){
  return { month:1, six:6, year:12, five:60 }[key] || 1;
}
export function forecastPeriodLabel(key){
  return { month:'This Month', six:'Next 6 Months', year:'Next 12 Months', five:'Next 5 Years' }[key] || 'This Month';
}
export function peopleNumber(value){
  const n = +value || 0;
  return n >= 10 ? n.toFixed(0) : n.toFixed(1);
}

export function forecastPlanRateCards(model){
  const rates = [...model.renewalStats.byDuration.values()].sort((a,b)=>a.duration-b.duration);
  if(!rates.length) return `<div class="empty-state">No plan history found yet.</div>`;
  return rates.map(stat=>`
    <div class="plan-rate-item">
      <div class="metric-top">
        <strong>${stat.duration === 1 ? 'Monthly plan' : `${stat.duration}-month plan`}</strong>
        <strong>${(stat.rate*100).toFixed(1)}%</strong>
      </div>
      <div class="helper">Renews every ${stat.duration === 1 ? 'month' : `${stat.duration} months`} • Active now: ${stat.activeCount}</div>
      <div class="track" style="margin-top:10px"><div class="fill" style="width:${metricWidth(stat.rate,1)}%"></div></div>
      <div class="helper" style="margin-top:10px">${esc(stat.source)} • Resolved opportunities: ${stat.opportunities.toFixed(1)}</div>
    </div>
  `).join('');
}

export function forecastMonthlyTableRows(rows){
  return rows.map(row=>`
    <tr>
      <td><strong>${esc(row.label)}</strong></td>
      <td>${peopleNumber(row.expiring)}</td>
      <td>${peopleNumber(row.overdue)}</td>
      <td>${peopleNumber(row.expectedRenewals)}</td>
      <td>${peopleNumber(row.newCustomers)}</td>
      <td>${fmt(row.revenue)}</td>
      <td>${fmt(row.profit)}</td>
    </tr>
  `).join('');
}

export function forecastMobileCards(rows){
  return rows.map(row=>`
    <div class="forecast-mobile-card">
      <div class="forecast-mobile-head">
        <strong>${esc(row.label)}</strong>
        <span class="chip">${fmt(row.revenue)}</span>
      </div>
      <div class="forecast-mobile-grid">
        <div class="forecast-mobile-stat"><span>Expiring</span><strong>${peopleNumber(row.expiring)}</strong></div>
        <div class="forecast-mobile-stat"><span>Expected renewals</span><strong>${peopleNumber(row.expectedRenewals)}</strong></div>
        <div class="forecast-mobile-stat"><span>New customers</span><strong>${peopleNumber(row.newCustomers)}</strong></div>
        <div class="forecast-mobile-stat"><span>Expected profit</span><strong>${fmt(row.profit)}</strong></div>
      </div>
      ${row.overdue > 0 ? `<div class="helper" style="margin-top:9px">Includes ${peopleNumber(row.overdue)} recently expired follow-up opportunit${row.overdue === 1 ? 'y' : 'ies'}.</div>` : ''}
    </div>
  `).join('');
}

export function renderForecast(){
  const forecast = $("#tab-forecast");
  if(!forecast) return;
  const monthsAhead = forecastPeriodMonths(forecastPeriodKey);
  const expected = buildForecastScenario(monthsAhead,'expected');
  const conservative = buildForecastScenario(monthsAhead,'conservative');
  const growth = buildForecastScenario(monthsAhead,'growth');
  const selected = forecastScenarioKey === 'conservative' ? conservative : forecastScenarioKey === 'growth' ? growth : expected;
  const visibleRows = (forecastPeriodKey === 'five' && !forecastShowAllMonths) ? selected.rows.slice(0,12) : selected.rows;
  const maxRevenue = Math.max(...visibleRows.map(r=>r.revenue),1);
  const avgMonthlyRevenue = selected.totals.revenue / Math.max(1,monthsAhead);
  const avgMonthlyProfit = selected.totals.profit / Math.max(1,monthsAhead);

  forecast.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Forecast</h2>
          <div class="helper">Read-only projection. It uses your existing customers, expiry dates, renewal history, prices and plan duration. It does not change or migrate Firebase data.</div>
        </div>
        <span class="forecast-quality">${esc(selected.quality.label)}</span>
      </div>

      <div class="forecast-shell">
        <div>
          <div class="helper" style="margin-bottom:7px">Forecast period</div>
          <div class="forecast-btn-grid">
            <button class="btn ${forecastPeriodKey === 'month' ? 'ok' : 'ghost'}" data-forecast-period="month" type="button">This Month</button>
            <button class="btn ${forecastPeriodKey === 'six' ? 'ok' : 'ghost'}" data-forecast-period="six" type="button">6 Months</button>
            <button class="btn ${forecastPeriodKey === 'year' ? 'ok' : 'ghost'}" data-forecast-period="year" type="button">1 Year</button>
            <button class="btn ${forecastPeriodKey === 'five' ? 'ok' : 'ghost'}" data-forecast-period="five" type="button">5 Years</button>
          </div>
        </div>

        <div>
          <div class="helper" style="margin-bottom:7px">Scenario</div>
          <div class="forecast-scenario-grid">
            <button class="btn ${forecastScenarioKey === 'conservative' ? 'warn' : 'ghost'}" data-forecast-scenario="conservative" type="button">Conservative</button>
            <button class="btn ${forecastScenarioKey === 'expected' ? 'ok' : 'ghost'}" data-forecast-scenario="expected" type="button">Expected</button>
            <button class="btn ${forecastScenarioKey === 'growth' ? '' : 'ghost'}" data-forecast-scenario="growth" type="button">Growth</button>
          </div>
        </div>

        <div class="forecast-main-card">
          <div class="flex" style="justify-content:space-between">
            <div>
              <div class="chip">${esc(forecastPeriodLabel(forecastPeriodKey))}</div>
              <div class="forecast-main-label">${esc(selected.scenario.label)} revenue forecast</div>
              <div class="forecast-main-value">${fmt(selected.totals.revenue)}</div>
            </div>
            <div class="right">
              <div class="forecast-main-label">Expected profit</div>
              <div class="forecast-big">${fmt(selected.totals.profit)}</div>
            </div>
          </div>

          <div class="forecast-range">
            <div>
              <strong>${fmt(conservative.totals.revenue)} – ${fmt(growth.totals.revenue)}</strong>
              <span>Revenue range across conservative and growth scenarios</span>
            </div>
            <div>
              <strong>${fmt(conservative.totals.profit)} – ${fmt(growth.totals.profit)}</strong>
              <span>Profit range across conservative and growth scenarios</span>
            </div>
          </div>
        </div>

        <div class="forecast-summary-grid">
          <div class="forecast-summary-card">
            <div class="forecast-summary-label">Scheduled expiries</div>
            <div class="forecast-summary-value">${peopleNumber(selected.totals.expiring)}</div>
            <div class="forecast-summary-sub">Includes repeat future due dates after expected renewals.</div>
          </div>
          <div class="forecast-summary-card">
            <div class="forecast-summary-label">Expected renewals</div>
            <div class="forecast-summary-value">${peopleNumber(selected.totals.expectedRenewals)}</div>
            <div class="forecast-summary-sub">Monthly renews monthly; yearly renews yearly.</div>
          </div>
          <div class="forecast-summary-card">
            <div class="forecast-summary-label">Expected new customers</div>
            <div class="forecast-summary-value">${peopleNumber(selected.totals.newCustomers)}</div>
            <div class="forecast-summary-sub">${esc(selected.newModel.sourceLabel)} with recent months weighted more.</div>
          </div>
          <div class="forecast-summary-card">
            <div class="forecast-summary-label">Average monthly revenue</div>
            <div class="forecast-summary-value">${fmt(avgMonthlyRevenue)}</div>
            <div class="forecast-summary-sub">Selected scenario average.</div>
          </div>
          <div class="forecast-summary-card">
            <div class="forecast-summary-label">Average monthly profit</div>
            <div class="forecast-summary-value">${fmt(avgMonthlyProfit)}</div>
            <div class="forecast-summary-sub">${peopleNumber(selected.totals.overdue)} recently expired follow-ups included.</div>
          </div>
        </div>

        <div class="row">
          <div class="col">
            <div class="forecast-card">
              <div class="section-title">
                <div>
                  <h3>Monthly outlook</h3>
                  <div class="helper">Revenue by calendar month for the selected scenario.</div>
                </div>
              </div>
              <div class="forecast-month-chart">
                ${visibleRows.map(row=>`
                  <div class="forecast-month-row">
                    <div class="forecast-month-name">${esc(row.label)}</div>
                    <div class="forecast-month-bar"><div class="forecast-month-fill" style="width:${metricWidth(row.revenue,maxRevenue)}%"></div></div>
                    <div class="forecast-month-money">${fmt(row.revenue)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="col">
            <div class="forecast-card">
              <h3 style="margin-top:0">Renewal cycle by plan</h3>
              <div class="helper">The model schedules each customer again only after their own plan duration. Your 1-month plan starts from a 99% monthly renewal assumption and blends in recorded history.</div>
              <div class="plan-rate-list">${forecastPlanRateCards(selected)}</div>
            </div>
          </div>
        </div>

        <div class="forecast-card">
          <div class="section-title">
            <div>
              <h3>Month-by-month forecast</h3>
              <div class="helper">Scheduled expiries, expected renewals, expected new customers, revenue and profit.</div>
            </div>
            ${forecastPeriodKey === 'five' ? `<button id="toggleForecastMonths" class="btn ghost" type="button">${forecastShowAllMonths ? 'Show First 12 Months' : 'Show All 60 Months'}</button>` : ''}
          </div>

          <div class="forecast-table-desktop table-scroll">
            <table class="grid" style="min-width:860px">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Expiring</th>
                  <th>Overdue follow-up</th>
                  <th>Expected renewals</th>
                  <th>New customers</th>
                  <th>Revenue</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>${forecastMonthlyTableRows(visibleRows)}</tbody>
            </table>
          </div>
          <div class="forecast-mobile-list">${forecastMobileCards(visibleRows)}</div>
        </div>

        <div class="forecast-method-grid">
          <div class="detail-box">
            <div class="detail-label">New-customer baseline</div>
            <div class="detail-value">${peopleNumber(selected.newModel.monthlyBase)} / month</div>
            <div class="helper" style="margin-top:6px">Exponential smoothing gives more weight to recent completed months.</div>
          </div>
          <div class="detail-box">
            <div class="detail-label">Renewal evidence</div>
            <div class="detail-value">${selected.renewalStats.totalOpportunities.toFixed(1)} resolved opportunities</div>
            <div class="helper" style="margin-top:6px">Very recent expiries get a grace period before being treated as non-renewals.</div>
          </div>
          <div class="detail-box">
            <div class="detail-label">Data safety</div>
            <div class="detail-value">Read-only calculation</div>
            <div class="helper" style="margin-top:6px">No new collection, migration, deletion or forecast write-back.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  forecast.querySelectorAll('[data-forecast-period]').forEach(btn=>{
    btn.onclick = ()=>{
      forecastPeriodKey = btn.dataset.forecastPeriod;
      forecastShowAllMonths = false;
      renderForecast();
    };
  });
  forecast.querySelectorAll('[data-forecast-scenario]').forEach(btn=>{
    btn.onclick = ()=>{
      forecastScenarioKey = btn.dataset.forecastScenario;
      renderForecast();
    };
  });
  const toggleMonths = $("#toggleForecastMonths");
  if(toggleMonths){
    toggleMonths.onclick = ()=>{
      forecastShowAllMonths = !forecastShowAllMonths;
      renderForecast();
    };
  }
}
