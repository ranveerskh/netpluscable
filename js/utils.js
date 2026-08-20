export const $ = sel => document.querySelector(sel);
export const $$ = sel => document.querySelectorAll(sel);
export const fmt = n => (isNaN(+n) ? '$0.00' : '$' + (+n).toFixed(2));
export const todayISO = () => new Date().toISOString().slice(0,10);

export function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[s]));
}

export function toast(message, type='info', timeout=2800){
  const toastWrap = $("#toastWrap");
  if(!toastWrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastWrap.appendChild(el);
  setTimeout(()=> {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(()=> el.remove(), 220);
  }, timeout);
}

export function addMonthsISO(startISO, months){
  if (!startISO) return "";
  const d = new Date(startISO + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 0));
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0,10);
}

export function daysLeft(expISO){
  if(!expISO) return Number.POSITIVE_INFINITY;
  const end = new Date(expISO + "T23:59:59");
  const now = new Date();
  return Math.ceil((end - now) / (1000*60*60*24));
}

export function calcFigures({ cost, wholesale, actual, stbIncluded, stbCost, stbWholesale, stbActual }){
  const sellPlan = +cost || 0;
  const whPlan = +wholesale || 0;
  const msrpPlan = +actual || 0;
  const sellSTB = +stbCost || 0;
  const whSTB = +stbWholesale || 0;
  const msrpSTB = +stbActual || 0;
  const turnover = sellPlan + (stbIncluded === 'yes' ? sellSTB : 0);
  const expense = whPlan + (stbIncluded === 'yes' ? whSTB : 0);
  const profit = turnover - expense;
  const discountSaved = Math.max(msrpPlan - sellPlan, 0) + (stbIncluded === 'yes' ? Math.max(msrpSTB - sellSTB, 0) : 0);
  return { turnover, expense, profit, discountSaved };
}

export function normalizeEmail(email){ return String(email || '').trim().toLowerCase(); }
export function isValidEmail(email){ if(!email) return true; return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)); }
export function isValidMac(mac){ if(!mac) return true; return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(String(mac).trim()); }
export function nonNegativeNumber(v){ return !isNaN(+v) && +v >= 0; }

export function suggestOffer({ tenureDays, renewalCount, totalSpent, statusKey }){
  if(statusKey === 'expired' && (renewalCount >= 3 || tenureDays >= 365)) return 'Win-back offer';
  if(renewalCount >= 6 || totalSpent >= 200) return 'VIP loyalty offer';
  if(tenureDays >= 365) return '1-year loyalty deal';
  if(statusKey === 'near') return 'Early renewal offer';
  return 'Standard renewal offer';
}

export function showErr(label, err){ console.error(label, err); }
export function metricWidth(value, max){ if(max <= 0) return 8; return Math.max(8, Math.min(100, (value / max) * 100)); }
export function monthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
export function addMonthsDate(date, months){ const d = new Date(date); const day = d.getDate(); d.setMonth(d.getMonth() + months); if(d.getDate() !== day) d.setDate(0); return d; }

export function monthsBetween(start, end){
  let count = 0;
  let cursor = monthStart(new Date(start));
  const limit = monthStart(new Date(end));
  while(cursor <= limit){ count += 1; cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); }
  return Math.max(1, count);
}

export function firstDayOfCurrentMonth(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfCurrentMonth(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth()+1, 0); }
export function isoToDate(iso){ return iso ? new Date(iso + 'T00:00:00') : null; }
export function dateToISO(d){ return new Date(d).toISOString().slice(0,10); }
export function clamp(num, min, max){ return Math.min(max, Math.max(min, num)); }
export function average(arr){ return arr.length ? arr.reduce((a,b)=> a + b, 0) / arr.length : 0; }

export function setupIosTweaks(){
  const useVV = window.visualViewport;
  if (useVV) {
    const onVVChange = () => { document.body.style.paddingBottom = `calc(${useVV.height < window.innerHeight ? '20vh' : '12px'} + var(--safe-bottom))`; };
    useVV.addEventListener('resize', onVVChange);
    useVV.addEventListener('scroll', onVVChange);
  }
  document.addEventListener('focusin', (e)=>{
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      setTimeout(()=> el.scrollIntoView({ block:'center', behavior:'smooth' }), 100);
    }
  }, {passive:true});
}
