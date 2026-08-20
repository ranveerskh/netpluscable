import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "./firebase.js";
import { $, $$, toast, showErr, daysLeft, addMonthsISO, setupIosTweaks } from "./utils.js";
import { plans, loadPlans, renderPlans, setEmptyRow, openPlanModal, doSavePlan, seedPlans } from "./plans.js";
import { customers, loadCustomers, renderCustomers, openCustomerModal, saveCustomerFromModal, toggleSmartPastePanel, autoFillCustomerFromPaste, previewTotals, editCustomerId } from "./customers.js";
import { loadRenewals, doRenew, cleanupOrphanRenewals } from "./renewals.js";
import { renderDashboard, openPeriodModal, periodText } from "./dashboard.js";
import { renderForecast } from "./forecast.js";
import { onRepTypeChange, runReport, exportCSV } from "./reports.js";

export let settingNear = 30;
export let demoMode = false;
export const isDemoMode = () => demoMode;
let uiBound = false;
let activeTab = 'dashboard';
let settingsPlansOpen = false;

const sections = {
  dashboard: $("#tab-dashboard"),
  customers: $("#tab-customers"),
  forecast: $("#tab-forecast"),
  reports: $("#tab-reports"),
  settings: $("#tab-settings"),
};

const authView = $("#authView");
const appView  = $("#appView");
const authEmail = $("#authEmail");
const authPass = $("#authPass");
const authMsg = $("#authMsg");

function setEnvChip(){
  const chip = $("#envInfo");
  if(chip) chip.textContent = demoMode ? "Demo • Read only" : "Connected";
}

export function setActiveTab(tab){
  activeTab = tab;
  $$("#navGrid .nav-btn[data-tab]").forEach(btn=> btn.classList.toggle('active', btn.dataset.tab === tab));
  Object.entries(sections).forEach(([key, el])=>{ if(el) el.classList.toggle('hidden', key !== tab); });
}

export function renderSettingsPlansState(){
  $("#settingsPlansWrap").classList.toggle('hidden', !settingsPlansOpen);
  $("#btnTogglePlans").textContent = settingsPlansOpen ? 'Hide Plans' : 'Manage Plans';
}

export function renderKPIs(){
  const topNear = customers.filter(c => { const d = daysLeft((c.currentPlan || {}).expiryDate); return d >= 0 && d <= settingNear; }).length;
  $("#nearExpCount").textContent = `Expiring soon: ${topNear}`;
}

export function renderAll(){
  $("#periodLabel").textContent = periodText();
  renderDashboard();
  renderCustomers();
  renderForecast();
  renderPlans();
  renderKPIs();
  runReport();
  renderSettingsPlansState();
  $("#settingNearDays").value = settingNear;
}

export async function loadApp(){
  bindUIOnce();
  setEnvChip();
  $("#settingNearDays").value = settingNear;
  $("#periodLabel").textContent = periodText();
  const now = new Date();
  $("#repMonth").value = now.toISOString().slice(0,7);
  $("#repYear").value = String(now.getFullYear());
  setEmptyRow($("#plansGrid tbody"), 7, "Loading...");
  setEmptyRow($("#repGrid tbody"), 8, "Run a report to view results.");

  sections.dashboard.innerHTML = `<div class="card"><div class="empty-state">Loading dashboard…</div></div>`;
  sections.customers.innerHTML = `<div class="card"><div class="empty-state">Loading customers…</div></div>`;
  sections.forecast.innerHTML = `<div class="card"><div class="empty-state">Loading forecast…</div></div>`;

  try{
    await Promise.all([loadPlans(), loadCustomers()]);
    onRepTypeChange();
    renderAll();
    try{
      await loadRenewals();
      renderAll();
    }catch(e){
      showErr('[load renewals]', e);
      toast("Renewal history loaded partially or slowly.", "warn", 3800);
      renderAll();
    }
  }catch(e){
    showErr('[loadApp]', e);
    toast("Some data could not load completely. Check console.", "warn", 3500);
  }
}

function bindUIOnce(){
  if(uiBound) return;
  uiBound = true;

  $("#settingNearDays").addEventListener('change', ()=>{
    settingNear = Math.max(1, +$("#settingNearDays").value || 30);
    renderAll();
  }, {passive:true});

  $$("#navGrid .nav-btn[data-tab]").forEach(btn=>{
    btn.addEventListener('click', ()=> setActiveTab(btn.dataset.tab));
  });
  $("#periodBtn").addEventListener('click', openPeriodModal);
  $("#xPeriod").addEventListener('click', ()=> $("#modalPeriod").classList.remove('open'));

  $("#btnSeedPlans").onclick = seedPlans;
  $("#btnAddPlan").onclick = ()=> openPlanModal();
  $("#btnRunReport").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); runReport(); });
  $("#btnCsv").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); exportCSV(); });
  $("#btnCleanupOrphans").onclick = cleanupOrphanRenewals;
  $("#repType").addEventListener('change', onRepTypeChange, {passive:true});
  $("#btnTogglePlans").addEventListener('click', ()=>{
    settingsPlansOpen = !settingsPlansOpen;
    renderSettingsPlansState();
  });

  $("#xCust").onclick = ()=>{ $("#modalCustomer").classList.remove('open'); };
  $("#btnToggleSmartPaste").onclick = ()=> toggleSmartPastePanel();
  $("#btnSmartPaste").onclick = autoFillCustomerFromPaste;
  $("#btnClearSmartPaste").onclick = ()=>{
    $("#c_smartPaste").value = "";
    $("#smartPasteMsg").textContent = "";
    $("#c_smartPaste").focus();
  };
  $("#c_smartPaste").addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      autoFillCustomerFromPaste();
    }
  });
  $("#xRenew").onclick = ()=> $("#modalRenew").classList.remove('open');
  $("#xPlan").onclick = ()=> $("#modalPlan").classList.remove('open');

  $("#c_stb").addEventListener('change', ()=>{
    $("#stbBox").classList.toggle('hidden', $("#c_stb").value !== 'yes');
    previewTotals();
  });
  ["#c_cost","#c_wholesale","#c_stbCost","#c_stbWholesale","#c_stb","#c_plan","#c_actual","#c_discName","#c_stbActual"].forEach(sel=>{
    $(sel).addEventListener('input', previewTotals);
    $(sel).addEventListener('change', previewTotals);
  });

  $("#c_plan").addEventListener('change', ()=>{
    const pid = $("#c_plan").value;
    const p = plans[pid] || {};
    if(!editCustomerId){
      $("#c_actual").value = p.retail_price ?? "";
      $("#c_cost").value = p.retail_price ?? "";
      $("#c_wholesale").value = p.wholesale_cost ?? "";
    }
    const dur = p.duration_months ?? 0;
    $("#c_expiry").value = addMonthsISO($("#c_start").value, dur);
    previewTotals();
  });

  $("#c_start").addEventListener('change', ()=>{
    const pid = $("#c_plan").value;
    const dur = plans[pid]?.duration_months ?? 0;
    $("#c_expiry").value = addMonthsISO($("#c_start").value, dur);
  });

  $("#r_stb").addEventListener('change', ()=>{
    $("#r_stbBox").classList.toggle('hidden', $("#r_stb").value !== 'yes');
  });

  const saveBtn = $("#btnSaveCustomer");
  saveBtn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if(saveBtn.dataset.busy === '1') return;
    if(demoMode){ toast("Saving customer is disabled in demo mode.", "warn"); return; }
    saveBtn.dataset.busy = '1';
    const old = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;
    try{
      await saveCustomerFromModal();
      toast(editCustomerId ? "Customer updated." : "Customer saved.", "ok");
    }catch(err){
      showErr('[save customer]', err);
      toast(err?.message || 'Failed to save customer.', 'error', 3400);
    }finally{
      saveBtn.disabled = false;
      saveBtn.textContent = old;
      saveBtn.dataset.busy = '0';
    }
  });

  $("#btnDoRenew").onclick = doRenew;
  $("#btnSavePlan").onclick = doSavePlan;
}

// Auth handlers
$("#btnLogin").onclick = async ()=>{
  authMsg.textContent = "Signing in...";
  try{
    demoMode = false;
    await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPass.value.trim());
    authMsg.textContent = "Signed in.";
  }catch(e){
    showErr('[auth/login]', e);
    authMsg.textContent = "Sign in failed. Please check email/password.";
    toast("Sign in failed.", "error");
  }
};

$("#btnDemo").onclick = async ()=>{
  demoMode = true;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  setEnvChip();
  await loadApp();
  toast("Demo mode opened. Saving is disabled.", "warn");
};

$("#signOutBtn").onclick = async ()=>{
  if(demoMode){
    demoMode = false;
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
    setEnvChip();
    return;
  }
  await signOut(auth);
};

onAuthStateChanged(auth, async (user)=>{
  if(user){
    demoMode = false;
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    setEnvChip();
    await loadApp();
  }else if(!demoMode){
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
  }
});

// Run viewport fixes
setupIosTweaks();
