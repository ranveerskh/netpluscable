import { esc, fmt, toast, calcFigures, showErr } from "./utils.js";
import { customers } from "./customers.js";

export const LOGO_URL = "assets/logo.svg";

export function buildSlipHTML({invNo, today, billTo, contactLine, metaLine, plan, lines, total, paidBadge, discountBlock}){
  return `<!doctype html><html><head><meta charset="utf-8"><title>${invNo}</title><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{ --ink:#111; --muted:#666; --line:#e5e7eb; --bg:#fff; --pill:#f3f4f6; --ok:#16a34a; --warn:#b91c1c; --safe-bottom: env(safe-area-inset-bottom,0px); }*{ box-sizing:border-box } body{ font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial; color:var(--ink); background:#fff; margin:24px; padding-bottom: calc(24px + var(--safe-bottom)); }.hdr{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap }.brand{ display:flex; gap:12px; align-items:center } .brand img{ height:42px } .brand h2{ margin:0; font-size:22px }.muted{ color:var(--muted) } .box{ border:1px solid var(--line); border-radius:10px; padding:14px; margin-top:14px }.grid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px 16px; }.grid .lbl{ color:var(--muted) } table{ width:100%; border-collapse:collapse; margin-top:12px } th,td{ padding:10px; border-bottom:1px solid var(--line); text-align:left; font-size:14px } th{ background:#fafafa }.right{ text-align:right } .totals td{ font-weight:700 } .badge{ display:inline-block; background:var(--pill); padding:4px 8px; border-radius:999px; font-size:12px }.paid{ color:var(--ok) } .unpaid{ color:var(--warn) } .strike{ text-decoration: line-through; opacity:.7; margin-right:6px } @media print{ button{ display:none } body{ margin:0; } }</style></head><body><div class="hdr"><div class="brand"><img src="${LOGO_URL}" alt="Net + TV"><div><h2 style="margin:0">Sale Slip</h2><div class="muted">Net + TV</div></div></div><div class="right"><div><strong>${invNo}</strong></div><div>Date: ${today}</div></div></div><div class="box"><strong>Bill To</strong><br>${billTo}<br>${contactLine}${metaLine ? `<div class="muted">${metaLine}</div>` : ""}</div><div class="box"><strong>Plan Details</strong><div class="grid" style="margin-top:8px"><div class="lbl">Plan</div><div>${plan?.name || '-'}</div><div class="lbl">Duration</div><div>${(plan?.months ?? 0)} months</div><div class="lbl">Parental Pin</div><div>7274</div><div class="lbl">Start Date</div><div>${plan?.start || '-'}</div><div class="lbl">Expiry Date</div><div>${plan?.expiry || '-'}</div><div class="lbl">Payment</div><div>${plan?.paidText || '-'}</div></div></div><table><thead><tr><th>Description</th><th class="right">Amount (CAD)</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${l[0]}</td><td class="right">${(+l[1]||0).toFixed(2)}</td></tr>`).join("")}${discountBlock || ""}<tr class="totals"><td>Total</td><td class="right">${(+total||0).toFixed(2)}</td></tr></tbody></table><div class="badge ${plan?.paidText==='Paid'?'paid':'unpaid'}" style="margin-top:8px">${paidBadge}</div><p class="muted">Thank you.</p><button onclick="window.print()">Print / Save as PDF</button></body></html>`;
}

export function openPrintWindow(html){
  const w = window.open("", "_blank");
  if(!w){ toast("Pop-up blocked. Please allow pop-ups for this site.", "warn", 3600); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = ()=> w.print();
}

export function printInvoice(customerId){
  const c = customers.find(x=> String(x.id) === String(customerId));
  if(!c){ toast("Customer not found.", "error"); return; }
  const p = c.currentPlan || {};
  const f = calcFigures({ cost:p.cost, wholesale:p.wholesale, actual:p.actual, stbIncluded:p.stbIncluded, stbCost:p.stbCost, stbWholesale:p.stbWholesale, stbActual:p.stbActual });
  const today = new Date().toISOString().slice(0,10);
  const invNo = `SLIP-${String(customerId).slice(-6).toUpperCase()}-${today.replaceAll('-','')}`;
  const planBlock = { name: `${p.planName || 'Plan'}`, months: +p.durationMonths || 0, start: p.startDate || '-', expiry: p.expiryDate || '-', paidText: (p.paymentReceived === 'yes' ? 'Paid' : 'Unpaid') };
  const lines = [];
  const planLineLabel = `Plan — ${esc(p.planName || 'Plan')} (${esc(p.durationMonths || 0)} mo)`;
  if(+p.actual > 0){ lines.push([`${planLineLabel} <span class="muted"><span class="strike">${fmt(+p.actual)}</span> now</span>`, +p.cost || 0]); }
  else { lines.push([planLineLabel, +p.cost || 0]); }
  if(p.stbIncluded === 'yes'){
    if(+p.stbActual > 0) lines.push([`STB <span class="muted"><span class="strike">${fmt(+p.stbActual)}</span> now</span>`, +p.stbCost || 0]);
    else lines.push([`STB`, +p.stbCost || 0]);
  }
  const discountName = (p.discountName || "").trim();
  const discountBlock = (f.discountSaved > 0) ? `<tr><td>${discountName ? `Discount — ${esc(discountName)}` : 'Discount'}</td><td class="right">-${f.discountSaved.toFixed(2)}</td></tr>` : "";
  const html = buildSlipHTML({ invNo, today, billTo: esc(c.name || "-"), contactLine: esc([c.phone, c.email].filter(Boolean).join(" • ") || ""), metaLine: esc([c.userId && `User ID: ${c.userId}`, c.mac && `MAC: ${c.mac}`].filter(Boolean).join(" • ")), plan: planBlock, lines, total: f.turnover, paidBadge: (p.paymentReceived === 'yes' ? 'Paid' : 'Unpaid'), discountBlock });
  openPrintWindow(html);
}

export function printInvoiceFromRenewalData(encoded){
  try{
    const ren = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    const c = customers.find(x=> String(x.id) === String(ren.customerId)) || {};
    const f = calcFigures({ cost:ren.cost, wholesale:ren.wholesale, actual:ren.actual, stbIncluded:ren.stbIncluded, stbCost:ren.stbCost, stbWholesale:ren.stbWholesale, stbActual:ren.stbActual });
    const today = new Date().toISOString().slice(0,10);
    const suffix = ren.id ? ren.id.slice(-6).toUpperCase() : (ren.startDate?.replaceAll('-','') || today.replaceAll('-',''));
    const invNo = `SLIP-${String(ren.customerId).slice(-6).toUpperCase()}-${suffix}`;
    const planBlock = { name:`${ren.planName || 'Plan'}`, months:+ren.durationMonths || 0, start:ren.startDate || '-', expiry:ren.expiryDate || '-', paidText:(ren.paymentReceived === 'yes' ? 'Paid' : 'Unpaid') };
    const lines = [];
    const planLineLabel = `Plan — ${esc(ren.planName || ren.planId || 'Plan')} (${esc(ren.durationMonths || 0)} mo)`;
    if(+ren.actual > 0) lines.push([`${planLineLabel} <span class="muted"><span class="strike">${fmt(+ren.actual)}</span> now</span>`, +ren.cost || 0]);
    else lines.push([planLineLabel, +ren.cost || 0]);
    if(ren.stbIncluded === 'yes'){
      if(+ren.stbActual > 0) lines.push([`STB <span class="muted"><span class="strike">${fmt(+ren.stbActual)}</span> now</span>`, +ren.stbCost || 0]);
      else lines.push([`STB`, +ren.stbCost || 0]);
    }
    const discountName = (ren.discountName || "").trim();
    const discountBlock = (f.discountSaved > 0) ? `<tr><td>${discountName ? `Discount — ${esc(discountName)}` : 'Discount'}</td><td class="right">-${f.discountSaved.toFixed(2)}</td></tr>` : "";
    const html = buildSlipHTML({ invNo, today, billTo: esc(ren.customerName || c.name || "-"), contactLine: esc([c.phone, c.email].filter(Boolean).join(" • ") || ""), metaLine: esc([c.userId && `User ID: ${c.userId}`, c.mac && `MAC: ${c.mac}`].filter(Boolean).join(" • ")), plan: planBlock, lines, total: f.turnover, paidBadge: (ren.paymentReceived === 'yes' ? 'Paid' : 'Unpaid'), discountBlock });
    openPrintWindow(html);
  }catch(e){
    showErr('[print from renewal]', e);
    toast("Could not open slip for this row.", "error");
  }
}
