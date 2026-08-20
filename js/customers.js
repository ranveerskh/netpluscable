import { db, doc, collection, query, orderBy, safeGetDocs, safeAddDoc, safeUpdateDoc, writeBatch, serverTimestamp } from "./firebase.js";
import { $, esc, toast, todayISO, addMonthsISO, daysLeft, calcFigures, normalizeEmail, isValidEmail, isValidMac, nonNegativeNumber, showErr } from "./utils.js";
import { plans, refreshPlanSelects } from "./plans.js";
import { loadRenewals, addRenewal, getLatestRenewalDoc, invalidateAnalyticsCache, customerHistory, openRenewModal } from "./renewals.js";
import { isDemoMode, settingNear, renderAll } from "./app.js";
import { detailGridHtml, accordionState } from "./dashboard.js";
import { printInvoice } from "./invoices.js";

export let customers = [];
export let editCustomerId = null;
export let customerSortMode = 'expirySoon';

window.customerSearchValue = '';
window.customerTimeFilter = 'currentYear';
window.customerStatusFilter = 'all';
window.customerExpiryFilter = 'all';
window.showOlderExpired = false;
window.customerSearchTimer = null;

export async function loadCustomers(){
  customers = [];
  const snap = await safeGetDocs(query(collection(db,"customers"), orderBy("name")), '[customers] getDocs');
  snap.forEach(d=> customers.push({id:d.id, ...d.data()}) );
  invalidateAnalyticsCache();
}

export async function saveCustomer(payload, existingId=null){
  if(existingId){
    const idStr = String(existingId);
    const ref = doc(db,"customers", idStr);
    payload.updatedAt = serverTimestamp();
    await safeUpdateDoc(ref, payload, '[customers] updateDoc');
    await loadCustomers();
    return idStr;
  }else{
    const ref = await safeAddDoc(collection(db,"customers"), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, '[customers] addDoc');
    await loadCustomers();
    return String(ref.id);
  }
}

export async function deleteCustomerAndRenewals(customerId){
  const idStr = String(customerId);
  const renSnap = await safeGetDocs(collection(db, "customers", idStr, "renewals"), '[renewals] list before delete');
  const batch = writeBatch(db);
  renSnap.forEach(d => batch.delete(doc(db, "customers", idStr, "renewals", d.id)));
  batch.delete(doc(db, "customers", idStr));
  await batch.commit();
  await loadCustomers();
  await loadRenewals();
  renderAll();
}

export function getExpiryStatus(expISO){
  if(!expISO) return { key:'unknown', label:'No expiry', cls:'badge-muted', days:null };
  const d = daysLeft(expISO);
  if(d < 0) return { key:'expired', label:`Expired ${Math.abs(d)}d`, cls:'badge-exp', days:d };
  if(d <= settingNear) return { key:'near', label:`Expiring soon • ${d}d`, cls:'badge-warn', days:d };
  return { key:'active', label:`Active • ${d}d`, cls:'badge-ok', days:d };
}

export function getPaidBadge(v){
  return v === 'yes' ? `<span class="mini-badge badge-ok">Paid</span>` : `<span class="mini-badge badge-warn">Unpaid</span>`;
}

export function customerSummary(c){
  const currentPlan = c.currentPlan || {};
  const status = getExpiryStatus(currentPlan.expiryDate);
  const history = customerHistory(c.id);
  const tenureDays = history.firstDate ? Math.max(0, Math.floor((new Date() - new Date(history.firstDate + 'T00:00:00')) / 86400000)) : 0;
  return { c, currentPlan, status, history, tenureDays };
}

export function previewTotals(){
  const stbIncluded = $("#c_stb").value;
  const f = calcFigures({
    cost:$("#c_cost").value, wholesale:$("#c_wholesale").value, actual:$("#c_actual").value,
    stbIncluded, stbCost:$("#c_stbCost").value, stbWholesale:$("#c_stbWholesale").value, stbActual:$("#c_stbActual").value
  });
  const discName = ($("#c_discName").value || "").trim();
  $("#c_preview").innerHTML = `
    Turnover: <strong>${fmt(f.turnover)}</strong><br>
    Expense: <strong>${fmt(f.expense)}</strong><br>
    Profit: <strong>${fmt(f.profit)}</strong><br>
    ${f.discountSaved > 0 ? `Customer discount: <strong>${fmt(f.discountSaved)}</strong>${discName ? ` <span class="chip">${esc(discName)}</span>` : ''}` : `<span class="muted">No discount</span>`}
  `;
}

export function cleanImportedValue(value){
  const v = String(value || "").trim();
  const bad = ["type a phone","select credits","type your message","add","recover"];
  return bad.includes(v.toLowerCase()) ? "" : v;
}

export function normalizeSmartLabel(value){
  return String(value || "").replace(/[:：]/g, "").trim().toLowerCase();
}

export function escapeRegExp(value){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SMART_IMPORT_LABELS = [
  "edit users","name","username","password","mac","status","phone","comments","package",
  "vod package","stb info","receiver","last active","ip","expiry","box model","created",
  "watching","parent pin","firmware","favorites","credits","select credits","type",
  "send message","type your message","transaction history","search","show"
];

export function isSmartImportLabel(line){
  return SMART_IMPORT_LABELS.includes(normalizeSmartLabel(line));
}

export function getNextImportedValue(lines, label){
  const wanted = normalizeSmartLabel(label);
  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    if(normalizeSmartLabel(line) === wanted){
      const next = cleanImportedValue(lines[i + 1] || "");
      if(!next || isSmartImportLabel(next)) return "";
      return next;
    }
    const sameLineRegex = new RegExp("^" + escapeRegExp(label) + "\\s*:?\\s*(.+)$", "i");
    const sameLineMatch = line.match(sameLineRegex);
    if(sameLineMatch) return cleanImportedValue(sameLineMatch[1]);
  }
  return "";
}

export function getColonImportedValue(raw, label){
  const regex = new RegExp(escapeRegExp(label) + "\\s*:\\s*([^\\n\\r]+)", "i");
  const match = String(raw || "").match(regex);
  return cleanImportedValue(match ? match[1] : "");
}

export function firstEmailFromText(text){
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

export function dateOnlyFromText(value){
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

export function latestPurchasedTransaction(raw){
  const matches = [...String(raw || "").matchAll(
    /\bPURCHASED\s+(\d+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\s+(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/gi
  )];
  if(!matches.length) return null;
  const latest = matches[matches.length - 1];
  return {
    months:Number(latest[1] || 0),
    username:latest[2] || "",
    startDate:latest[3] || "",
    expiryDate:latest[4] || ""
  };
}

export function selectPlanByMonths(months){
  if(!months) return false;
  const match = Object.entries(plans).find(([id, p])=> Number(p.duration_months || 0) === Number(months));
  if(!match) return false;
  const [planId, p] = match;
  $("#c_plan").value = planId;
  $("#c_actual").value = p.retail_price ?? "";
  $("#c_cost").value = p.retail_price ?? "";
  $("#c_wholesale").value = p.wholesale_cost ?? "";
  return true;
}

export function toggleSmartPastePanel(forceOpen=null){
  const panel = $("#smartPastePanel");
  const btn = $("#btnToggleSmartPaste");
  if(!panel || !btn) return;
  const shouldOpen = forceOpen === null ? panel.classList.contains('hidden') : !!forceOpen;
  panel.classList.toggle('hidden', !shouldOpen);
  btn.textContent = shouldOpen ? "Hide Paste Box" : "Paste Info";
  if(shouldOpen) setTimeout(()=> $("#c_smartPaste")?.focus(), 60);
}

export function resetSmartPasteBox(){
  const shell = $("#smartPasteShell");
  const panel = $("#smartPastePanel");
  const btn = $("#btnToggleSmartPaste");
  if(shell) shell.classList.remove('hidden');
  if(panel) panel.classList.add('hidden');
  if(btn) btn.textContent = "Paste Info";
  if($("#c_smartPaste")) $("#c_smartPaste").value = "";
  if($("#smartPasteMsg")) $("#smartPasteMsg").textContent = "";
}

export function autoFillCustomerFromPaste(){
  const raw = $("#c_smartPaste").value || "";
  if(!raw.trim()){
    toast("Paste customer details first.", "warn");
    return;
  }
  const lines = raw.replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean);
  const tx = latestPurchasedTransaction(raw);
  const name = getNextImportedValue(lines, "Name");
  const username = getNextImportedValue(lines, "Username") || tx?.username || "";
  const mac = getNextImportedValue(lines, "MAC");
  const phone = getNextImportedValue(lines, "Phone");
  const comments = getNextImportedValue(lines, "Comments");
  const packageName = getNextImportedValue(lines, "Package");
  const vodPackage = getNextImportedValue(lines, "VOD Package");
  const status = getNextImportedValue(lines, "Status");
  const receiver = getColonImportedValue(raw, "Receiver");
  const boxModel = getColonImportedValue(raw, "Box Model");
  const createdDate = dateOnlyFromText(getColonImportedValue(raw, "Created"));
  const expiryFromStb = dateOnlyFromText(getColonImportedValue(raw, "Expiry"));
  const detectedEmail = firstEmailFromText(comments) || firstEmailFromText(raw);
  const startDate = tx?.startDate || createdDate || todayISO();
  const expiryDate = expiryFromStb || tx?.expiryDate || "";

  if(name) $("#c_name").value = name;
  if(username) $("#c_userId").value = username;
  if(mac) $("#c_mac").value = mac.toUpperCase();
  if(phone) $("#c_phone").value = phone;
  if(detectedEmail) $("#c_email").value = detectedEmail;

  const noteParts = [];
  if(comments) noteParts.push(comments);
  if(packageName) noteParts.push("Package: " + packageName);
  if(vodPackage) noteParts.push("VOD: " + vodPackage);
  if(status) noteParts.push("Status: " + status);
  if(receiver) noteParts.push("Receiver: " + receiver);
  if(boxModel) noteParts.push("Box Model: " + boxModel);
  $("#c_comments").value = noteParts.join("\n");

  if(tx?.months) selectPlanByMonths(tx.months);
  if(startDate) $("#c_start").value = startDate;
  if(expiryDate){
    $("#c_expiry").value = expiryDate;
  }else{
    const selectedPlan = plans[$("#c_plan").value] || {};
    $("#c_expiry").value = addMonthsISO($("#c_start").value, selectedPlan.duration_months || 0);
  }
  $("#c_paid").value = "yes";
  previewTotals();
  $("#smartPasteMsg").textContent = "Auto-filled. Check details, then save.";
  toast("Customer auto-filled. Please check before saving.", "ok");
}

export function openCustomerModal(id=null){
  editCustomerId = (typeof id === 'string') ? id : null;
  const custModal = $("#modalCustomer");
  $("#custModalTitle").textContent = id ? "Edit Customer" : "Add Customer";
  refreshPlanSelects();
  const firstPlanId = Object.keys(plans)[0] || "";
  const defaults = firstPlanId ? plans[firstPlanId] : null;
  resetSmartPasteBox();
  $("#smartPasteShell").classList.toggle("hidden", !!id);
  $("#c_name").value = "";
  $("#c_phone").value = "";
  $("#c_email").value = "";
  $("#c_comments").value = "";
  $("#c_userId").value = "";
  $("#c_mac").value = "";
  $("#c_plan").value = firstPlanId;
  $("#c_actual").value = defaults ? (defaults.retail_price || "") : "";
  $("#c_cost").value = defaults ? (defaults.retail_price || "") : "";
  $("#c_wholesale").value = defaults ? (defaults.wholesale_cost || "") : "";
  $("#c_discName").value = "";
  $("#c_stb").value = "no";
  $("#stbBox").classList.add('hidden');
  $("#c_stbActual").value = "";
  $("#c_stbCost").value = "";
  $("#c_stbWholesale").value = "";
  $("#c_start").value = todayISO();
  $("#c_expiry").value = defaults ? addMonthsISO($("#c_start").value, defaults.duration_months || 0) : $("#c_start").value;
  $("#c_paid").value = "yes";
  $("#c_preview").textContent = "—";

  if(id){
    const c = customers.find(x=> x.id === id);
    if(c){
      $("#c_name").value = c.name || "";
      $("#c_phone").value = c.phone || "";
      $("#c_email").value = c.email || "";
      $("#c_comments").value = c.comments || "";
      $("#c_userId").value = c.userId || "";
      $("#c_mac").value = c.mac || "";
      if(c.currentPlan){
        $("#c_plan").value = c.currentPlan.planId || firstPlanId || "";
        $("#c_actual").value = c.currentPlan.actual || "";
        $("#c_cost").value = c.currentPlan.cost || "";
        $("#c_wholesale").value = c.currentPlan.wholesale || "";
        $("#c_discName").value = c.currentPlan.discountName || "";
        $("#c_stb").value = c.currentPlan.stbIncluded || "no";
        $("#stbBox").classList.toggle('hidden', $("#c_stb").value !== 'yes');
        $("#c_stbActual").value = c.currentPlan.stbActual || "";
        $("#c_stbCost").value = c.currentPlan.stbCost || "";
        $("#c_stbWholesale").value = c.currentPlan.stbWholesale || "";
        $("#c_start").value = c.currentPlan.startDate || todayISO();
        $("#c_expiry").value = c.currentPlan.expiryDate || addMonthsISO($("#c_start").value, plans[$("#c_plan").value]?.duration_months || 0);
        $("#c_paid").value = c.currentPlan.paymentReceived || "yes";
      }
    }
  }
  previewTotals();
  custModal.classList.add('open');
}

export function validateCustomerModal(){
  const name = $("#c_name").value.trim();
  const email = normalizeEmail($("#c_email").value);
  const mac = $("#c_mac").value.trim();
  const start = $("#c_start").value;
  const expiry = $("#c_expiry").value;
  if(!name) throw new Error("Name is required.");
  if(email && !isValidEmail(email)) throw new Error("Please enter a valid email.");
  if(mac && !isValidMac(mac)) throw new Error("MAC address format should look like AA:BB:CC:DD:EE:FF.");
  if(!start || !expiry) throw new Error("Start and expiry dates are required.");
  if(expiry < start) throw new Error("Expiry date cannot be before start date.");
  ["#c_actual","#c_cost","#c_wholesale","#c_stbActual","#c_stbCost","#c_stbWholesale"].forEach(sel=>{
    const val = $(sel).value;
    if(val !== "" && !nonNegativeNumber(val)) throw new Error("Prices cannot be negative.");
  });
}

export async function saveCustomerFromModal(){
  validateCustomerModal();
  const name = $("#c_name").value.trim();
  const planId = $("#c_plan").value;
  const p = plans[planId] || {};
  const planName = p.name || "Custom";
  const durationMonths = +p.duration_months || 0;
  const start = $("#c_start").value;
  const expiry = $("#c_expiry").value || addMonthsISO(start, durationMonths);
  const currentPlan = {
    planId, planName, durationMonths,
    actual:+$("#c_actual").value || 0,
    cost:+$("#c_cost").value || 0,
    wholesale:+$("#c_wholesale").value || 0,
    discountName:($("#c_discName").value || "").trim(),
    stbIncluded:$("#c_stb").value,
    stbActual:+$("#c_stbActual").value || 0,
    stbCost:+$("#c_stbCost").value || 0,
    stbWholesale:+$("#c_stbWholesale").value || 0,
    startDate:start,
    expiryDate:expiry,
    paymentReceived:$("#c_paid").value
  };
  const payload = {
    name,
    phone:$("#c_phone").value.trim(),
    email:normalizeEmail($("#c_email").value),
    comments:$("#c_comments").value.trim(),
    userId:$("#c_userId").value.trim(),
    mac:$("#c_mac").value.trim().toUpperCase(),
    originalStartDate: (editCustomerId ? (customers.find(x=>x.id===editCustomerId)?.originalStartDate || start) : start),
    currentPlan
  };
  const existingIdForUpdate = editCustomerId;
  const cid = await saveCustomer(payload, existingIdForUpdate ? String(existingIdForUpdate) : null);
  if(!existingIdForUpdate){
    await addRenewal(cid, {
      customerId: cid, customerName: name, planId, planName, durationMonths,
      actual: currentPlan.actual, cost: currentPlan.cost, wholesale: currentPlan.wholesale,
      stbIncluded: currentPlan.stbIncluded, stbActual: currentPlan.stbActual, stbCost: currentPlan.stbCost, stbWholesale: currentPlan.stbWholesale,
      discountName: currentPlan.discountName, startDate: start, expiryDate: expiry, paymentReceived: currentPlan.paymentReceived, renewalType:'activation'
    });
  } else {
    const latest = await getLatestRenewalDoc(existingIdForUpdate);
    if(latest){
      await safeUpdateDoc(latest.ref, {
        planId, planName, durationMonths,
        actual: currentPlan.actual, cost: currentPlan.cost, wholesale: currentPlan.wholesale,
        stbIncluded: currentPlan.stbIncluded, stbActual: currentPlan.stbActual, stbCost: currentPlan.stbCost, stbWholesale: currentPlan.stbWholesale,
        discountName: currentPlan.discountName, startDate: currentPlan.startDate, expiryDate: currentPlan.expiryDate,
        paymentReceived: currentPlan.paymentReceived, customerId: existingIdForUpdate, customerName: name, updatedAt: serverTimestamp(),
        renewalType: latest.data.renewalType || 'activation'
      }, '[renewals] update latest');
    } else {
      await addRenewal(existingIdForUpdate, {
        customerId: existingIdForUpdate, customerName: name, planId, planName, durationMonths,
        actual: currentPlan.actual, cost: currentPlan.cost, wholesale: currentPlan.wholesale,
        stbIncluded: currentPlan.stbIncluded, stbActual: currentPlan.stbActual, stbCost: currentPlan.stbCost, stbWholesale: currentPlan.stbWholesale,
        discountName: currentPlan.discountName, startDate: currentPlan.startDate, expiryDate: currentPlan.expiryDate, paymentReceived: currentPlan.paymentReceived, renewalType:'activation'
      });
    }
  }
  $("#modalCustomer").classList.remove('open');
  await loadCustomers();
  await loadRenewals();
  renderAll();
  if($("#c_invoice").checked) setTimeout(()=> printInvoice(cid), 200);
  editCustomerId = null;
}

export function viewCustomer(id){
  const c = customers.find(x=>x.id===id);
  if(!c){ toast("Customer not found.", "error"); return; }
  const cp = c.currentPlan || {};
  const figs = calcFigures({ cost:cp.cost, wholesale:cp.wholesale, actual:cp.actual, stbIncluded:cp.stbIncluded, stbCost:cp.stbCost, stbWholesale:cp.stbWholesale, stbActual:cp.stbActual });
  const hist = customerHistory(c.id);
  alert(`Customer: ${c.name}\nPhone: ${c.phone || '-'}  Email: ${c.email || '-'}\nUser ID: ${c.userId || '-'}  MAC: ${c.mac || '-'}\n\nOriginal Start: ${c.originalStartDate || '-'}\nCurrent Plan: ${cp.planName || '-'} (${cp.durationMonths || 0} mo)\nThis Plan Start: ${cp.startDate || '-'}  Expiry: ${cp.expiryDate || '-'}\nRenewal Count: ${hist.renewalCount}\nTotal Paid: ${fmt(hist.totalSpent)}\n\nThis Plan:\n  Turnover: ${fmt(figs.turnover)}\n  Expense:  ${fmt(figs.expense)}\n  Profit:   ${fmt(figs.profit)}\n  Discount: ${fmt(figs.discountSaved)}${cp.discountName ? ' — ' + cp.discountName : ''}`);
}

export function customerSortComparator(sortMode){
  return (a,b)=>{
    switch(sortMode){
      case 'nameAsc': return (a.c.name || '').localeCompare(b.c.name || '');
      case 'nameDesc': return (b.c.name || '').localeCompare(a.c.name || '');
      case 'expirySoon':
        if(a.status.key === 'expired' && b.status.key === 'expired') return (b.status.days ?? -99999) - (a.status.days ?? -99999);
        return (a.status.days ?? 99999) - (b.status.days ?? 99999);
      case 'expiryLate':
        if(a.status.key === 'expired' && b.status.key === 'expired') return (a.status.days ?? -99999) - (b.status.days ?? -99999);
        return (b.status.days ?? -99999) - (a.status.days ?? -99999);
      case 'startNew': return (b.currentPlan.startDate || '').localeCompare(a.currentPlan.startDate || '');
      case 'startOld': return (a.currentPlan.startDate || '').localeCompare(b.currentPlan.startDate || '');
      case 'paidMore': return b.history.totalSpent - a.history.totalSpent || (a.c.name || '').localeCompare(b.c.name || '');
      case 'renewedMore': return b.history.renewalCount - a.history.renewalCount || b.history.totalSpent - a.history.totalSpent;
      default: return (a.c.name || '').localeCompare(b.c.name || '');
    }
  };
}

export function filteredCustomerList(){
  const q = (window.customerSearchValue || '').toLowerCase().trim();
  const timeFilter = window.customerTimeFilter || 'currentYear';
  const statusFilter = window.customerStatusFilter || 'all';
  const expiryFilter = window.customerExpiryFilter || 'all';
  const now = new Date();
  const currentYear = now.getFullYear();

  return customers.map(customerSummary).filter(item=>{
    const inText = `${item.c.name||''} ${item.c.phone||''} ${item.c.email||''} ${item.c.userId||''} ${item.c.mac||''}`.toLowerCase();
    if(q && !inText.includes(q)) return false;

    const startISO = item.currentPlan.startDate || item.c.originalStartDate || "";
    let withinTime = true;
    if(timeFilter === 'currentYear'){
      withinTime = !!startISO && new Date(startISO + "T00:00:00").getFullYear() === currentYear;
    }else if(timeFilter === '30'){
      withinTime = !!startISO && Math.floor((now - new Date(startISO + "T00:00:00")) / 86400000) <= 30;
    }else if(timeFilter === '365'){
      withinTime = !!startISO && Math.floor((now - new Date(startISO + "T00:00:00")) / 86400000) <= 365;
    }
    if(!withinTime) return false;

    const paidStr = (item.currentPlan.paymentReceived === 'yes') ? 'paid' : 'unpaid';
    if(statusFilter !== 'all' && paidStr !== statusFilter) return false;
    if(expiryFilter !== 'all' && item.status.key !== expiryFilter) return false;
    return true;
  });
}

export function customerGroupHtml(title, note, items, extraClass=''){
  if(!items.length) return '';
  return `
    <div class="customer-group ${extraClass}">
      <div class="customer-group-head">
        <div>
          <div class="customer-group-title">${esc(title)}</div>
          <div class="customer-group-note">${esc(note)}</div>
        </div>
        <span class="customer-group-count">${items.length}</span>
      </div>
      <div class="list-stack">${items.map(item => customerAccordionHtml(item)).join('')}</div>
    </div>`;
}

export function renderCustomerResults(){
  const host = $("#customerResultsHost");
  const resultCount = $("#customerResultCount");
  if(!host || !resultCount) return;

  const q = (window.customerSearchValue || '').trim();
  const expiryFilter = window.customerExpiryFilter || 'all';
  const comparator = customerSortComparator(customerSortMode);
  const list = filteredCustomerList();
  resultCount.textContent = `${list.length} result${list.length === 1 ? '' : 's'} shown`;

  if(!list.length){
    host.innerHTML = `<div class="empty-state">No customers match your filters.</div>`;
    return;
  }

  const recentExpired = list.filter(x => x.status.key === 'expired' && (x.status.days ?? -99999) >= -90).sort(comparator);
  const olderExpired = list.filter(x => x.status.key === 'expired' && (x.status.days ?? 0) < -90).sort(comparator);
  const expiringSoon = list.filter(x => x.status.key === 'near').sort(comparator);
  const active = list.filter(x => x.status.key === 'active').sort(comparator);
  const unknown = list.filter(x => x.status.key === 'unknown').sort(comparator);

  const forceShowOld = !!q || expiryFilter === 'expired';
  const showOld = forceShowOld || !!window.showOlderExpired;
  const chunks = [];

  if(expiryFilter === 'all' || expiryFilter === 'expired'){
    chunks.push(customerGroupHtml('Recently expired', 'Expired within the last 90 days — shown first for quick follow-up.', recentExpired));
  }
  if(expiryFilter === 'all' || expiryFilter === 'near'){
    chunks.push(customerGroupHtml('Expiring soon', `Due within ${settingNear} days.`, expiringSoon));
  }
  if(expiryFilter === 'all' || expiryFilter === 'active'){
    chunks.push(customerGroupHtml('Active customers', 'Plans with more time remaining.', active));
  }
  if(expiryFilter === 'all' && unknown.length){
    chunks.push(customerGroupHtml('No expiry date', 'Customer records that need an expiry date.', unknown));
  }

  if((expiryFilter === 'all' || expiryFilter === 'expired') && olderExpired.length){
    chunks.push(`
      <div class="customer-group">
        <button id="toggleOlderExpired" class="older-expired-toggle" type="button">
          <span>Older expired customers (${olderExpired.length})</span>
          <small>${showOld ? 'Hide' : 'Show'} • expired more than 90 days ago</small>
        </button>
        <div id="olderExpiredResults" class="list-stack ${showOld ? '' : 'hidden'}" style="margin-top:10px">
          ${showOld ? olderExpired.map(item => customerAccordionHtml(item)).join('') : ''}
        </div>
      </div>`);
  }

  host.innerHTML = chunks.filter(Boolean).join('') || `<div class="empty-state">No customers match your filters.</div>`;

  const toggleOld = $("#toggleOlderExpired");
  if(toggleOld){
    toggleOld.onclick = ()=>{
      window.showOlderExpired = !window.showOlderExpired;
      renderCustomerResults();
    };
  }
  bindCustomerAccordionClicks(host);
}

export function renderCustomers(){
  const timeFilter = window.customerTimeFilter || 'currentYear';
  const statusFilter = window.customerStatusFilter || 'all';
  const expiryFilter = window.customerExpiryFilter || 'all';
  const sortMode = customerSortMode;
  const section = $("#tab-customers");
  if(!section) return;

  if(!$("#customerResultsHost")){
    section.innerHTML = `
      <div class="card">
        <div class="section-title">
          <div class="grow">
            <h2>Customers</h2>
            <div class="helper">Search stays focused while you type. Recently expired customers appear first; records expired more than 90 days ago stay collapsed.</div>
          </div>
          <button id="btnAddCustomerBar" class="btn ok" type="button">+ Add Customer</button>
        </div>

        <div class="control-grid three" style="margin-top:10px">
          <input id="searchCustomersBar" type="search" autocomplete="off" inputmode="search" aria-label="Search customers" placeholder="Search name, phone, email, MAC, user ID..." value="${esc(window.customerSearchValue || '')}">
          <select id="timeFilterBar">
            <option value="currentYear" ${timeFilter==='currentYear'?'selected':''}>Current Year</option>
            <option value="30" ${timeFilter==='30'?'selected':''}>Last 30 Days</option>
            <option value="365" ${timeFilter==='365'?'selected':''}>Last 365 Days</option>
            <option value="lifetime" ${timeFilter==='lifetime'?'selected':''}>Lifetime</option>
          </select>
          <select id="expiryFilterBar">
            <option value="all" ${expiryFilter==='all'?'selected':''}>All Status</option>
            <option value="active" ${expiryFilter==='active'?'selected':''}>Active</option>
            <option value="near" ${expiryFilter==='near'?'selected':''}>Expiring Soon</option>
            <option value="expired" ${expiryFilter==='expired'?'selected':''}>Expired</option>
          </select>
          <select id="statusFilterBar">
            <option value="all" ${statusFilter==='all'?'selected':''}>All Payments</option>
            <option value="paid" ${statusFilter==='paid'?'selected':''}>Paid</option>
            <option value="unpaid" ${statusFilter==='unpaid'?'selected':''}>Unpaid</option>
          </select>
          <select id="customerSortBar">
            <option value="expirySoon" ${sortMode==='expirySoon'?'selected':''}>Expiry Priority</option>
            <option value="nameAsc" ${sortMode==='nameAsc'?'selected':''}>Name A–Z</option>
            <option value="nameDesc" ${sortMode==='nameDesc'?'selected':''}>Name Z–A</option>
            <option value="expiryLate" ${sortMode==='expiryLate'?'selected':''}>Expiry Latest</option>
            <option value="startNew" ${sortMode==='startNew'?'selected':''}>Newest Start</option>
            <option value="startOld" ${sortMode==='startOld'?'selected':''}>Oldest Start</option>
            <option value="paidMore" ${sortMode==='paidMore'?'selected':''}>Paid More</option>
            <option value="renewedMore" ${sortMode==='renewedMore'?'selected':''}>Renewed More</option>
          </select>
          <div class="card" style="padding:12px"><div id="customerResultCount" class="helper">0 results shown</div></div>
        </div>

        <div id="customerResultsHost" style="margin-top:12px"></div>
      </div>`;

    $("#btnAddCustomerBar").onclick = ()=> openCustomerModal(null);
    $("#searchCustomersBar").addEventListener('input', e=>{
      window.customerSearchValue = e.target.value;
      clearTimeout(window.customerSearchTimer);
      window.customerSearchTimer = setTimeout(renderCustomerResults, 120);
    });
    $("#timeFilterBar").addEventListener('change', e=>{ window.customerTimeFilter = e.target.value; renderCustomerResults(); }, {passive:true});
    $("#expiryFilterBar").addEventListener('change', e=>{ window.customerExpiryFilter = e.target.value; renderCustomerResults(); }, {passive:true});
    $("#statusFilterBar").addEventListener('change', e=>{ window.customerStatusFilter = e.target.value; renderCustomerResults(); }, {passive:true});
    $("#customerSortBar").addEventListener('change', e=>{ customerSortMode = e.target.value; renderCustomerResults(); }, {passive:true});
  }

  const search = $("#searchCustomersBar");
  if(search && document.activeElement !== search && search.value !== (window.customerSearchValue || '')){
    search.value = window.customerSearchValue || '';
  }
  renderCustomerResults();
}

export function customerAccordionHtml(item){
  const open = accordionState.customers.has(String(item.c.id));
  const cp = item.currentPlan || {};
  return `
    <div class="accordion-item ${open ? 'open' : ''}" data-acc="customers" data-id="${esc(item.c.id)}">
      <div class="accordion-head">
        <div class="accordion-left">
          <div class="accordion-name">${esc(item.c.name || '')}</div>
          <div class="accordion-meta">
            <span>${esc(cp.planName || cp.planId || '-')}</span>
            <span>•</span>
            <span>${esc(item.c.phone || 'No phone')}</span>
          </div>
          <div class="accordion-meta">
            <span class="mini-badge ${item.status.cls}">${esc(item.status.label)}</span>
            ${getPaidBadge(cp.paymentReceived)}
            <span class="mini-badge badge-muted">Paid ${esc(fmt(item.history.totalSpent))}</span>
          </div>
        </div>
        <div class="accordion-actions">
          <button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>
          <button class="mini-btn ghost" data-action="toggle" data-state="customers" data-id="${esc(item.c.id)}" type="button">${open ? 'Hide' : 'Open'}</button>
        </div>
      </div>
      <div class="accordion-body">
        ${detailGridHtml(item)}
        <div class="detail-actions">
          <button class="mini-btn ghost" data-action="view" data-id="${esc(item.c.id)}" type="button">View</button>
          <button class="mini-btn ghost" data-action="edit" data-id="${esc(item.c.id)}" type="button">Edit</button>
          <button class="mini-btn ok" data-action="renew" data-id="${esc(item.c.id)}" type="button">Renew</button>
          <button class="mini-btn ghost" data-action="invoice" data-id="${esc(item.c.id)}" type="button">Slip</button>
          <button class="mini-btn ghost" data-action="delete" data-id="${esc(item.c.id)}" type="button">Delete</button>
        </div>
      </div>
    </div>`;
}

function bindCustomerAccordionClicks(root){
  root.querySelectorAll('[data-action="toggle"]').forEach(btn=>{
    btn.onclick = ()=>{
      const stateKey = btn.dataset.state;
      const id = String(btn.dataset.id);
      if(accordionState[stateKey].has(id)) accordionState[stateKey].delete(id); else accordionState[stateKey].add(id);
      renderCustomerResults();
    };
  });
  root.querySelectorAll('[data-action="renew"]').forEach(btn=> btn.onclick = ()=> openRenewModal(btn.dataset.id));
  root.querySelectorAll('[data-action="edit"]').forEach(btn=> btn.onclick = ()=> openCustomerModal(btn.dataset.id));
  root.querySelectorAll('[data-action="view"]').forEach(btn=> btn.onclick = ()=> viewCustomer(btn.dataset.id));
  root.querySelectorAll('[data-action="invoice"]').forEach(btn=> btn.onclick = ()=> printInvoice(btn.dataset.id));
  root.querySelectorAll('[data-action="delete"]').forEach(btn=> btn.onclick = async ()=>{
    if(isDemoMode()){ toast("Deleting customer is disabled in demo mode.", "warn"); return; }
    if(confirm("Delete this customer and all their renewals?")){
      try{
        await deleteCustomerAndRenewals(btn.dataset.id);
        toast("Customer deleted.", "ok");
      }catch(e){
        showErr('[customers] delete', e);
        toast("Failed to delete customer.", "error");
      }
    }
  });
}
