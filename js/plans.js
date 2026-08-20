import { db, doc, collection, query, orderBy, safeGetDocs, safeSetDoc, safeDeleteDoc } from "./firebase.js";
import { $, esc, toast, nonNegativeNumber, showErr } from "./utils.js";
import { isDemoMode } from "./app.js";

export let plans = {};

export function setEmptyRow(tbody, colSpan, message){
  tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-state">${esc(message)}</td></tr>`;
}

export async function loadPlans(){
  plans = {};
  const snap = await safeGetDocs(query(collection(db, "plans"), orderBy("id")), '[plans] getDocs');
  snap.forEach(d=>{ plans[d.id] = d.data(); });
  renderPlans();
}

export async function savePlan(p){
  const ref = doc(db, "plans", String(p.id));
  await safeSetDoc(ref, p, {merge:true}, '[plans] setDoc');
  plans[p.id] = p;
  renderPlans();
  refreshPlanSelects();
}

export async function deletePlan(id){
  await safeDeleteDoc(doc(db, "plans", String(id)), '[plans] deleteDoc');
  delete plans[id];
  renderPlans();
  refreshPlanSelects();
}

export function refreshPlanSelects(){
  const selList = [$("#c_plan"), $("#r_plan")];
  selList.forEach(sel=>{
    if(!sel) return;
    const curr = sel.value;
    sel.innerHTML = "";
    const ids = Object.keys(plans).sort();
    ids.forEach(id=>{
      const p = plans[id];
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${p.name} (${p.duration_months} mo)`;
      sel.appendChild(opt);
    });
    if(curr && plans[curr]) sel.value = curr;
  });
}

export function renderPlans(){
  const tbody = $("#plansGrid tbody");
  if(!tbody) return;
  tbody.innerHTML = "";
  const ids = Object.keys(plans).sort();
  if(!ids.length){ setEmptyRow(tbody, 7, "No plans found. Add a plan or seed sample plans."); refreshPlanSelects(); return; }
  ids.forEach(id=>{
    const p = plans[id];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(p.id)}</td>
      <td>${esc(p.name || '')}</td>
      <td>${esc(p.duration_months || 0)}</td>
      <td>${(+p.retail_price || 0).toFixed(2)}</td>
      <td>${(+p.wholesale_cost || 0).toFixed(2)}</td>
      <td>${esc(p.description || '')}</td>
      <td><div class="flex"><button class="btn ghost" data-edit="${esc(p.id)}">Edit</button><button class="btn danger" data-del="${esc(p.id)}">Delete</button></div></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("[data-edit]").forEach(btn=>{ btn.onclick = ()=> openPlanModal(plans[btn.getAttribute('data-edit')]); });
  tbody.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = async ()=>{
      if(isDemoMode()){ toast("Deleting plan is disabled in demo mode.", "warn"); return; }
      const pid = btn.getAttribute('data-del');
      if(confirm(`Delete plan ${pid}?`)){
        try{ await deletePlan(pid); toast("Plan deleted.", "ok"); }
        catch(e){ showErr('[plans] delete', e); toast("Failed to delete plan.", "error"); }
      }
    };
  });
  refreshPlanSelects();
}

export function openPlanModal(p=null){
  $("#planTitle").textContent = p ? "Edit Plan" : "Add Plan";
  $("#p_id").value = p?.id || "";
  $("#p_name").value = p?.name || "";
  $("#p_months").value = p?.duration_months || 1;
  $("#p_retail").value = p?.retail_price || "";
  $("#p_wholesale").value = p?.wholesale_cost || "";
  $("#p_desc").value = p?.description || "";
  $("#modalPlan").classList.add('open');
}

export async function doSavePlan(){
  if(isDemoMode()){ toast("Saving plan is disabled in demo mode.", "warn"); return; }
  const pid = $("#p_id").value.trim();
  if(!pid){ toast("Plan ID required.", "error"); return; }
  const retail = $("#p_retail").value;
  const wholesale = $("#p_wholesale").value;
  if((retail !== "" && !nonNegativeNumber(retail)) || (wholesale !== "" && !nonNegativeNumber(wholesale))){
    toast("Plan prices cannot be negative.", "error");
    return;
  }
  const btn = $("#btnSavePlan");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try{
    await savePlan({
      id: pid,
      name: $("#p_name").value.trim(),
      duration_months: +$("#p_months").value || 0,
      retail_price: +retail || 0,
      wholesale_cost: +wholesale || 0,
      description: $("#p_desc").value.trim()
    });
    $("#modalPlan").classList.remove('open');
    toast("Plan saved.", "ok");
  }catch(e){
    showErr('[plans] save', e);
    toast("Failed to save plan.", "error");
  }finally{
    btn.disabled = false;
    btn.textContent = old;
  }
}

export async function seedPlans(){
  if(isDemoMode()){ toast("Seeding plans is disabled in demo mode.", "warn"); return; }
  const samples = [
    {id:"PLN-1MO", name:"1 month", duration_months:1, retail_price:15, wholesale_cost:4.5, description:"Entry plan"},
    {id:"PLN-3MO", name:"3 months", duration_months:3, retail_price:35, wholesale_cost:13.5, description:"Most popular"},
    {id:"PLN-6MO", name:"6 months", duration_months:6, retail_price:60, wholesale_cost:25, description:"Value saver"},
    {id:"PLN-12MO", name:"12 months", duration_months:12, retail_price:110, wholesale_cost:48, description:"Yearly plan"}
  ];
  try{
    for(const p of samples) await savePlan(p);
    toast("Sample plans added.", "ok");
  }catch(e){
    showErr('[plans] seed', e);
    toast("Failed to seed plans.", "error");
  }
}
