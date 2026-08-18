const seed={
 activeBusinessId:'caravan',company:{name:'Golden Sands Trading Company',owner:"Ko'vash",caravanCut:20},
 businesses:[
  {id:'caravan',name:'Golden Sands Caravan',type:'Caravan',hold:'The Pale',location:'Dawnstar market camp',description:'Primary travelling caravan and trade hub.',status:'Active',coffers:12450},
  {id:'farm',name:'Golden Sands Farm',type:'Farm',hold:'The Pale',location:'Outside Dawnstar',description:'Company farm supplying produce and ingredients.',status:'Active',coffers:3820},
  {id:'inn',name:'Future Golden Sands Inn',type:'Inn',hold:'Unassigned',location:'Unassigned',description:'Future hospitality business.',status:'Inactive',coffers:0}
 ],
 employees:[
  {id:1,name:"Ko'vash",email:'owner@example.com',role:'Company Owner',earnings:0,assignments:{caravan:{enabled:true,permissions:['all']},farm:{enabled:true,permissions:['all']},inn:{enabled:true,permissions:['all']}}},
  {id:2,name:"Ra'zirr",email:'razirr@example.com',role:'Merchant',earnings:3250,assignments:{caravan:{enabled:true,permissions:['register','inventory_view','orders','notebook','tasks']},farm:{enabled:false,permissions:[]},inn:{enabled:false,permissions:[]}}},
  {id:3,name:"M'aiqra",email:'maiqra@example.com',role:'Caravan Hand',earnings:1480,assignments:{caravan:{enabled:true,permissions:['inventory_view','transfers','notebook','tasks']},farm:{enabled:true,permissions:['inventory_view','inventory_edit','transfers','tasks']},inn:{enabled:false,permissions:[]}}}
 ],
 inventory:[
  {id:1,businessId:'caravan',name:'Moon Monk Robes',category:'Apparel',condition:'Exquisite',qty:4,price:1650,batches:[{batchId:'b1',qty:4,contributorId:2,source:'Stock Intake'}]},
  {id:2,businessId:'caravan',name:'Khajiit Merchant Robes',category:'Apparel',condition:'Fine',qty:7,price:900,batches:[{batchId:'b2',qty:5,contributorId:1,source:'Stock Intake'},{batchId:'b3',qty:2,contributorId:3,source:'Transfer from Farm'}]},
  {id:3,businessId:'caravan',name:'Moon Sugar',category:'Ingredient',condition:'Standard',qty:23,price:95,batches:[{batchId:'b4',qty:15,contributorId:2,source:'Stock Intake'},{batchId:'b5',qty:8,contributorId:3,source:'Stock Intake'}]},
  {id:4,businessId:'farm',name:'Potato',category:'Produce',condition:'Fresh',qty:48,price:12,batches:[{batchId:'b6',qty:48,contributorId:3,source:'Harvest / Intake'}]}
 ],
 notes:[{id:1,author:"Ra'zirr",date:'16th of Last Seed',businessId:'caravan',text:'A hunter near Whiterun claims he will have ten wolf pelts tomorrow.',pinned:true}],
 history:[],transfers:[]
};
let state=JSON.parse(localStorage.getItem('gsl-phase4')||'null')||structuredClone(seed);(state.inventory||[]).forEach(item=>(item.batches||[]).forEach(batch=>{const legacy=[batch.contributorId,batch.transferById].filter(Boolean);batch.participantIds=[...new Set([...(batch.participantIds||[]),...legacy])];if(!batch.contributorId&&batch.participantIds.length)batch.contributorId=batch.participantIds[0]}));let cart=[],currentView='company';let authState={enforced:false,setupEnabled:true,needsOwnerSetup:false,user:null,permissions:{},allowedBusinessIds:null};
const $=s=>document.querySelector(s),app=$('#app');
const permissionLabels={register:'Use Register',inventory_view:'View Inventory',inventory_edit:'Edit Inventory',orders:'Create / Complete Orders',transfers:'Transfer Stock',suppliers:'Manage Suppliers',notebook:'Use Notebook',tasks:'Use Tasks',coffers:'View Coffers',coffers_edit:'Modify Coffers',employees:'Manage Employees',permissions:'Change Permissions'};
const navGroups=[['Company',[['company','◈','Company Overview'],['businesses','⌂','Businesses']]],['Current Business',[['dashboard','⌂','Dashboard'],['register','✦','Register'],['orders','◇','Orders'],['inventory','▦','Inventory'],['transfers','⇄','Transfers']]],['Caravan',[['notebook','✎','Notebook'],['employees','♟','Employees']]],['Accounting',[['coffers','◈','Coffers'],['history','≡','Sales History'],['earnings','¤','Employee Earnings']]],['Administration',[['permissions','⚙','Permissions'],['settings','☼','Settings']]]];
function save(){localStorage.setItem('gsl-phase4',JSON.stringify(state))}function money(n){return Number(n||0).toLocaleString()+' septims'}function activeBusiness(){return state.businesses.find(b=>String(b.id)===String(state.activeBusinessId))||state.businesses[0]}function inv(){return state.inventory.filter(i=>String(i.businessId)===String(state.activeBusinessId))}function empName(id){return state.employees.find(e=>e.id===id)?.name||'Unknown'}function bizName(id){return state.businesses.find(b=>b.id===id)?.name||id}function eligibleEmployees(bid=state.activeBusinessId){return state.employees.filter(e=>e.assignments?.[bid]?.enabled)}function now(){return new Date().toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
async function api(path,options={}){
  const res=await fetch(path,{
    headers:{'content-type':'application/json',...(options.headers||{})},
    ...options
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||data.reason||`API ${res.status}`);
  return data;
}
async function refreshAuth(){
  try{authState={...authState,...await api('/api/auth/me')}}
  catch(err){console.error(err)}
  renderAuthControls();
  return authState;
}
function permissionList(bid=state.activeBusinessId){
  if(authState.user?.isOwner)return ['all'];
  return authState.permissions?.[bid]||authState.permissions?.[String(bid)]||[];
}
function can(perm,bid=state.activeBusinessId){
  if(!authState.enforced&&!authState.user)return true;
  if(authState.user?.isOwner)return true;
  return permissionList(bid).includes(perm);
}
async function nativeLogin(){
  const email=$('#loginEmail')?.value.trim(),password=$('#loginPassword')?.value||'';
  try{
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    location.reload();
  }catch(err){alert(err.message)}
}
async function signOutLedger(){
  await api('/api/auth/logout',{method:'POST',body:'{}'});
  location.reload();
}
async function changeMyPassword(){
  modal('Change Password',`<div class="form-grid"><div class="field span2"><label>Current Password</label><input id="cpCurrent" type="password" class="input"></div><div class="field span2"><label>New Password</label><input id="cpNew" type="password" class="input"></div></div>`,async()=>{
    try{
      await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#cpCurrent').value,newPassword:$('#cpNew').value})});
      alert('Password changed. Please sign in again.');
      await signOutLedger();
    }catch(err){alert(err.message)}
  });
}

function showLockedLedger(){
  // Do not restructure the ledger layout. Cover it with a self-contained full-screen gate.
  document.body.style.overflow='hidden';

  let gate=document.getElementById('ledgerLoginGate');
  if(gate)gate.remove();

  gate=document.createElement('div');
  gate.id='ledgerLoginGate';
  gate.style.cssText=`
    position:fixed;
    inset:0;
    z-index:999999;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
    box-sizing:border-box;
    background:
      radial-gradient(circle at 50% 30%, rgba(111,73,31,.10), transparent 38%),
      linear-gradient(180deg,#e8d3a6 0%,#d9bd87 100%);
  `;

  gate.innerHTML=`
    <div style="
      width:min(460px,100%);
      background:#f2dfb7;
      border:1px solid rgba(95,57,25,.45);
      box-shadow:0 18px 60px rgba(37,19,8,.28);
      padding:34px 36px 32px;
      box-sizing:border-box;
      color:#2f1d10;
      font-family:Georgia,'Times New Roman',serif;
    ">
      <div style="display:flex;align-items:center;gap:15px;margin-bottom:26px;">
        <div style="
          width:62px;height:62px;border-radius:50%;
          border:3px solid #a8873d;
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:24px;color:#5d4519;
          flex:0 0 auto;
        ">GS</div>
        <div style="min-width:0;">
          <div style="font-size:25px;font-weight:700;line-height:1.08;">Golden Sands Trading Company</div>
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin-top:5px;">
            Merchant Ledger & Caravan Records
          </div>
        </div>
      </div>

      <div style="border-top:1px solid rgba(95,57,25,.22);padding-top:24px;">
        <div style="font-size:27px;font-weight:700;margin-bottom:6px;">Ledger Sign In</div>
        <div style="font-size:15px;opacity:.72;margin-bottom:24px;">Authorized employees only.</div>

        <label style="display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px;">
          Email
        </label>
        <input id="loginEmail" type="email" autocomplete="username" style="
          width:100%;box-sizing:border-box;height:46px;
          border:1px solid #a88755;background:#f8e8c8;
          padding:0 12px;font:16px Georgia,'Times New Roman',serif;
          color:#2f1d10;outline:none;margin-bottom:17px;
        ">

        <label style="display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px;">
          Password
        </label>
        <input id="loginPassword" type="password" autocomplete="current-password" style="
          width:100%;box-sizing:border-box;height:46px;
          border:1px solid #a88755;background:#f8e8c8;
          padding:0 12px;font:16px Georgia,'Times New Roman',serif;
          color:#2f1d10;outline:none;margin-bottom:20px;
        ">

        <button id="lockedLoginButton" type="button" style="
          width:100%;height:48px;border:1px solid #5a3218;
          background:#4b2a16;color:#f7e4bb;
          font:700 17px Georgia,'Times New Roman',serif;
          cursor:pointer;
        ">Enter Ledger</button>

        <div style="margin-top:18px;text-align:center;font-size:12px;opacity:.55;">
          Company records are available after authentication.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(gate);

  const submit=()=>nativeLogin();
  gate.querySelector('#lockedLoginButton').onclick=submit;
  gate.querySelector('#loginEmail').addEventListener('keydown',e=>{if(e.key==='Enter')submit()});
  gate.querySelector('#loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')submit()});
  setTimeout(()=>gate.querySelector('#loginEmail')?.focus(),0);
}

function showNativeLogin(required=true){
  $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal" style="max-width:430px"><h3>Sign in to ${state.company?.name||'the Ledger'}</h3><div class="form-grid"><div class="field span2"><label>Email</label><input id="loginEmail" class="input" type="email" autocomplete="username"></div><div class="field span2"><label>Password</label><input id="loginPassword" class="input" type="password" autocomplete="current-password"></div></div><div class="modal-actions">${required?'':'<button class="btn ghost" onclick="closeModal()">Cancel</button>'}<button class="btn" onclick="nativeLogin()">Sign In</button></div></div></div>`;
}
function renderAuthControls(){
  const right=document.querySelector('.topbar-right');if(!right)return;
  let a=document.getElementById('authControls');
  if(!a){a=document.createElement('div');a.id='authControls';a.style.cssText='display:flex;gap:8px;align-items:center;margin-left:12px';right.appendChild(a)}
  if(authState.user){
    a.innerHTML=`<span style="font-size:12px;opacity:.85">${authState.user.name} · ${authState.user.role}</span><button class="small-link" onclick="changeMyPassword()">Password</button><button class="small-link" onclick="signOutLedger()">Sign out</button>`;
  }else{
    a.innerHTML=authState.enforced?'':`<button class="small-link" onclick="showNativeLogin(false)">Sign in</button>`;
  }
}
function allowedNav(view){
  if(!authState.enforced&&!authState.user)return true;
  if(authState.user?.isOwner)return true;
  const map={company:true,owner_dashboard:!!authState.user?.isOwner,businesses:can('businesses'),dashboard:true,register:can('register'),orders:can('orders'),inventory:can('inventory_view')||can('inventory_edit'),transfers:can('transfers'),notebook:can('notebook'),employees:can('employees'),coffers:can('coffers'),history:can('register')||can('coffers'),earnings:can('employees')||can('coffers'),permissions:can('permissions'),settings:can('settings')};
  return !!map[view];
}

function mergeCore(serverState){
  const current=state.activeBusinessId;
  state={...state,...serverState};
  if(state.businesses.some(b=>String(b.id)===String(current)))state.activeBusinessId=Number(current)||current;
  else if(state.businesses[0])state.activeBusinessId=state.businesses[0].id;
  localStorage.setItem('gsl-phase4',JSON.stringify(state));
}
function remapLocalIds(maps){
  const bm=maps?.businesses||{}, em=maps?.employees||{};
  if(bm[String(state.activeBusinessId)])state.activeBusinessId=bm[String(state.activeBusinessId)];
  (state.notes||[]).forEach(n=>{if(bm[String(n.businessId)])n.businessId=bm[String(n.businessId)]});
  (state.history||[]).forEach(h=>{
    if(bm[String(h.businessId)])h.businessId=bm[String(h.businessId)];
    (h.participants||[]).forEach(p=>{if(em[String(p.id)])p.id=em[String(p.id)]});
  });
  (state.transfers||[]).forEach(t=>(t.trace||[]).forEach(x=>{
    if(em[String(x.contributorId)])x.contributorId=em[String(x.contributorId)];
    x.participantIds=(x.participantIds||[]).map(id=>em[String(id)]||id);
  }));
}
async function reloadCore(){
  const r=await api('/api/core');
  if(r.initialized){mergeCore(r.state);if(r.auth)authState={...authState,...r.auth};}
  buildBusinessSelect();applyBranding();renderAuthControls();buildNav();render();
}
async function initSharedData(){
  try{
    let r=await api('/api/core');
    if(!r.initialized){
      const boot=await api('/api/bootstrap',{method:'POST',body:JSON.stringify({state})});
      remapLocalIds(boot.maps);
      localStorage.setItem('gsl-phase4',JSON.stringify(state));
      r=await api('/api/core');
    }
    if(r.initialized){mergeCore(r.state);if(r.auth)authState={...authState,...r.auth};}
  }catch(err){
    console.error('Shared D1 initialization failed:',err);
    alert('Shared database connection failed. The ledger is using the browser copy for now.');
  }
  buildNav();buildBusinessSelect();renderNotebookPreview();applyBranding();render();
}


function applyBranding(){
  const company=state.company||{};
  const name=company.name||'Golden Sands Trading Company';
  const owner=company.owner||"Ko'vash";
  const ownerTitle=company.ownerTitle||'Company Owner';
  const subtitle=company.subtitle||'Merchant Ledger & Caravan Records';
  const initials=(company.initials||'GS').slice(0,4);

  const brandName=document.getElementById('brandCompanyName');
  const brandSubtitle=document.getElementById('brandSubtitle');
  const brandSeal=document.getElementById('brandSeal');
  const ownerName=document.getElementById('brandOwnerName');
  const ownerTitleEl=document.getElementById('brandOwnerTitle');

  if(brandName)brandName.textContent=name;
  if(brandSubtitle)brandSubtitle.textContent=subtitle;
  if(brandSeal)brandSeal.textContent=initials;
  if(ownerName)ownerName.textContent=authState.user?.name||owner;
  if(ownerTitleEl)ownerTitleEl.textContent=authState.user?.role||ownerTitle;

  document.title=name;
}

function setHead(t,e){$('#pageTitle').textContent=t;$('#eyebrow').textContent=e||activeBusiness().name;$('#pageActions').innerHTML=''}function stat(l,v,s,i='◈'){return `<div class="card stat"><span class="sigil">${i}</span><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`}function table(h,r){return `<div class="table-wrap"><table><thead><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${r.join('')}</tbody></table></div>`}
function buildNav(){$('#nav').innerHTML=navGroups.map(([g,items])=>{const visible=items.filter(([v])=>allowedNav(v));return visible.length?`<div class="nav-group-title">${g}</div>${visible.map(([v,i,l])=>`<button class="nav-item ${currentView===v?'active':''}" data-view="${v}"><span>${i}</span>${l}</button>`).join('')}`:''}).join('');document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>go(b.dataset.view))}
function buildBusinessSelect(){const s=$('#businessSelect');const actives=state.businesses.filter(b=>b.status==='Active');if(!actives.some(b=>String(b.id)===String(state.activeBusinessId))&&actives[0])state.activeBusinessId=actives[0].id;s.innerHTML=actives.map(b=>`<option value="${b.id}" ${String(b.id)===String(state.activeBusinessId)?'selected':''}>${b.name}</option>`).join('');$('#businessLocation').textContent=`${activeBusiness().hold} · ${activeBusiness().location}`;s.onchange=()=>{const selected=state.businesses.find(b=>String(b.id)===String(s.value));state.activeBusinessId=selected?selected.id:s.value;save();buildBusinessSelect();render();renderNotebookPreview()}}
function renderNotebookPreview(){const ns=state.notes.filter(n=>String(n.businessId)===String(state.activeBusinessId)).slice(0,3);$('#notebookPreview').innerHTML=ns.length?ns.map(n=>`<div class="note-preview"><strong>${n.author}</strong><time>${n.date}</time><p>${n.text}</p></div>`).join(''):'<div class="empty">No notes.</div>'}
function go(v){if(!allowedNav(v))return alert('You do not have permission to open that section.');currentView=v;buildNav();render();closeNav()}window.go=go;function closeNav(){$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show')}$('#navToggle').onclick=()=>{$('#sidebar').classList.toggle('open');$('#backdrop').classList.toggle('show')};$('#backdrop').onclick=closeNav;
function render(){({company,owner_dashboard,businesses,dashboard,register,orders,inventory,transfers,notebook,employees,coffers,history,earnings,permissions,settings}[currentView])();renderNotebookPreview()}
function company(){setHead('Company Overview','Golden Sands Trading Company');app.innerHTML=`<div class="grid g4">${stat('Company Coffers',money(state.businesses.reduce((a,b)=>a+b.coffers,0)),'Across all businesses')}${stat('Active Businesses',state.businesses.filter(b=>b.status==='Active').length,'Currently operating','⌂')}${stat('Employees',state.employees.length,'Company members','♟')}${stat('Inventory Units',state.inventory.reduce((a,b)=>a+b.qty,0),'Across all businesses','▦')}</div>`}

function owner_dashboard(){
  if(!authState.user?.isOwner){go('company');return}
  setHead('Owner Dashboard','Company-Wide Command Center');
  $('#pageActions').innerHTML='<button class="btn ghost" onclick="reloadCore()">Refresh</button>';

  const businesses=state.businesses||[];
  const inventory=state.inventory||[];
  const orders=state.orders||[];
  const history=state.history||[];
  const transfers=state.transfers||[];
  const employees=state.employees||[];

  const totalCoffers=businesses.reduce((a,b)=>a+Number(b.coffers||0),0);
  const openOrders=orders.filter(o=>!['Completed','Cancelled'].includes(o.status));
  const completedOrders=orders.filter(o=>o.status==='Completed');
  const stockUnits=inventory.reduce((a,i)=>a+Number(i.qty||0),0);
  const lowStock=inventory.filter(i=>Number(i.qty||0)<=3).sort((a,b)=>Number(a.qty||0)-Number(b.qty||0));
  const totalSales=history.reduce((a,h)=>a+Number(h.amount||0),0);
  const totalCuts=history.reduce((a,h)=>a+Number(h.companyCut||0),0);

  const businessSales=businesses.map(b=>{
    const hs=history.filter(h=>String(h.businessId)===String(b.id));
    const os=openOrders.filter(o=>String(o.businessId)===String(b.id));
    const units=inventory.filter(i=>String(i.businessId)===String(b.id)).reduce((a,i)=>a+Number(i.qty||0),0);
    return {...b,sales:hs.reduce((a,h)=>a+Number(h.amount||0),0),saleCount:hs.length,openOrders:os.length,units};
  }).sort((a,b)=>b.sales-a.sales);

  const recentSales=[...history].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8);
  const recentTransfers=[...transfers].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6);
  const topEmployees=[...employees].sort((a,b)=>Number(b.earnings||0)-Number(a.earnings||0)).slice(0,6);

  const openBusiness=(id,view='dashboard')=>{
    const selected=state.businesses.find(b=>String(b.id)===String(id));
    if(selected)state.activeBusinessId=selected.id;
    save();buildBusinessSelect();go(view);
  };
  window.ownerOpenBusiness=openBusiness;

  app.innerHTML=`
    <div class="grid g4">
      ${stat('Company Coffers',money(totalCoffers),'Across all businesses','¤')}
      ${stat('Pending Orders',openOrders.length,completedOrders.length+' completed','◇')}
      ${stat('Recorded Sales',money(totalSales),history.length+' completed sales','✦')}
      ${stat('Inventory Units',stockUnits,inventory.length+' item entries','▦')}
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <div class="toolbar"><div><span class="eyebrow">Attention</span><h3>Pending Orders</h3></div><button class="small-link" onclick="ownerOpenBusiness('${openOrders[0]?.businessId||state.activeBusinessId}','orders')">Open Orders</button></div>
        ${openOrders.length?openOrders.slice(0,6).map(o=>`<div class="supplier-row"><span><strong>${o.customerName}</strong><br><small>${businesses.find(b=>String(b.id)===String(o.businessId))?.name||'Business'} · ${o.status==='Open'?'Pending':o.status} · ${o.estimatedTime||'No estimate'}</small></span><strong>${money(o.total)}</strong></div>`).join(''):'<div class="empty">No pending orders.</div>'}
      </div>

      <div class="card">
        <span class="eyebrow">Attention</span><h3>Low Inventory</h3>
        ${lowStock.length?lowStock.slice(0,8).map(i=>`<div class="supplier-row"><span><strong>${i.name}</strong><br><small>${businesses.find(b=>String(b.id)===String(i.businessId))?.name||'Business'} · ${i.condition}</small></span><strong>${i.qty} left</strong></div>`).join(''):'<div class="empty">No low-stock items at 3 units or fewer.</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <span class="eyebrow">Company Structure</span><h3>Business Performance</h3>
      ${table(['Business','Coffers','Sales','Transactions','Open Orders','Stock',''],businessSales.map(b=>`<tr><td><strong>${b.name}</strong><br><small>${b.hold} · ${b.location}</small></td><td>${money(b.coffers)}</td><td>${money(b.sales)}</td><td>${b.saleCount}</td><td>${b.openOrders}</td><td>${b.units}</td><td><button class="small-link" onclick="ownerOpenBusiness('${b.id}')">Open</button></td></tr>`))}
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <span class="eyebrow">Sales</span><h3>Recent Sales</h3>
        ${recentSales.length?recentSales.map(h=>`<div class="supplier-row"><span><strong>${h.who}</strong><br><small>${businesses.find(b=>String(b.id)===String(h.businessId))?.name||'Business'} · ${h.detail}</small></span><strong>${money(h.amount)}</strong></div>`).join(''):'<div class="empty">No recorded sales.</div>'}
        <div class="notice" style="margin-top:10px">Company cuts recorded from sales: <strong>${money(totalCuts)}</strong></div>
      </div>

      <div class="card">
        <span class="eyebrow">Profit Distribution</span><h3>Employee Earnings</h3>
        ${topEmployees.length?topEmployees.map((e,idx)=>`<div class="supplier-row"><span><strong>${idx+1}. ${e.name}</strong><br><small>${e.role}</small></span><strong>${money(e.earnings)}</strong></div>`).join(''):'<div class="empty">No employee earnings recorded.</div>'}
        <button class="btn ghost" style="margin-top:10px" onclick="go('earnings')">View All Earnings</button>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <span class="eyebrow">Operations</span><h3>Recent Transfers</h3>
      ${recentTransfers.length?table(['Date','Item','Qty','From','To','By'],recentTransfers.map(t=>`<tr><td>${t.date}</td><td>${t.item}</td><td>${t.qty}</td><td>${t.from}</td><td>${t.to}</td><td>${t.by}</td></tr>`)):'<div class="empty">No transfers recorded.</div>'}
    </div>`;
}

function businesses(){setHead('Businesses','Company Structure');$('#pageActions').innerHTML='<button class="btn" onclick="addBusiness()">+ Add Business</button>';app.innerHTML=`<div class="business-grid">${state.businesses.map(b=>`<div class="business-card"><span class="eyebrow">${b.type}</span><h3>${b.name}</h3><p><strong>Status:</strong> ${b.status}<br><strong>Hold:</strong> ${b.hold}<br><strong>Location:</strong> ${b.location}<br>${b.description}</p><div class="quick"><button class="btn secondary" onclick="switchBusiness('${b.id}')">Open</button><button class="btn ghost" onclick="editBusiness('${b.id}')">Edit</button></div></div>`).join('')}</div>`}
window.switchBusiness=id=>{const selected=state.businesses.find(b=>String(b.id)===String(id));state.activeBusinessId=selected?selected.id:id;save();buildBusinessSelect();go('dashboard')};window.addBusiness=()=>businessModal(null);window.editBusiness=id=>businessModal(state.businesses.find(b=>b.id===id));
function businessModal(b){modal(b?'Edit Business':'Add Business',`<div class="form-grid"><div class="field span2"><label>Name</label><input id="bName" class="input" value="${b?.name||''}"></div><div class="field"><label>Type</label><input id="bType" class="input" value="${b?.type||'Shop'}"></div><div class="field"><label>Status</label><select id="bStatus" class="select"><option ${b?.status==='Active'?'selected':''}>Active</option><option ${b?.status==='Inactive'?'selected':''}>Inactive</option></select></div><div class="field"><label>Hold</label><input id="bHold" class="input" value="${b?.hold||''}"></div><div class="field"><label>Location</label><input id="bLoc" class="input" value="${b?.location||''}"></div><div class="field span2"><label>Description</label><textarea id="bDesc" class="textarea">${b?.description||''}</textarea></div></div>`,async()=>{const name=$('#bName').value.trim();if(!name)return;const payload={name,type:$('#bType').value||'Shop',status:$('#bStatus').value,hold:$('#bHold').value||'Unassigned',location:$('#bLoc').value||'Unassigned',description:$('#bDesc').value||''};if(b)await api('/api/businesses/'+b.id,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/businesses',{method:'POST',body:JSON.stringify(payload)});closeModal();await reloadCore()})}
function dashboard(){setHead('Dashboard',activeBusiness().name);app.innerHTML=`<div class="grid g4">${stat('Coffers',money(activeBusiness().coffers),'Business balance')}${stat('Stock Units',inv().reduce((a,b)=>a+b.qty,0),inv().length+' item entries','▦')}${stat('Assigned Employees',eligibleEmployees().length,'Can work here','♟')}${stat('Stock Contributors',new Set(inv().flatMap(i=>i.batches.map(b=>b.contributorId))).size,'Represented in stock','✦')}</div>`}
function register(){setHead('Register','Point of Sale · '+activeBusiness().name);app.innerHTML=`<div class="register-grid"><div class="card"><div class="toolbar"><input id="itemSearch" class="input search" placeholder="Search wares…"></div><div id="itemGrid" class="item-grid"></div></div><div><div class="card"><h3>Current Sale</h3><div id="cart"></div></div><div id="receiptPreview" class="receipt" style="margin-top:12px"></div></div></div>`;$('#itemSearch').oninput=drawItems;drawItems();drawCart()}
function drawItems(){const q=($('#itemSearch')?.value||'').toLowerCase();const items=inv().filter(i=>i.qty>0&&(i.name+' '+i.condition).toLowerCase().includes(q));$('#itemGrid').innerHTML=items.map(i=>`<button class="item" onclick="addCart(${i.id})"><strong>${i.name}</strong><small>${i.category} · ${i.condition} · ${i.qty} available</small><div class="price">${money(i.price)}</div></button>`).join('')||'<div class="empty">No wares.</div>'}
window.addCart=id=>{const i=state.inventory.find(x=>x.id===id),c=cart.find(x=>x.id===id);if(c){if(c.qty<i.qty)c.qty++}else cart.push({id:i.id,name:i.name,price:i.price,qty:1});drawCart()};window.cartQty=(id,d)=>{const c=cart.find(x=>x.id===id),i=state.inventory.find(x=>x.id===id);c.qty=Math.max(0,Math.min(i.qty,c.qty+d));if(c.qty===0)cart=cart.filter(x=>x.id!==id);drawCart()};
function previewContributors(){const map=new Map();for(const c of cart){const item=state.inventory.find(i=>i.id===c.id);let need=c.qty;for(const b of item.batches){if(need<=0)break;const used=Math.min(need,b.qty);if(used>0){const ids=[...new Set([...(b.participantIds||[]),b.contributorId].filter(Boolean))];ids.forEach(id=>map.set(id,(map.get(id)||0)+used));need-=used}}}return [...map.entries()].map(([id,units])=>({id,name:empName(id),units}))}
function calcReceipt(){const subtotal=cart.reduce((a,b)=>a+b.price*b.qty,0),discount=Math.max(0,Math.min(100,Number($('#discount')?.value)||0)),sale=Math.round(subtotal*(1-discount/100)),cut=Math.round(sale*(state.company.caravanCut/100));return{subtotal,discount,sale,cut,pool:sale-cut}}
function drawCart(){const el=$('#cart');if(!el)return;el.innerHTML=cart.length?cart.map(c=>`<div class="cart-row"><div><strong>${c.name}</strong><small>${money(c.price)} each</small></div><div class="qty-controls"><button class="qty" onclick="cartQty(${c.id},-1)">−</button><strong>${c.qty}</strong><button class="qty" onclick="cartQty(${c.id},1)">+</button></div></div>`).join(''):'<div class="empty">No items added.</div>';const es=eligibleEmployees();el.innerHTML+=`<div class="form-grid" style="margin-top:12px"><div class="field"><label>Discount %</label><input id="discount" class="input" type="number" min="0" max="100" value="0"></div><div class="field"><label>Seller / Cashier</label><select id="seller" class="select">${es.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div></div><div class="field" style="margin-top:10px"><label>Additional Participants</label><div class="permission-grid">${es.map(e=>`<label class="perm"><input class="extraPart" type="checkbox" value="${e.id}" onchange="drawReceipt()"> ${e.name}</label>`).join('')}</div></div><button class="btn" style="width:100%;margin-top:12px" onclick="completeSale()">Complete Sale</button>`;$('#discount').oninput=drawReceipt;$('#seller').onchange=drawReceipt;drawReceipt()}
function drawReceipt(){const r=calcReceipt(),contributors=previewContributors(),sellerId=Number($('#seller')?.value||0),extras=[...document.querySelectorAll('.extraPart:checked')].map(x=>Number(x.value)),participants=[...new Set([sellerId,...contributors.map(c=>c.id),...extras].filter(Boolean))],share=participants.length?Math.floor(r.pool/participants.length):0;$('#receiptPreview').innerHTML=`<h3>${activeBusiness().name}</h3><div class="merchant">${state.company.name}</div>${cart.map(c=>`<div class="receipt-line"><span>${c.name} × ${c.qty}</span><span>${money(c.price*c.qty)}</span></div>`).join('')}<div class="receipt-line"><span>Sale Amount</span><strong>${money(r.sale)}</strong></div><div class="receipt-line"><span>Company Cut (${state.company.caravanCut}%)</span><strong>${money(r.cut)}</strong></div><div class="receipt-section"><strong>Seller</strong><div class="role-line"><span>${empName(sellerId)}</span><span>Seller</span></div></div><div class="receipt-section"><strong>Stock / Transfer Contributors</strong>${contributors.length?contributors.map(c=>`<div class="role-line"><span>${c.name}</span><span>${c.units} unit${c.units===1?'':'s'} linked</span></div>`).join(''):'<div class="role-line"><span>None detected</span><span>—</span></div>'}</div><div class="receipt-section"><strong>Additional Participants</strong>${extras.length?extras.map(id=>`<div class="role-line"><span>${empName(id)}</span><span>Added manually</span></div>`).join(''):'<div class="role-line"><span>None</span><span>—</span></div>'}</div><div class="receipt-section"><strong>Profit Split Preview</strong>${participants.map(id=>`<div class="role-line"><span>${empName(id)}</span><span>${money(share)}</span></div>`).join('')}</div><div class="receipt-total"><span>Customer Pays</span><strong>${money(r.sale)}</strong></div>`}
function consumeBatches(item,qty){let need=qty,used=[];for(const b of item.batches){if(need<=0)break;const take=Math.min(need,b.qty);if(take>0){used.push({contributorId:b.contributorId,participantIds:[...new Set([...(b.participantIds||[]),b.contributorId].filter(Boolean))],qty:take,source:b.source});b.qty-=take;need-=take}}item.batches=item.batches.filter(b=>b.qty>0);item.qty-=qty;return used}
window.completeSale=async()=>{if(!cart.length)return alert('Add at least one item.');const sellerId=Number($('#seller').value),discount=Math.max(0,Math.min(100,Number($('#discount').value)||0)),extras=[...document.querySelectorAll('.extraPart:checked')].map(x=>Number(x.value));await api('/api/sales',{method:'POST',body:JSON.stringify({businessId:state.activeBusinessId,sellerId,discount,companyCutPercent:state.company.caravanCut,extraParticipantIds:extras,items:cart.map(c=>({inventoryEntryId:c.id,qty:c.qty,price:c.price}))})});cart=[];await reloadCore();alert('Sale recorded in shared ledger.')}

function orders(){
  setHead('Orders','Pending Client Orders · '+activeBusiness().name);
  $('#pageActions').innerHTML='<button class="btn" onclick="newOrder()">+ New Order</button>';
  const rows=(state.orders||[]).filter(o=>String(o.businessId)===String(state.activeBusinessId));
  app.innerHTML=`
    <div class="business-grid">
      ${rows.map(o=>`
        <div class="business-card">
          <span class="eyebrow">${o.status==='Open'?'Pending':o.status}</span>
          <h3>${o.customerName}</h3>
          <p>
            <strong>Hold Delivery:</strong> ${o.holdDelivery||'—'}<br>
            <strong>Estimated Time:</strong> ${o.estimatedTime||'—'}<br>
            <strong>Received By:</strong> ${o.receivedByName||'Unknown'}<br>
            <strong>Order Total:</strong> ${money(o.total)}
          </p>
          <div style="margin-top:10px">
            ${(o.items||[]).map(i=>`
              <div class="supplier-row">
                <span>${i.name} × ${i.qty}</span>
                <strong>${money(i.price*i.qty)}</strong>
              </div>`).join('')}
          </div>
          ${o.status==='Completed'?`
            <div class="notice" style="margin-top:10px">
              Fulfilled${o.saleId?' · Sale #'+o.saleId:''}
            </div>`:''}
          <div class="quick" style="margin-top:12px">
            ${!['Completed','Cancelled'].includes(o.status)?`
              <button class="btn secondary" onclick="fulfillOrder(${o.id})">Fulfill Order</button>
              <button class="btn ghost" onclick="setOrderStatus(${o.id},'In Progress')">In Progress</button>
              ${o.status!=='Open'?`<button class="btn ghost" onclick="setOrderStatus(${o.id},'Open')">Pending</button>`:''}
              <button class="btn ghost" onclick="setOrderStatus(${o.id},'Cancelled')">Cancel</button>
            `:''}
          </div>
        </div>`).join('')||'<div class="empty">No orders for this business.</div>'}
    </div>`;
}

let orderDraftItems=[];

function orderItemRowHtml(i,index){
  return `
    <div class="assignment-block" style="margin-bottom:10px">
      <div class="assignment-head">
        <strong>${i.name}</strong>
        <button class="small-link" type="button" onclick="removeOrderDraftItem(${index})">Remove</button>
      </div>
      <div class="form-grid">
        <div class="field">
          <label>Quantity Needed</label>
          <input class="input orderDraftQty" data-index="${index}" type="number" min="1" value="${i.qty||1}">
        </div>
        <div class="field">
          <label>Negotiated Unit Price</label>
          <input class="input orderDraftPrice" data-index="${index}" type="number" min="0" value="${i.price||0}">
        </div>
      </div>
    </div>`;
}

function redrawOrderDraft(){
  const host=$('#orderDraftItems');
  if(!host)return;
  host.innerHTML=orderDraftItems.map(orderItemRowHtml).join('')||'<div class="empty">No items added yet.</div>';
}

window.removeOrderDraftItem=index=>{
  orderDraftItems.splice(index,1);
  redrawOrderDraft();
};

window.addInventoryItemToOrder=()=>{
  const id=Number($('#orderInventoryPick')?.value);
  const item=state.inventory.find(x=>x.id===id);
  if(!item)return;
  orderDraftItems.push({
    itemId:item.itemId,
    inventoryEntryId:item.id,
    name:item.name,
    category:item.category||'Misc',
    condition:item.condition||'Standard',
    qty:1,
    price:item.price||0
  });
  redrawOrderDraft();
};

window.addCustomItemToOrder=()=>{
  const name=$('#customOrderItemName')?.value.trim();
  if(!name)return alert('Enter the custom item name.');
  orderDraftItems.push({
    itemId:null,
    inventoryEntryId:null,
    name,
    category:'Misc',
    condition:'Standard',
    qty:Math.max(1,Number($('#customOrderItemQty')?.value)||1),
    price:Math.max(0,Number($('#customOrderItemPrice')?.value)||0)
  });
  $('#customOrderItemName').value='';
  $('#customOrderItemQty').value='1';
  $('#customOrderItemPrice').value='0';
  redrawOrderDraft();
};

window.newOrder=()=>{
  orderDraftItems=[];
  const es=eligibleEmployees();
  modal('Create Pending Order',`
    <div class="form-grid">
      <div class="field">
        <label>Name</label>
        <input id="orderCustomerName" class="input">
      </div>
      <div class="field">
        <label>Hold Delivery</label>
        <input id="orderHold" class="input">
      </div>
      <div class="field">
        <label>Estimated Time</label>
        <input id="orderEstimatedTime" class="input" placeholder="Example: 2 days / tomorrow evening">
      </div>
      <div class="field">
        <label>Employee That Received Order</label>
        <select id="orderReceiver" class="select">
          ${es.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Add From Current Inventory</h3>
      <div class="form-grid">
        <div class="field span2">
          <label>Item</label>
          <select id="orderInventoryPick" class="select">
            ${inv().map(i=>`<option value="${i.id}">${i.name} · ${i.condition} · ${i.qty} in stock</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn secondary" type="button" onclick="addInventoryItemToOrder()">Add Selected Item</button>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Create Custom Order Item</h3>
      <div class="form-grid">
        <div class="field span2">
          <label>Item Name</label>
          <input id="customOrderItemName" class="input">
        </div>
        <div class="field">
          <label>Quantity Needed</label>
          <input id="customOrderItemQty" type="number" min="1" value="1" class="input">
        </div>
        <div class="field">
          <label>Negotiated Unit Price</label>
          <input id="customOrderItemPrice" type="number" min="0" value="0" class="input">
        </div>
      </div>
      <button class="btn secondary" type="button" onclick="addCustomItemToOrder()">Add Custom Item</button>
    </div>

    <div style="margin-top:14px">
      <h3>Order Items</h3>
      <div id="orderDraftItems"><div class="empty">No items added yet.</div></div>
    </div>
  `,async()=>{
    document.querySelectorAll('.orderDraftQty').forEach(el=>{
      const i=Number(el.dataset.index); if(orderDraftItems[i])orderDraftItems[i].qty=Math.max(1,Number(el.value)||1);
    });
    document.querySelectorAll('.orderDraftPrice').forEach(el=>{
      const i=Number(el.dataset.index); if(orderDraftItems[i])orderDraftItems[i].price=Math.max(0,Number(el.value)||0);
    });

    const customerName=$('#orderCustomerName').value.trim();
    const holdDelivery=$('#orderHold').value.trim();
    const estimatedTime=$('#orderEstimatedTime').value.trim();
    if(!customerName||!holdDelivery||!estimatedTime)return alert('Complete Name, Hold Delivery, and Estimated Time.');
    if(!orderDraftItems.length)return alert('Add at least one item.');

    try{
      const result=await api('/api/orders',{
        method:'POST',
        body:JSON.stringify({
          businessId:state.activeBusinessId,
          customerName,
          holdDelivery,
          estimatedTime,
          receivedByEmployeeId:Number($('#orderReceiver').value),
          items:orderDraftItems
        })
      });

      if(result?.core?.initialized){
        mergeCore(result.core.state);
        if(result.core.auth)authState={...authState,...result.core.auth};
      }

      closeModal();
      await reloadCore();
      go('orders');
      alert(`Order received successfully.\nPending Order #${result.orderId||''}`);
    }catch(err){
      console.error('Order creation failed:',err);
      alert('Order could not be saved: '+err.message);
    }
  });
};

window.setOrderStatus=async(id,status)=>{
  await api('/api/orders/'+id+'/status',{
    method:'PATCH',
    body:JSON.stringify({status})
  });
  await reloadCore();
  go('orders');
};

window.fulfillOrder=async id=>{
  let preview;
  try{
    preview=await api('/api/orders/'+id+'/preview');
  }catch(err){return alert(err.message)}

  const order=(state.orders||[]).find(o=>o.id===id);
  const es=eligibleEmployees();

  modal('Fulfill Order',`
    <div class="notice">
      <strong>${order?.customerName||'Client'}</strong><br>
      Delivery: ${order?.holdDelivery||'—'}<br>
      Negotiated Total: ${money(order?.total||0)}
    </div>

    <div style="margin-top:14px">
      <h3>Inventory Check</h3>
      ${preview.items.map(i=>`
        <div class="supplier-row">
          <span>${i.name} × ${i.needed}</span>
          <strong>${i.available} available ${i.available>=i.needed?'✓':'✗'}</strong>
        </div>`).join('')}
    </div>

    ${preview.canFulfill?`
      <div class="field" style="margin-top:14px">
        <label>Additional Participants</label>
        <div class="permission-grid">
          ${es.map(e=>`<label class="perm"><input class="orderExtraPart" type="checkbox" value="${e.id}"> ${e.name}</label>`).join('')}
        </div>
      </div>
      <div class="receipt" style="margin-top:14px">
        <h3>${activeBusiness().name}</h3>
        <div class="merchant">${state.company.name}</div>
        ${(order?.items||[]).map(i=>`
          <div class="receipt-line">
            <span>${i.name} × ${i.qty}</span>
            <span>${money(i.price*i.qty)}</span>
          </div>`).join('')}
        <div class="receipt-line">
          <span>Order Total</span>
          <strong>${money(order?.total||0)}</strong>
        </div>
        <div class="receipt-line">
          <span>Company Cut (${state.company.caravanCut}%)</span>
          <strong>${money(Math.round((order?.total||0)*state.company.caravanCut/100))}</strong>
        </div>
        <div class="receipt-section">
          <strong>Order Receiver</strong>
          <div class="role-line"><span>${order?.receivedByName||'Unknown'}</span><span>Auto included</span></div>
        </div>
        <div class="receipt-section">
          <strong>Fulfilling Employee</strong>
          <div class="role-line"><span>${authState.user?.name||'Current User'}</span><span>Auto included</span></div>
        </div>
        <div class="receipt-section">
          <strong>Stock / Transfer Contributors</strong>
          <div class="role-line"><span>Calculated from consumed inventory batches</span><span>Auto included</span></div>
        </div>
      </div>
    `:`<div class="notice" style="margin-top:14px"><strong>Cannot fulfill yet.</strong><br>The business does not have enough matching inventory for the full order.</div>`}
  `,async()=>{
    if(!preview.canFulfill)return;
    const extraParticipantIds=[...document.querySelectorAll('.orderExtraPart:checked')].map(x=>Number(x.value));
    const result=await api('/api/orders/'+id+'/fulfill',{
      method:'POST',
      body:JSON.stringify({extraParticipantIds})
    });
    closeModal();
    await reloadCore();
    alert(`Order fulfilled.\\nSale: ${money(result.receipt.total)}\\nCompany cut: ${money(result.receipt.cut)}\\nEach participant: ${money(result.receipt.share)}`);
    go('orders');
  });
};


function inventory(){setHead('Inventory',activeBusiness().name);$('#pageActions').innerHTML='<button class="btn" onclick="stockIntake()">+ Stock Intake</button><button class="btn ghost" onclick="addItem()">+ New Item</button>';app.innerHTML=`<div class="card">${table(['Item','Condition','Qty','Price','Stock Provenance'],inv().map(i=>`<tr><td><strong>${i.name}</strong></td><td>${i.condition}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${i.batches.map(b=>`${b.qty} · ${[...new Set([...(b.participantIds||[]),b.contributorId].filter(Boolean))].map(empName).join(' → ')}`).join(' · ')||'—'}</td></tr>`))}</div>`}
window.addItem=()=>modal('Add New Item',`<div class="form-grid"><div class="field span2"><label>Item Name</label><input id="iName" class="input"></div><div class="field"><label>Category</label><input id="iCat" class="input"></div><div class="field"><label>Condition</label><input id="iCond" class="input" value="Standard"></div><div class="field"><label>Sale Price</label><input id="iPrice" type="number" class="input" value="0"></div></div>`,async()=>{if(!$('#iName').value.trim())return;await api('/api/inventory',{method:'POST',body:JSON.stringify({businessId:state.activeBusinessId,name:$('#iName').value.trim(),category:$('#iCat').value||'Misc',condition:$('#iCond').value||'Standard',price:Number($('#iPrice').value)||0})});closeModal();await reloadCore()})
window.stockIntake=()=>modal('Stock Intake',`<div class="form-grid"><div class="field span2"><label>Item</label><select id="siItem" class="select">${inv().map(i=>`<option value="${i.id}">${i.name} — ${i.condition}</option>`).join('')}</select></div><div class="field"><label>Quantity</label><input id="siQty" type="number" class="input" value="1"></div><div class="field"><label>Employee Adding Stock</label><select id="siEmp" class="select">${eligibleEmployees().map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div><div class="field span2"><label>Source / Note</label><input id="siSource" class="input" value="Stock Intake"></div></div>`,async()=>{await api('/api/stock-intake',{method:'POST',body:JSON.stringify({inventoryEntryId:Number($('#siItem').value),qty:Math.max(1,Number($('#siQty').value)||1),employeeId:Number($('#siEmp').value),source:$('#siSource').value||'Stock Intake'})});closeModal();await reloadCore()})
function transfers(){setHead('Transfers','Inter-Business Stock');$('#pageActions').innerHTML='<button class="btn" onclick="newTransfer()">+ Transfer Stock</button>';app.innerHTML=`<div class="card">${table(['Date','Item','Qty','From','To','By','Contributor Trace'],state.transfers.map(t=>`<tr><td>${t.date}</td><td>${t.item}</td><td>${t.qty}</td><td>${t.from}</td><td>${t.to}</td><td>${t.by}</td><td>${t.trace.map(x=>`${x.qty} · ${[...new Set([...(x.participantIds||[]),x.contributorId].filter(Boolean))].map(empName).join(' → ')}`).join(' · ')}</td></tr>`))}</div>`}
window.newTransfer=()=>modal('Transfer Stock',`<div class="form-grid"><div class="field span2"><label>Item</label><select id="trItem" class="select">${inv().map(i=>`<option value="${i.id}">${i.name} (${i.qty})</option>`).join('')}</select></div><div class="field"><label>Quantity</label><input id="trQty" type="number" class="input" value="1"></div><div class="field"><label>Destination</label><select id="trDest" class="select">${state.businesses.filter(b=>b.id!==state.activeBusinessId&&b.status==='Active').map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select></div><div class="field span2"><label>Employee Making Transfer</label><select id="trEmp" class="select">${eligibleEmployees().map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div></div>`,async()=>{await api('/api/transfers',{method:'POST',body:JSON.stringify({inventoryEntryId:Number($('#trItem').value),qty:Math.max(1,Number($('#trQty').value)||1),toBusinessId:Number($('#trDest').value),employeeId:Number($('#trEmp').value)})});closeModal();await reloadCore()})
function notebook(){setHead('Caravan Notebook','In-Character Notices');$('#pageActions').innerHTML='<button class="btn" onclick="newNote()">+ Write Note</button>';app.innerHTML=`<div class="grid g2">${state.notes.filter(n=>String(n.businessId)===String(state.activeBusinessId)).map(n=>`<div class="scroll-card"><span class="eyebrow">${n.date}</span><h3>${n.author}</h3><p>${n.text}</p></div>`).join('')||'<div class="empty">No notes.</div>'}</div>`}window.newNote=()=>modal('Write Note','<div class="field"><label>Notice</label><textarea id="nText" class="textarea"></textarea></div>',async()=>{const text=$('#nText').value.trim();if(!text)return;const author=eligibleEmployees()[0]||state.employees[0];await api('/api/notebook',{method:'POST',body:JSON.stringify({businessId:state.activeBusinessId,employeeId:author?.id||null,text,pinned:false})});closeModal();await reloadCore()})
function employees(){setHead('Employees','Company Staff');$('#pageActions').innerHTML='<button class="btn" onclick="addEmployee()">+ Employee</button>';app.innerHTML=`<div class="business-grid">${state.employees.map(e=>`<div class="business-card"><span class="eyebrow">${e.role}</span><h3>${e.name}</h3><p>${e.email}</p>${state.businesses.map(b=>`<div class="supplier-row"><span>${b.name}</span><strong>${e.assignments?.[b.id]?.enabled?'Allowed':'No Access'}</strong></div>`).join('')}<div class="quick" style="margin-top:10px"><button class="btn ghost" onclick="editEmployee(${e.id})">Edit Access</button></div></div>`).join('')}</div>`}
window.addEmployee=()=>modal('Add Employee','<div class="form-grid"><div class="field"><label>Name</label><input id="eName" class="input"></div><div class="field"><label>Login Email</label><input id="eEmail" class="input" type="email"></div><div class="field"><label>Role</label><input id="eRole" class="input" value="Merchant"></div><div class="field"><label>Temporary Password</label><input id="ePassword" class="input" type="password" placeholder="10+ characters"></div></div>',async()=>{if(!$('#eName').value.trim()||!$('#eEmail').value.trim()||!$('#ePassword').value)return;await api('/api/employees',{method:'POST',body:JSON.stringify({name:$('#eName').value.trim(),email:$('#eEmail').value.trim(),role:$('#eRole').value||'Merchant',password:$('#ePassword').value})});closeModal();await reloadCore()})
window.editEmployee=id=>{const e=state.employees.find(x=>x.id===id);modal('Edit Employee',`<div class="form-grid" style="margin-bottom:14px"><div class="field"><label>Name</label><input id="editEmpName" class="input" value="${e.name||''}"></div><div class="field"><label>Login Email</label><input id="editEmpEmail" class="input" type="email" value="${e.email||''}"></div><div class="field"><label>Company Role</label><input id="editEmpRole" class="input" value="${e.role||'Employee'}"></div><div class="field"><label>Reset Password (optional)</label><input id="editEmpPassword" type="password" class="input" placeholder="Leave blank to keep current"></div></div><div class="grid g2">${state.businesses.map(b=>`<div class="assignment-block"><div class="assignment-head"><strong>${b.name}</strong><label><input class="bizEnabled" data-biz="${b.id}" type="checkbox" ${e.assignments?.[b.id]?.enabled?'checked':''}> Can Work Here</label></div><div class="permission-grid">${Object.entries(permissionLabels).map(([k,l])=>`<label class="perm"><input class="bizPerm" data-biz="${b.id}" data-perm="${k}" type="checkbox" ${e.assignments?.[b.id]?.permissions?.includes(k)||e.assignments?.[b.id]?.permissions?.includes('all')?'checked':''}> ${l}</label>`).join('')}</div></div>`).join('')}</div>`,async()=>{const assignments={};state.businesses.forEach(b=>{assignments[b.id]={enabled:document.querySelector(`.bizEnabled[data-biz="${b.id}"]`).checked,permissions:[...document.querySelectorAll(`.bizPerm[data-biz="${b.id}"]:checked`)].map(x=>x.dataset.perm)}});await api('/api/employees/'+id,{method:'PUT',body:JSON.stringify({name:$('#editEmpName').value.trim(),email:$('#editEmpEmail').value.trim(),role:$('#editEmpRole').value.trim()||'Employee'})});await api('/api/employees/'+id+'/access',{method:'PUT',body:JSON.stringify({assignments})});if($('#editEmpPassword').value)await api('/api/employees/'+id+'/password',{method:'PUT',body:JSON.stringify({password:$('#editEmpPassword').value,mustChange:true})});closeModal();await reloadCore()})}
function coffers(){setHead('Coffers',activeBusiness().name);app.innerHTML=`<div class="grid g3">${stat('Current Balance',money(activeBusiness().coffers),'Business funds')}${stat('Company Cut',state.company.caravanCut+'%','Default sale cut','%')}${stat('Company Total',money(state.businesses.reduce((a,b)=>a+b.coffers,0)),'All businesses','¤')}</div>`}function history(){setHead('Sales History','Audit Ledger');app.innerHTML=`<div class="card">${table(['Date','Seller','Items','Sale','Company Cut','Participants'],state.history.filter(h=>String(h.businessId)===String(state.activeBusinessId)).map(h=>`<tr><td>${h.date}</td><td>${h.who}</td><td>${h.detail}</td><td>${money(h.amount)}</td><td>${money(h.companyCut)}</td><td>${h.participants?.map(p=>`${p.name} (${p.roles.join('/')})`).join(' · ')||'—'}</td></tr>`))}</div>`}function earnings(){setHead('Employee Earnings','Profit Distribution');app.innerHTML=`<div class="business-grid">${state.employees.map(e=>`<div class="business-card"><span class="eyebrow">${e.role}</span><h3>${e.name}</h3><div class="stat" style="min-height:0"><div class="value">${money(e.earnings)}</div><div class="sub">Recorded earnings</div></div></div>`).join('')}</div>`}function permissions(){setHead('Permissions','Business-Scoped Access');app.innerHTML='<div class="notice">Permissions are now stored per employee per business. Use Employees → Edit Access to decide where each employee can work and what they can do there.</div>'}function settings(){
  setHead("Settings","Company Configuration");
  app.innerHTML=`
  <div class="grid g2">
    <div class="card">
      <h3>Company Branding</h3>
      <div class="form-grid">
        <div class="field span2"><label>Company Name</label><input id="setCompanyName" class="input" value="${state.company.name||""}"></div>
        <div class="field"><label>Short Name</label><input id="setShortName" class="input" value="${state.company.shortName||""}"></div>
        <div class="field"><label>Seal Initials</label><input id="setInitials" class="input" maxlength="4" value="${state.company.initials||""}"></div>
        <div class="field span2"><label>Ledger Subtitle</label><input id="setSubtitle" class="input" value="${state.company.subtitle||""}"></div>
        <div class="field"><label>Owner / Director Name</label><input id="setOwner" class="input" value="${state.company.owner||""}"></div>
        <div class="field"><label>Owner Title</label><input id="setOwnerTitle" class="input" value="${state.company.ownerTitle||""}"></div>
      </div>
      <button class="btn" style="margin-top:10px" onclick="saveCompanyBranding()">Save Branding</button>
    </div>
    <div class="card">
      <h3>Profit Rules</h3>
      <div class="field"><label>Default Company Cut %</label><input id="setCut" class="input" type="number" min="0" max="100" value="${state.company.caravanCut}"></div>
      <button class="btn" style="margin-top:10px" onclick="saveCut()">Save Cut</button>
      <div class="notice" style="margin-top:12px">These branding fields let the ledger be reused for another company without changing the website code.</div>
    </div>
  </div>`;
}window.saveCut=async()=>{const cut=Math.max(0,Math.min(100,Number($('#setCut').value)||0));await api('/api/company',{method:'PATCH',body:JSON.stringify({...state.company,caravanCut:cut})});await reloadCore()}
function modal(title,body,onSave){$('#modalRoot').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>${title}</h3>${body}<div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button id="modalSave" class="btn">Save</button></div></div></div>`;$('#modalSave').onclick=onSave}window.closeModal=()=>$('#modalRoot').innerHTML='';
(async()=>{
  await refreshAuth();
  // Never render company records until a user has authenticated.
  // The server's `enforced` flag can be false/absent during startup, so
  // gating only on that flag allowed the ledger shell to appear signed out.
  if(!authState.user){
    showLockedLedger();
    return;
  }
  document.body.style.overflow='';
  document.getElementById('ledgerLoginGate')?.remove();
  await initSharedData();
})();
