import { db, doc, collection, addDoc, updateDoc, safeGetDocs, safeAddDoc, safeUpdateDoc, collectionGroup, writeBatch, serverTimestamp } from "./firebase.js";
import { $, todayISO, addMonthsISO, calcFigures, nonNegativeNumber, toast, showErr } from "./utils.js";
import { plans, refreshPlanSelects } from "./plans.js";
import { customers, loadCustomers } from "./customers.js";
import { isDemoMode, renderAll } from "./app.js";
import { printInvoice } from "./invoices.js";

export let renewals = [];
export let renewalsLoadedOnce = false;

let canonicalRenewalCache = null;
let customerHistoryCache = new Map();

export function invalidateAnalyticsCache(){
  canonicalRenewalCache = null;
  customerHistoryCache = new Map();
}

export function renewalQuality(r){
  return ['cost','wholesale','actual','startDate','expiryDate','planId','durationMonths','paymentReceived','discountName'].reduce((s,k)=> s + (r[k] !== undefined && r[k] !== '' ? 1 : 0), 0) + (r.renewalType ? 4 : 0);
}

export function canonicalRenewalGroups(){
  if(canonicalRenewalCache) return canonicalRenewalCache;
  const sigMap = new Map();
  for(const r of renewals){
    const cid = String(r.customerId || '');
    if(!cid) continue;
    const signature = [cid, r.startDate || '', r.expiryDate || '', r.planId || '', r.cost || 0, r.stbIncluded || 'no', r.stbCost || 0, r.paymentReceived || ''].join('|');
    const existing = sigMap.get(signature);
    if(!existing || renewalQuality(r) >= renewalQuality(existing)) sigMap.set(signature, r);
  }
  const grouped = new Map();
  [...sigMap.values()].forEach(r=>{
    const cid = String(r.customerId || '');
    if(!grouped.has(cid)) grouped.set(cid, []);
    grouped.get(cid).push(r);
  });
  grouped.forEach(list=> list.sort((a,b)=> (a.startDate || '').localeCompare(b.startDate || '') || (a.expiryDate || '').localeCompare(b.expiryDate || '')));
  canonicalRenewalCache = grouped;
  return grouped;
}

export function customerHistory(customerId){
  const cacheKey = String(customerId);
  if(customerHistoryCache.has(cacheKey)) return customerHistoryCache.get(cacheKey);
  const grouped = canonicalRenewalGroups();
  const list = grouped.get(cacheKey) || [];
  const hasTyped = list.some(r => !!(r.renewalType || r.recordType));
  const renewalOnly = hasTyped ? list.filter(r => (r.renewalType || r.recordType) === 'renewal') : list.filter((_, idx) => idx > 0);
  const totalSpent = list.reduce((sum, r)=> sum + calcFigures({ cost:r.cost, wholesale:r.wholesale, actual:r.actual, stbIncluded:r.stbIncluded, stbCost:r.stbCost, stbWholesale:r.stbWholesale, stbActual:r.stbActual }).turnover, 0);
  const totalExpense = list.reduce((sum, r)=> sum + calcFigures({ cost:r.cost, wholesale:r.wholesale, actual:r.actual, stbIncluded:r.stbIncluded, stbCost:r.stbCost, stbWholesale:r.stbWholesale, stbActual:r.stbActual }).expense, 0);
  const firstDate = list[0]?.startDate || '';
  const lastDate = list[list.length - 1]?.startDate || '';
  const result = { list, renewalOnly, renewalCount: renewalOnly.length, totalSpent, totalExpense, firstDate, lastDate };
  customerHistoryCache.set(cacheKey, result);
  return result;
}

export async function addRenewal(customerId, ren){
  const ref = await safeAddDoc(collection(db, "customers", String(customerId), "renewals"), { ...ren, createdAt: serverTimestamp() }, '[renewals] addDoc');
  await loadRenewals();
  return String(ref.id);
}

export async function loadRenewals(){
  renewals = [];
  renewalsLoadedOnce = false;
  try{
    const snap = await safeGetDocs(collectionGroup(db, "renewals"), '[renewals] collectionGroup');
    snap.forEach(d=> renewals.push({id:d.id, ...d.data(), _path: d.ref.path}) );
  }catch(e){
    showErr('[renewals] collectionGroup failed', e);
    const resultList = await Promise.allSettled(
      customers.map(c => safeGetDocs(collection(db, "customers", String(c.id), "renewals"), `[renewals] fallback ${c.id}`))
    );
    resultList.forEach((result, index)=>{
      if(result.status === 'fulfilled'){
        result.value.forEach(d=> renewals.push({id:d.id, ...d.data(), _path: d.ref.path}) );
      }else{
        showErr(`[renewals] fallback ${customers[index]?.id || index}`, result.reason);
      }
    });
  }
  renewalsLoadedOnce = true;
  invalidateAnalyticsCache();
}

export async function setCustomerCurrentPlan(customerId, planFields){
  const ref = doc(db, "customers", String(customerId));
  await safeUpdateDoc(ref, { currentPlan: planFields, updatedAt: serverTimestamp() }, '[customers] set currentPlan');
}

export async function getLatestRenewalDoc(customerId){
  const snap = await safeGetDocs(collection(db, "customers", String(customerId), "renewals"), '[renewals] list latest');
  let latest = null;
  snap.forEach(d => {
    const r = d.data() || {};
    const key = [r.startDate || '', r.expiryDate || '', d.id].join('|');
    if(!latest || key > latest.key) latest = { key, ref: d.ref, id: d.id, data: r };
  });
  return latest || null;
}

let renewCustomerId = null;

export function openRenewModal(id){
  renewCustomerId = id;
  refreshPlanSelects();
  const c = customers.find(x=>x.id===id);
  $("#renewTitle").textContent = `Renew: ${c?.name || id}`;
  const cp = c?.currentPlan || {};
  $("#r_plan").value = cp.planId || Object.keys(plans)[0] || "";
  const p = plans[$("#r_plan").value] || {};
  $("#r_actual").value = cp.actual || p.retail_price || "";
  $("#r_cost").value = cp.cost || p.retail_price || "";
  $("#r_wholesale").value = cp.wholesale || p.wholesale_cost || "";
  $("#r_discName").value = cp.discountName || "";
  $("#r_stb").value = "no";
  $("#r_stbBox").classList.add('hidden');
  $("#r_stbActual").value = "";
  $("#r_stbCost").value = "";
  $("#r_stbWholesale").value = "";
  const defStart = cp.expiryDate ? addMonthsISO(cp.expiryDate, 0) : todayISO();
  $("#r_start").value = defStart;
  $("#r_expiry").value = addMonthsISO(defStart, p.duration_months || 0);
  $("#r_paid").value = "yes";

  $("#r_plan").onchange = ()=>{
    const p2 = plans[$("#r_plan").value] || {};
    $("#r_expiry").value = addMonthsISO($("#r_start").value, p2.duration_months || 0);
    if(!cp.actual) $("#r_actual").value = p2.retail_price || "";
    if(!cp.cost) $("#r_cost").value = p2.retail_price || "";
    if(!cp.wholesale) $("#r_wholesale").value = p2.wholesale_cost || "";
  };
  $("#r_start").onchange = ()=>{
    const p2 = plans[$("#r_plan").value] || {};
    $("#r_expiry").value = addMonthsISO($("#r_start").value, p2.duration_months || 0);
  };
  $("#modalRenew").classList.add('open');
}

export function validateRenewModal(){
  const start = $("#r_start").value;
  const expiry = $("#r_expiry").value;
  if(!start || !expiry) throw new Error("Start and expiry dates are required.");
  if(expiry < start) throw new Error("Expiry date cannot be before start date.");
  ["#r_actual","#r_cost","#r_wholesale","#r_stbActual","#r_stbCost","#r_stbWholesale"].forEach(sel=>{
    const val = $(sel).value;
    if(val !== "" && !nonNegativeNumber(val)) throw new Error("Prices cannot be negative.");
  });
}

export async function doRenew(){
  if(isDemoMode()){ toast("Renewing plan is disabled in demo mode.", "warn"); return; }
  try{
    validateRenewModal();
    const c = customers.find(x=>x.id===renewCustomerId);
    if(!c) throw new Error("Missing customer.");
    const planId = $("#r_plan").value;
    const p = plans[planId] || {};
    const planName = p.name || 'Custom';
    const durationMonths = +p.duration_months || 0;
    const start = $("#r_start").value;
    const expiry = $("#r_expiry").value || addMonthsISO(start, durationMonths);
    const ren = {
      customerId:String(renewCustomerId), customerName:c.name || '', planId, planName, durationMonths,
      actual:+$("#r_actual").value || 0, cost:+$("#r_cost").value || 0, wholesale:+$("#r_wholesale").value || 0,
      stbIncluded:$("#r_stb").value, stbActual:+$("#r_stbActual").value || 0, stbCost:+$("#r_stbCost").value || 0, stbWholesale:+$("#r_stbWholesale").value || 0,
      discountName:($("#r_discName").value || "").trim(), startDate:start, expiryDate:expiry, paymentReceived:$("#r_paid").value, renewalType:'renewal'
    };
    const btn = $("#btnDoRenew");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Renewing…";
    try{
      await addRenewal(String(renewCustomerId), ren);
      await setCustomerCurrentPlan(String(renewCustomerId), ren);
    }finally{
      btn.disabled = false;
      btn.textContent = old;
    }
    $("#modalRenew").classList.remove('open');
    await loadCustomers();
    await loadRenewals();
    renderAll();
    toast("Renewal saved.", "ok");
    if($("#r_invoice").checked) setTimeout(()=> printInvoice(renewCustomerId), 200);
  }catch(e){
    showErr('[renewals] doRenew', e);
    toast(e?.message || 'Failed to renew plan.', 'error');
  }
}

export async function cleanupOrphanRenewals(){
  if(isDemoMode()){ toast("Cleanup is disabled in demo mode.", "warn"); return; }
  const msg = $("#cleanupMsg");
  const btn = $("#btnCleanupOrphans");
  try{
    btn.disabled = true;
    msg.textContent = "Scanning…";
    await loadCustomers();
    const existing = new Set(customers.map(c => String(c.id)));
    const snap = await safeGetDocs(collectionGroup(db, "renewals"), "[cleanup] collectionGroup renewals");
    const orphans = [];
    snap.forEach(d => {
      const data = d.data() || {};
      const cid = String(data.customerId || "");
      if(!existing.has(cid)) orphans.push(d.ref);
    });
    if(orphans.length === 0){
      msg.textContent = "No orphan renewals found.";
      toast("No orphan renewals found.", "info");
      return;
    }
    msg.textContent = `Deleting ${orphans.length} orphan renewals…`;
    const CHUNK = 400;
    for(let i = 0; i < orphans.length; i += CHUNK){
      const batch = writeBatch(db);
      for(let j = i; j < Math.min(i + CHUNK, orphans.length); j++){ batch.delete(orphans[j]); }
      await batch.commit();
    }
    await loadRenewals();
    renderAll();
    msg.textContent = `Deleted ${orphans.length} orphan renewals.`;
    toast(`Deleted ${orphans.length} orphan renewals.`, "ok");
  }catch(err){
    showErr("[cleanup orphans]", err);
    msg.textContent = "Error during cleanup.";
    toast(err?.message || "Failed to clean up orphan renewals.", "error", 3600);
  }finally{
    btn.disabled = false;
  }
}
