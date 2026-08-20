import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "./firebase.js";
import { $, $$, toast, showErr, daysLeft, setupIosTweaks, addMonthsISO } from "./utils.js";
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
  const wrap = $("#settingsPlansWrap");
  const btn = $("#btnTogglePlans");
  if(wrap) wrap.classList.toggle('hidden', !settingsPlansOpen);
  if(btn) btn.textContent = settingsPlansOpen ? 'Hide Plans' : 'Manage Plans';
}

export function renderKPIs(){
  // "Expiring Soon" count across ALL customers
  const topNear = customers.filter(c => { 
    const d = daysLeft((c.currentPlan || {}).expiryDate); 
    return d >= 0 && d <= settingNear; 
  }).length;
  
  const nearPill = $("#nearExpCount");
  if(nearPill) nearPill.textContent = `Expiring soon: ${topNear}`;
}

export function renderAll(){
  const periodLbl = $("#periodLabel");
  if(periodLbl) periodLbl.textContent = periodText();
  
  renderKPIs();
  renderDashboard();
  renderCustomers();
  renderForecast();
  renderPlans();
  runReport();
  renderSettingsPlansState();
  
  const nearInput = $("#settingNearDays");
  if(nearInput) nearInput.value = settingNear;
}

export async function loadApp(){
  bindUIOnce();
  setEnvChip();
  
  const nearInput = $("#settingNearDays");
  if(nearInput) nearInput.value = settingNear;
  
  const periodLbl = $("#periodLabel");
  if(periodLbl) periodLbl.textContent = periodText();
  
  const now = new Date();
  const repMonth = $("#repMonth");
  if(repMonth) repMonth.value = now.toISOString().slice(0,7);
  
  const repYear = $("#repYear");
  if(repYear) repYear.value = String(now.getFullYear());
  
  const plansTbody = $("#plansGrid tbody");
  if(plansTbody) setEmptyRow(plansTbody, 7, "Loading...");
  
  const repTbody = $("#repGrid tbody");
  if(repTbody) setEmptyRow(repTbody, 8, "Run a report to view results.");

  if(sections.dashboard) sections.dashboard.innerHTML = `<div class="card"><div class="empty-state">Loading dashboard…</div></div>`;
  if(sections.customers) sections.customers.innerHTML = `<div class="card"><div class="empty-state">Loading customers…</div></div>`;
  if(sections.forecast) sections.forecast.innerHTML = `<div class="card"><div class="empty-state">Loading forecast…</div></div>`;

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

  const nearInput = $("#settingNearDays");
  if(nearInput){
    nearInput.addEventListener('change', ()=>{
      settingNear = Math.max(1, +nearInput.value || 30);
      renderAll();
    }, {passive:true});
  }

  $$("#navGrid .nav-btn[data-tab]").forEach(btn=>{
    btn.addEventListener('click', ()=> setActiveTab(btn.dataset.tab));
  });
  
  const periodBtn = $("#periodBtn");
  if(periodBtn) periodBtn.addEventListener('click', openPeriodModal);
  
  const xPeriod = $("#xPeriod");
  if(xPeriod) xPeriod.addEventListener('click', ()=> $("#modalPeriod").classList.remove('open'));

  const btnSeedPlans = $("#btnSeedPlans");
  if(btnSeedPlans) btnSeedPlans.onclick = seedPlans;
  
  const btnAddPlan = $("#btnAddPlan");
  if(btnAddPlan) btnAddPlan.onclick = ()=> openPlanModal();
  
  const btnRunReport = $("#btnRunReport");
  if(btnRunReport) btnRunReport.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); runReport(); });
  
  const btnCsv = $("#btnCsv");
  if(btnCsv) btnCsv.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); exportCSV(); });
  
  const btnCleanupOrphans = $("#btnCleanupOrphans");
  if(btnCleanupOrphans) btnCleanupOrphans.onclick = cleanupOrphanRenewals;
  
  const repType = $("#repType");
  if(repType) repType.addEventListener('change', onRepTypeChange, {passive:true});
  
  const btnTogglePlans = $("#btnTogglePlans");
  if(btnTogglePlans) btnTogglePlans.addEventListener('click', ()=>{
    settingsPlansOpen = !settingsPlansOpen;
    renderSettingsPlansState();
  });

  const xCust = $("#xCust");
  if(xCust) xCust.onclick = ()=>{ $("#modalCustomer").classList.remove('open'); };
  
  const btnToggleSmartPaste = $("#btnToggleSmartPaste");
  if(btnToggleSmartPaste) btnToggleSmartPaste.onclick = ()=> toggleSmartPastePanel();
  
  const btnSmartPaste = $("#btnSmartPaste");
  if(btnSmartPaste) btnSmartPaste.onclick = autoFillCustomerFromPaste;
  
  const btnClearSmartPaste = $("#btnClearSmartPaste");
  if(btnClearSmartPaste) btnClearSmartPaste.onclick = ()=>{
    const cSmartPaste = $("#c_smartPaste");
    if(cSmartPaste) {
      cSmartPaste.value = "";
      cSmartPaste.focus();
    }
    const spMsg = $("#smartPasteMsg");
    if(spMsg) spMsg.textContent = "";
  };
  
  const cSmartPaste = $("#c_smartPaste");
  if(cSmartPaste) {
    cSmartPaste.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        autoFillCustomerFromPaste();
      }
    });
  }
  
  const xRenew = $("#xRenew");
  if(xRenew) xRenew.onclick = ()=> $("#modalRenew").classList.remove('open');
  
  const xPlan = $("#xPlan");
  if(xPlan) xPlan.onclick = ()=> $("#modalPlan").classList.remove('open');

  const cStb = $("#c_stb");
  if(cStb) {
    cStb.addEventListener('change', ()=>{
      const stbBox = $("#stbBox");
      if(stbBox) stbBox.classList.toggle('hidden', cStb.value !== 'yes');
      previewTotals();
    });
  }
  
  ["#c_cost","#c_wholesale","#c_stbCost","#c_stbWholesale","#c_stb","#c_plan","#c_actual","#c_discName","#c_stbActual"].forEach(sel=>{
    const el = $(sel);
    if(el){
      el.addEventListener('input', previewTotals);
      el.addEventListener('change', previewTotals);
    }
  });

  const cPlan = $("#c_plan");
  if(cPlan){
    cPlan.addEventListener('change', ()=>{
      const pid = cPlan.value;
      const p = plans[pid] || {};
      if(!editCustomerId){
        const actual = $("#c_actual"); if(actual) actual.value = p.retail_price ?? "";
        const cost = $("#c_cost"); if(cost) cost.value = p.retail_price ?? "";
        const whole = $("#c_wholesale"); if(whole) whole.value = p.wholesale_cost ?? "";
      }
      const dur = p.duration_months ?? 0;
      const expiry = $("#c_expiry");
      const start = $("#c_start");
      if(expiry && start) expiry.value = addMonthsISO(start.value, dur);
      previewTotals();
    });
  }

  const cStart = $("#c_start");
  if(cStart){
    cStart.addEventListener('change', ()=>{
      const cPlanEl = $("#c_plan");
      const pid = cPlanEl ? cPlanEl.value : null;
      const dur = pid ? (plans[pid]?.duration_months ?? 0) : 0;
      const expiry = $("#c_expiry");
      if(expiry) expiry.value = addMonthsISO(cStart.value, dur);
    });
  }

  const rStb = $("#r_stb");
  if(rStb){
    rStb.addEventListener('change', ()=>{
      const rStbBox = $("#r_stbBox");
      if(rStbBox) rStbBox.classList.toggle('hidden', rStb.value !== 'yes');
    });
  }

  const saveBtn = $("#btnSaveCustomer");
  if(saveBtn){
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
  }

  const btnDoRenew = $("#btnDoRenew");
  if(btnDoRenew) btnDoRenew.onclick = doRenew;
  
  const btnSavePlan = $("#btnSavePlan");
  if(btnSavePlan) btnSavePlan.onclick = doSavePlan;
}

// Auth handlers
const btnLogin = $("#btnLogin");
if(btnLogin){
  btnLogin.onclick = async ()=>{
    if(authMsg) authMsg.textContent = "Signing in...";
    try{
      demoMode = false;
      await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPass.value.trim());
      if(authMsg) authMsg.textContent = "Signed in.";
    }catch(e){
      showErr('[auth/login]', e);
      if(authMsg) authMsg.textContent = "Sign in failed. Please check email/password.";
      toast("Sign in failed.", "error");
    }
  };
}

const btnDemo = $("#btnDemo");
if(btnDemo){
  btnDemo.onclick = async ()=>{
    demoMode = true;
    if(authView) authView.classList.add('hidden');
    if(appView) appView.classList.remove('hidden');
    setEnvChip();
    await loadApp();
    toast("Demo mode opened. Saving is disabled.", "warn");
  };
}

const signOutBtn = $("#signOutBtn");
if(signOutBtn){
  signOutBtn.onclick = async ()=>{
    if(demoMode){
      demoMode = false;
      if(appView) appView.classList.add('hidden');
      if(authView) authView.classList.remove('hidden');
      setEnvChip();
      return;
    }
    await signOut(auth);
  };
}

onAuthStateChanged(auth, async (user)=>{
  if(user){
    demoMode = false;
    if(authView) authView.classList.add('hidden');
    if(appView) appView.classList.remove('hidden');
    setEnvChip();
    await loadApp();
  }else if(!demoMode){
    if(appView) appView.classList.add('hidden');
    if(authView) authView.classList.remove('hidden');
  }
});

// Run viewport fixes
setupIosTweaks();
