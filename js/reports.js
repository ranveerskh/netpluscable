import { $, esc, fmt, calcFigures } from "./utils.js";
import { canonicalRenewalGroups } from "./renewals.js";
import { setEmptyRow } from "./plans.js";
import { printInvoiceFromRenewalData } from "./invoices.js";

export function onRepTypeChange(){
  const t = $("#repType").value;
  $("#repMonthCol").classList.toggle('hidden', t !== "monthly");
  $("#repYearCol").classList.toggle('hidden', t !== "yearly");
  $("#repFromCol").classList.toggle('hidden', t !== "custom");
  $("#repToCol").classList.toggle('hidden', t !== "custom");
}

export function filteredCanonicalRenewals(){
  const grouped = canonicalRenewalGroups();
  const rows = [];
  grouped.forEach(list => list.forEach(r => rows.push(r)));
  return rows;
}

export function filterRenewalsByPeriod(){
  const t = $("#repType").value;
  let from, to;
  if(t === "monthly"){
    let ym = $("#repMonth").value || new Date().toISOString().slice(0,7);
    $("#repMonth").value = ym;
    from = ym + "-01";
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    to = ym + "-" + String(last).padStart(2, "0");
  }else if(t === "yearly"){
    const y = +$("#repYear").value;
    if(!y) return {arr: [], from: undefined, to: undefined};
    from = y + "-01-01"; to = y + "-12-31";
  }else{
    from = $("#repFrom").value; to = $("#repTo").value; if(!from || !to) return {arr: [], from: undefined, to: undefined};
  }
  const arr = filteredCanonicalRenewals().filter(r => r.startDate >= from && r.startDate <= to);
  return {arr, from, to};
}

export function runReport(){
  const out = filterRenewalsByPeriod();
  const tbody = $("#repGrid tbody");
  if(!tbody) return;
  tbody.innerHTML = "";
  if(!out || !out.arr){
    setEmptyRow(tbody, 8, "Select a valid period.");
    $("#repTurnover").textContent = fmt(0);
    $("#repExpense").textContent = fmt(0);
    $("#repProfit").textContent = fmt(0);
    return;
  }
  const rows = out.arr.sort((a,b)=> a.startDate.localeCompare(b.startDate));
  let T = 0, E = 0, P = 0;
  if(!rows.length){
    setEmptyRow(tbody, 8, "No renewals found in this period.");
    $("#repTurnover").textContent = fmt(0);
    $("#repExpense").textContent = fmt(0);
    $("#repProfit").textContent = fmt(0);
    return;
  }
  rows.forEach(r=>{
    const f = calcFigures({ cost:r.cost, wholesale:r.wholesale, actual:r.actual, stbIncluded:r.stbIncluded, stbCost:r.stbCost, stbWholesale:r.stbWholesale, stbActual:r.stbActual });
    T += f.turnover; E += f.expense; P += f.profit;
    const payload = { id:r.id, customerId:r.customerId, customerName:r.customerName, planId:r.planId, planName:r.planName, durationMonths:r.durationMonths, actual:r.actual, cost:r.cost, wholesale:r.wholesale, stbIncluded:r.stbIncluded, stbActual:r.stbActual, stbCost:r.stbCost, stbWholesale:r.stbWholesale, discountName:r.discountName, startDate:r.startDate, expiryDate:r.expiryDate, paymentReceived:r.paymentReceived };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.startDate)}</td>
      <td>${esc(r.customerName || r.customerId)}</td>
      <td>${esc(r.planName || r.planId)} (${esc(r.durationMonths || 0)}mo)</td>
      <td>${f.turnover.toFixed(2)}</td>
      <td>${f.expense.toFixed(2)}</td>
      <td>${f.profit.toFixed(2)}</td>
      <td>${r.paymentReceived === 'yes' ? 'Yes' : 'No'}</td>
      <td><button class="btn" data-inv-ren="${encoded}">Slip</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("[data-inv-ren]").forEach(btn=>{
    btn.onclick = ()=> printInvoiceFromRenewalData(btn.getAttribute("data-inv-ren"));
  });
  $("#repTurnover").textContent = fmt(T);
  $("#repExpense").textContent = fmt(E);
  $("#repProfit").textContent = fmt(P);
}

export function exportCSV(){
  const rows = [["Date","Customer","Plan","Turnover","Expense","Profit","Paid"]];
  document.querySelectorAll("#repGrid tbody tr").forEach(tr=>{
    const cols = [...tr.children].slice(0,7).map(td => td.textContent.trim());
    if(cols.some(Boolean)) rows.push(cols);
  });
  const csvStr = "\uFEFF" + rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csvStr], { type: "text/csv;charset=utf-8;" });
  const canDownloadAttr = "download" in HTMLAnchorElement.prototype;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if(canDownloadAttr && !isIOS){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }else{
    const dataUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csvStr);
    window.open(dataUrl, "_blank");
  }
}
