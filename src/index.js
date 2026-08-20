const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) }
  });

async function readJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

async function firstCompany(env) {
  return env.DB.prepare("SELECT * FROM companies ORDER BY id LIMIT 1").first();
}


const AUTH_COOKIE = "gsl_session";
const DAY = 86400;
const PASSWORD_ITERATIONS = 100000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function authEnforced(env) {
  return String(env.AUTH_ENFORCE || "false").toLowerCase() === "true";
}
function setupEnabled(env) {
  return String(env.AUTH_SETUP_ENABLED || "true").toLowerCase() === "true";
}
function b64urlEncode(bytes) {
  let s="";
  for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlDecode(input) {
  input=input.replace(/-/g,"+").replace(/_/g,"/");
  while(input.length%4)input+="=";
  const bin=atob(input);
  return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
async function sha256(value) {
  const data=new TextEncoder().encode(value);
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256",data)));
}
function randomToken(size=32) {
  const a=new Uint8Array(size);
  crypto.getRandomValues(a);
  return b64urlEncode(a);
}
function cookieMap(request) {
  const raw=request.headers.get("cookie")||"";
  const out={};
  for(const piece of raw.split(";")){
    const i=piece.indexOf("=");
    if(i>0)out[piece.slice(0,i).trim()]=decodeURIComponent(piece.slice(i+1).trim());
  }
  return out;
}
function setCookie(name,value,maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
function constantTimeEqual(a,b) {
  const aa=new TextEncoder().encode(String(a||""));
  const bb=new TextEncoder().encode(String(b||""));
  if(aa.length!==bb.length)return false;
  let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}
async function derivePassword(password,salt,iterations=PASSWORD_ITERATIONS) {
  const key=await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    {name:"PBKDF2"},
    false,
    ["deriveBits"]
  );
  const bits=await crypto.subtle.deriveBits(
    {name:"PBKDF2",hash:"SHA-256",salt:b64urlDecode(salt),iterations:Number(iterations)},
    key,
    256
  );
  return b64urlEncode(new Uint8Array(bits));
}
function validatePassword(password) {
  if(typeof password!=="string" || password.length<10)
    throw new HttpError(400,"Password must be at least 10 characters.");
  if(password.length>128)
    throw new HttpError(400,"Password is too long.");
}
async function createPasswordRecord(env,employeeId,password,mustChange=false) {
  validatePassword(password);
  const salt=randomToken(18);
  const hash=await derivePassword(password,salt,PASSWORD_ITERATIONS);
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare(`
    INSERT INTO employee_credentials(
      employee_id,password_salt,password_hash,password_iterations,
      must_change_password,password_updated_at
    ) VALUES(?,?,?,?,?,?)
    ON CONFLICT(employee_id) DO UPDATE SET
      password_salt=excluded.password_salt,
      password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,
      must_change_password=excluded.must_change_password,
      password_updated_at=excluded.password_updated_at
  `).bind(employeeId,salt,hash,PASSWORD_ITERATIONS,mustChange?1:0,now).run();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE employee_id=?").bind(employeeId).run();
}
async function sessionUser(request,env) {
  const raw=cookieMap(request)[AUTH_COOKIE];
  if(!raw)return null;
  const hash=await sha256(raw),now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare(`
    SELECT s.session_hash,s.expires_at,
           e.id,e.company_id,e.display_name,e.email,e.company_role,
           e.status,e.is_company_owner,
           COALESCE(c.must_change_password,0) AS must_change_password
    FROM auth_sessions s
    JOIN employees e ON e.id=s.employee_id
    LEFT JOIN employee_credentials c ON c.employee_id=e.id
    WHERE s.session_hash=? AND s.expires_at>? AND e.status='Active'
  `).bind(hash,now).first();
  if(!row)return null;
  await env.DB.prepare("UPDATE auth_sessions SET last_seen_at=? WHERE session_hash=?")
    .bind(now,hash).run();
  return {
    id:row.id,
    companyId:row.company_id,
    name:row.display_name,
    email:row.email||"",
    role:row.company_role,
    isOwner:!!row.is_company_owner,
    mustChangePassword:!!row.must_change_password
  };
}
async function createSession(request,env,employee) {
  const raw=randomToken(32),hash=await sha256(raw),now=Math.floor(Date.now()/1000);
  await env.DB.prepare(`
    INSERT INTO auth_sessions(session_hash,employee_id,created_at,expires_at,last_seen_at,user_agent)
    VALUES(?,?,?,?,?,?)
  `).bind(hash,employee.id,now,now+7*DAY,now,request.headers.get("user-agent")||"").run();
  return {raw,expires:7*DAY};
}
async function loginNative(request,env) {
  const body=await readJson(request);
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  if(!email||!password)throw new HttpError(400,"Email and password are required.");

  const row=await env.DB.prepare(`
    SELECT e.*,c.password_salt,c.password_hash,c.password_iterations,c.must_change_password
    FROM employees e
    JOIN employee_credentials c ON c.employee_id=e.id
    WHERE lower(e.email)=? AND e.status='Active'
    LIMIT 1
  `).bind(email).first();

  // Perform a dummy PBKDF2 even on a missing account to reduce timing differences.
  if(!row){
    const dummySalt="AAAAAAAAAAAAAAAAAAAAAAAA";
    await derivePassword(password,dummySalt,10000);
    return json({error:"Invalid email or password."},{status:401});
  }

  const candidate=await derivePassword(password,row.password_salt,row.password_iterations);
  if(!constantTimeEqual(candidate,row.password_hash))
    return json({error:"Invalid email or password."},{status:401});

  const sess=await createSession(request,env,row);
  return new Response(JSON.stringify({
    ok:true,
    user:{
      id:row.id,name:row.display_name,email:row.email||"",
      role:row.company_role,isOwner:!!row.is_company_owner,
      mustChangePassword:!!row.must_change_password
    }
  }),{
    headers:{
      "content-type":"application/json; charset=utf-8",
      "set-cookie":setCookie(AUTH_COOKIE,sess.raw,sess.expires)
    }
  });
}
async function logoutNative(request,env) {
  const raw=cookieMap(request)[AUTH_COOKIE];
  if(raw){
    await env.DB.prepare("DELETE FROM auth_sessions WHERE session_hash=?")
      .bind(await sha256(raw)).run();
  }
  return new Response(JSON.stringify({ok:true}),{
    headers:{
      "content-type":"application/json; charset=utf-8",
      "set-cookie":clearCookie(AUTH_COOKIE)
    }
  });
}
async function authMe(request,env) {
  const user=await sessionUser(request,env);
  const ownersWithoutPassword=await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM employees e
    LEFT JOIN employee_credentials c ON c.employee_id=e.id
    WHERE e.is_company_owner=1 AND e.status='Active' AND c.employee_id IS NULL
  `).first();
  return json({
    enforced:authEnforced(env),
    setupEnabled:setupEnabled(env),
    needsOwnerSetup:Number(ownersWithoutPassword?.n||0)>0,
    user
  });
}
async function setupOwner(request,env) {
  if(!setupEnabled(env))throw new HttpError(403,"Owner setup is disabled.");
  const body=await readJson(request);
  const setupToken=String(request.headers.get("x-setup-token")||body.setupToken||"");
  const expected=String(env.AUTH_SETUP_TOKEN||"");
  if(!expected || !constantTimeEqual(setupToken,expected))
    throw new HttpError(403,"Invalid setup token.");

  const owner=await env.DB.prepare(`
    SELECT e.*
    FROM employees e
    LEFT JOIN employee_credentials c ON c.employee_id=e.id
    WHERE e.is_company_owner=1 AND e.status='Active' AND c.employee_id IS NULL
    ORDER BY e.id LIMIT 1
  `).first();
  if(!owner)throw new HttpError(409,"Owner account has already been configured.");

  const email=String(body.email||"").trim().toLowerCase();
  if(!email || !email.includes("@"))throw new HttpError(400,"Enter a valid owner email.");
  validatePassword(String(body.password||""));

  const conflict=await env.DB.prepare(
    "SELECT id FROM employees WHERE lower(email)=? AND id<>?"
  ).bind(email,owner.id).first();
  if(conflict)throw new HttpError(409,"That email is already assigned to another employee.");

  await env.DB.prepare(
    "UPDATE employees SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(email,owner.id).run();
  await createPasswordRecord(env,owner.id,String(body.password),false);

  return json({ok:true,owner:{id:owner.id,name:owner.display_name,email}});
}
async function changeOwnPassword(request,env,user) {
  if(!user)throw new HttpError(401,"Sign in required.");
  const body=await readJson(request);
  const current=String(body.currentPassword||""),next=String(body.newPassword||"");
  validatePassword(next);
  const cred=await env.DB.prepare(
    "SELECT * FROM employee_credentials WHERE employee_id=?"
  ).bind(user.id).first();
  if(!cred)throw new HttpError(400,"Password is not configured.");
  const candidate=await derivePassword(current,cred.password_salt,cred.password_iterations);
  if(!constantTimeEqual(candidate,cred.password_hash))
    throw new HttpError(401,"Current password is incorrect.");
  await createPasswordRecord(env,user.id,next,false);
  return json({ok:true});
}
async function adminSetPassword(env,employeeId,password,mustChange=true) {
  await createPasswordRecord(env,Number(employeeId),password,mustChange);
}
async function requireUser(request,env) {
  const user=await sessionUser(request,env);
  if(!user && authEnforced(env))throw new HttpError(401,"Sign in required.");
  return user;
}
async function hasBusinessPermission(env,user,businessId,permission) {
  if(!user)return !authEnforced(env);
  if(user.isOwner)return true;
  const row=await env.DB.prepare(`
    SELECT 1 ok
    FROM employee_business_access a
    JOIN employee_business_permissions p
      ON p.employee_id=a.employee_id AND p.business_id=a.business_id
    WHERE a.employee_id=? AND a.business_id=? AND a.enabled=1
      AND p.permission_code=? AND p.granted=1
    LIMIT 1
  `).bind(user.id,Number(businessId),permission).first();
  return !!row;
}
async function hasCompanyPermission(env,user,permission) {
  if(!user)return !authEnforced(env);
  if(user.isOwner)return true;
  const row=await env.DB.prepare(`
    SELECT 1 ok
    FROM employee_business_access a
    JOIN employee_business_permissions p
      ON p.employee_id=a.employee_id AND p.business_id=a.business_id
    WHERE a.employee_id=? AND a.enabled=1
      AND p.permission_code=? AND p.granted=1
    LIMIT 1
  `).bind(user.id,permission).first();
  return !!row;
}
async function requireBusinessPermission(env,user,businessId,permission) {
  if(!(await hasBusinessPermission(env,user,businessId,permission)))
    throw new HttpError(403,`Permission denied: ${permission}`);
}
async function requireCompanyPermission(env,user,permission) {
  if(!(await hasCompanyPermission(env,user,permission)))
    throw new HttpError(403,`Permission denied: ${permission}`);
}
async function authContext(env,user) {
  if(!user)return {user:null,allowedBusinessIds:null,permissions:{}};
  if(user.isOwner){
    const {results:bs}=await env.DB.prepare(
      "SELECT id FROM businesses WHERE company_id=?"
    ).bind(user.companyId).all();
    return {user,allowedBusinessIds:bs.map(x=>x.id),permissions:{owner:true}};
  }
  const {results:rows}=await env.DB.prepare(`
    SELECT a.business_id,a.enabled,p.permission_code,p.granted
    FROM employee_business_access a
    LEFT JOIN employee_business_permissions p
      ON p.employee_id=a.employee_id AND p.business_id=a.business_id
    WHERE a.employee_id=?
  `).bind(user.id).all();
  const permissions={},allowed=new Set();
  for(const r of rows){
    if(r.enabled)allowed.add(r.business_id);
    if(r.enabled&&r.granted&&r.permission_code){
      if(!permissions[r.business_id])permissions[r.business_id]=[];
      permissions[r.business_id].push(r.permission_code);
    }
  }
  return {user,allowedBusinessIds:[...allowed],permissions};
}
function filterCoreForAuth(core,ctx) {
  if(!core?.initialized||!ctx.user||ctx.user.isOwner){
    if(core?.initialized)core.auth=ctx;
    return core;
  }
  const allowed=new Set((ctx.allowedBusinessIds||[]).map(String)),s=core.state;
  s.businesses=(s.businesses||[]).filter(b=>allowed.has(String(b.id)));
  s.inventory=(s.inventory||[]).filter(i=>allowed.has(String(i.businessId)));
  s.notes=(s.notes||[]).filter(n=>allowed.has(String(n.businessId)));
  s.transfers=(s.transfers||[]).filter(t=>allowed.has(String(t.businessId)));
  s.history=(s.history||[]).filter(h=>allowed.has(String(h.businessId)));
  s.employees=(s.employees||[]).map(e=>({
    id:e.id,name:e.name,role:e.role,
    email:e.id===ctx.user.id?e.email:"",
    earnings:e.id===ctx.user.id?e.earnings:0,
    assignments:e.assignments
  }));
  core.auth=ctx;
  return core;
}
async function getAuthorizedCore(env,user) {
  return filterCoreForAuth(await getCore(env),await authContext(env,user));
}
async function updateEmployeeProfile(env,id,body) {
  await env.DB.prepare(`
    UPDATE employees SET display_name=?,email=?,company_role=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    String(body.name||"").trim(),
    String(body.email||"").trim()||null,
    String(body.role||"Employee").trim(),
    Number(id)
  ).run();
}

async function getCore(env) {
  const company = await firstCompany(env);
  if (!company) return { initialized: false };

  const { results: businesses } = await env.DB.prepare(`
    SELECT
      b.*,
      COALESCE((
        SELECT SUM(ct.amount)
        FROM coffer_transactions ct
        WHERE ct.business_id = b.id
      ), 0) AS coffers
    FROM businesses b
    WHERE b.company_id = ?
    ORDER BY b.id
  `).bind(company.id).all();

  const { results: employees } = await env.DB.prepare(`
    SELECT * FROM employees
    WHERE company_id = ?
    ORDER BY id
  `).bind(company.id).all();

  const { results: access } = await env.DB.prepare(`
    SELECT eba.employee_id, eba.business_id, eba.enabled, eba.business_role
    FROM employee_business_access eba
    JOIN employees e ON e.id = eba.employee_id
    WHERE e.company_id = ?
  `).bind(company.id).all();

  const { results: perms } = await env.DB.prepare(`
    SELECT ebp.employee_id, ebp.business_id, ebp.permission_code, ebp.granted
    FROM employee_business_permissions ebp
    JOIN employees e ON e.id = ebp.employee_id
    WHERE e.company_id = ?
  `).bind(company.id).all();

  const { results: entries } = await env.DB.prepare(`
    SELECT
      ie.id,
      ie.business_id,
      ie.item_id,
      ie.condition_name,
      ie.unit_sale_price,
      i.name,
      i.category
    FROM inventory_entries ie
    JOIN items i ON i.id = ie.item_id
    WHERE i.company_id = ? AND ie.is_active = 1
    ORDER BY ie.business_id, i.name, ie.condition_name
  `).bind(company.id).all();

  const { results: batches } = await env.DB.prepare(`
    SELECT
      sb.id,
      sb.business_id,
      sb.item_id,
      sb.condition_name,
      sb.quantity_remaining,
      sb.unit_sale_price,
      sb.original_stocker_employee_id,
      sb.source_type,
      sb.source_note
    FROM stock_batches sb
    JOIN items i ON i.id = sb.item_id
    WHERE i.company_id = ? AND sb.quantity_remaining > 0
    ORDER BY sb.id
  `).bind(company.id).all();

  const { results: batchParts } = await env.DB.prepare(`
    SELECT sbp.batch_id, sbp.employee_id, sbp.role
    FROM stock_batch_participants sbp
    JOIN stock_batches sb ON sb.id = sbp.batch_id
    JOIN items i ON i.id = sb.item_id
    WHERE i.company_id = ?
    ORDER BY sbp.batch_id
  `).bind(company.id).all();

  const assignmentsByEmployee = new Map();
  for (const a of access) {
    if (!assignmentsByEmployee.has(a.employee_id)) assignmentsByEmployee.set(a.employee_id, {});
    assignmentsByEmployee.get(a.employee_id)[a.business_id] = {
      enabled: !!a.enabled,
      permissions: []
    };
  }
  for (const p of perms) {
    if (!p.granted) continue;
    const all = assignmentsByEmployee.get(p.employee_id) || {};
    if (!all[p.business_id]) all[p.business_id] = { enabled: false, permissions: [] };
    all[p.business_id].permissions.push(p.permission_code);
    assignmentsByEmployee.set(p.employee_id, all);
  }

  const participantsByBatch = new Map();
  for (const p of batchParts) {
    if (!participantsByBatch.has(p.batch_id)) participantsByBatch.set(p.batch_id, []);
    participantsByBatch.get(p.batch_id).push(p.employee_id);
  }

  const inventory = entries.map(e => {
    const eb = batches.filter(b =>
      b.business_id === e.business_id &&
      b.item_id === e.item_id &&
      b.condition_name === e.condition_name
    );
    return {
      id: e.id,
      itemId: e.item_id,
      businessId: e.business_id,
      name: e.name,
      category: e.category || "Misc",
      condition: e.condition_name,
      qty: eb.reduce((a, b) => a + Number(b.quantity_remaining || 0), 0),
      price: Number(e.unit_sale_price || 0),
      batches: eb.map(b => ({
        batchId: b.id,
        qty: Number(b.quantity_remaining || 0),
        contributorId: b.original_stocker_employee_id,
        participantIds: [...new Set([
          ...(participantsByBatch.get(b.id) || []),
          b.original_stocker_employee_id
        ].filter(Boolean))],
        source: b.source_note || b.source_type || "Stock Intake"
      }))
    };
  });


  const { results: notebookRows } = await env.DB.prepare(`
    SELECT n.id,n.business_id,n.entry_text,n.is_pinned,n.created_at,e.display_name AS author
    FROM notebook_entries n LEFT JOIN employees e ON e.id=n.author_employee_id
    WHERE n.company_id=? ORDER BY n.created_at DESC
  `).bind(company.id).all();

  const { results: transferRows } = await env.DB.prepare(`
    SELECT t.id,t.from_business_id,t.to_business_id,t.created_at,t.note,
           fb.name AS from_name,tb.name AS to_name,e.display_name AS by_name
    FROM transfers t JOIN businesses fb ON fb.id=t.from_business_id
    JOIN businesses tb ON tb.id=t.to_business_id
    LEFT JOIN employees e ON e.id=t.performed_by_employee_id
    WHERE t.company_id=? ORDER BY t.created_at DESC
  `).bind(company.id).all();

  const { results: transferLineRows } = await env.DB.prepare(`
    SELECT tl.transfer_id,tl.quantity,i.name AS item_name
    FROM transfer_lines tl JOIN transfers t ON t.id=tl.transfer_id
    JOIN items i ON i.id=tl.item_id WHERE t.company_id=?
  `).bind(company.id).all();

  const { results: saleRows } = await env.DB.prepare(`
    SELECT s.*,e.display_name AS seller_name
    FROM sales s JOIN businesses b ON b.id=s.business_id
    LEFT JOIN employees e ON e.id=s.seller_employee_id
    WHERE b.company_id=? ORDER BY s.created_at DESC
  `).bind(company.id).all();

  const { results: saleLineRows } = await env.DB.prepare(`
    SELECT sl.sale_id,sl.quantity,i.name AS item_name
    FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
    JOIN businesses b ON b.id=s.business_id JOIN items i ON i.id=sl.item_id
    WHERE b.company_id=?
  `).bind(company.id).all();

  const { results: salePartRows } = await env.DB.prepare(`
    SELECT sp.sale_id,sp.employee_id,sp.role,sp.payout_amount,e.display_name
    FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id
    JOIN businesses b ON b.id=s.business_id JOIN employees e ON e.id=sp.employee_id
    WHERE b.company_id=? ORDER BY sp.sale_id,e.display_name
  `).bind(company.id).all();


  const { results: orderRows } = await env.DB.prepare(`
    SELECT
      o.*,
      re.display_name AS received_by_name,
      ce.display_name AS created_by_name
    FROM customer_orders o
    LEFT JOIN employees re ON re.id=o.received_by_employee_id
    LEFT JOIN employees ce ON ce.id=o.created_by_employee_id
    WHERE o.company_id=?
    ORDER BY
      CASE o.status
        WHEN 'Open' THEN 1
        WHEN 'In Progress' THEN 2
        WHEN 'Completed' THEN 3
        WHEN 'Cancelled' THEN 4
        ELSE 5
      END,
      o.created_at DESC
  `).bind(company.id).all();

  const { results: orderItemRows } = await env.DB.prepare(`
    SELECT
      oi.id,oi.order_id,oi.item_id,oi.condition_name,oi.quantity,oi.unit_price,
      i.name AS item_name,i.category
    FROM customer_order_items oi
    JOIN customer_orders o ON o.id=oi.order_id
    JOIN items i ON i.id=oi.item_id
    WHERE o.company_id=?
    ORDER BY oi.order_id,oi.id
  `).bind(company.id).all();

  const { results: orderParticipantRows } = await env.DB.prepare(`
    SELECT op.order_id,op.employee_id,op.role,op.payout_amount,e.display_name
    FROM customer_order_participants op
    JOIN customer_orders o ON o.id=op.order_id
    JOIN employees e ON e.id=op.employee_id
    WHERE o.company_id=?
    ORDER BY op.order_id,e.display_name
  `).bind(company.id).all();

  const state = {
    company: {
      id: company.id,
      name: company.name,
      shortName: company.short_name || company.name,
      initials: company.initials || "GS",
      subtitle: company.subtitle || "Merchant Ledger & Caravan Records",
      owner: company.owner_name || "",
      ownerTitle: company.owner_title || "Company Owner",
      caravanCut: Number(company.default_company_cut_percent || 0)
    },
    businesses: businesses.map(b => ({
      id: b.id,
      name: b.name,
      type: b.business_type,
      hold: b.hold || "",
      location: b.location || "",
      description: b.description || "",
      status: b.status,
      coffers: Number(b.coffers || 0)
    })),
    employees: employees.map(e => ({
      id: e.id,
      name: e.display_name,
      email: e.email || "",
      role: e.company_role,
      earnings: Number(e.lifetime_earnings || 0),
      assignments: assignmentsByEmployee.get(e.id) || {}
    })),
    inventory,
    notes:notebookRows.map(n=>({id:n.id,businessId:n.business_id,author:n.author||"Unknown",date:n.created_at,text:n.entry_text,pinned:!!n.is_pinned})),
    transfers:transferRows.map(t=>{const lines=transferLineRows.filter(x=>x.transfer_id===t.id);return{id:t.id,businessId:t.from_business_id,date:t.created_at,item:lines.map(x=>x.item_name).join(", ")||"Transfer",qty:lines.reduce((a,x)=>a+Number(x.quantity||0),0),from:t.from_name,to:t.to_name,by:t.by_name||"Unknown",trace:[]}}),
    history:saleRows.map(s=>({id:s.id,businessId:s.business_id,type:"Sale",date:s.created_at,who:s.seller_name||"Unknown",detail:saleLineRows.filter(x=>x.sale_id===s.id).map(x=>`${x.item_name} × ${x.quantity}`).join(", "),amount:Number(s.sale_total||0),companyCut:Number(s.company_cut_amount||0),share:0,participants:salePartRows.filter(x=>x.sale_id===s.id).map(x=>({id:x.employee_id,name:x.display_name,roles:[x.role],payout:Number(x.payout_amount||0)}))})),
    orders:orderRows.map(o=>({
      id:o.id,
      businessId:o.business_id,
      customerName:o.customer_name,
      holdDelivery:o.destination_hold||"",
      estimatedTime:o.estimated_time||"",
      receivedByEmployeeId:o.received_by_employee_id,
      receivedByName:o.received_by_name||"Unknown",
      createdByEmployeeId:o.created_by_employee_id,
      createdByName:o.created_by_name||"",
      status:o.status,
      notes:o.notes||"",
      total:Number(o.quoted_total||0),
      saleId:o.sale_id,
      createdAt:o.created_at,
      completedAt:o.completed_at,
      items:orderItemRows.filter(x=>x.order_id===o.id).map(x=>({
        id:x.id,
        itemId:x.item_id,
        name:x.item_name,
        category:x.category||"Misc",
        condition:x.condition_name||"Standard",
        qty:Number(x.quantity||0),
        price:Number(x.unit_price||0)
      })),
      participants:orderParticipantRows.filter(x=>x.order_id===o.id).map(x=>({
        employeeId:x.employee_id,
        name:x.display_name,
        role:x.role,
        payout:Number(x.payout_amount||0)
      }))
    }))
  };

  return { initialized: true, state };
}

async function bootstrap(env, legacy) {
  const existing = await firstCompany(env);
  if (existing) return { ok: false, reason: "already_initialized" };

  const c = legacy.company || {};
  const companyResult = await env.DB.prepare(`
    INSERT INTO companies
      (name, short_name, initials, subtitle, owner_name, owner_title, default_company_cut_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    c.name || "Golden Sands Trading Company",
    c.shortName || c.name || "Golden Sands",
    c.initials || "GS",
    c.subtitle || "Merchant Ledger & Caravan Records",
    c.owner || "",
    c.ownerTitle || "Company Owner",
    Number(c.caravanCut ?? 20)
  ).run();
  const companyId = companyResult.meta.last_row_id;

  const businessMap = {};
  for (const b of legacy.businesses || []) {
    const r = await env.DB.prepare(`
      INSERT INTO businesses
        (company_id, name, business_type, hold, location, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      companyId, b.name, b.type || "Shop", b.hold || "", b.location || "",
      b.description || "", b.status || "Active"
    ).run();
    const id = r.meta.last_row_id;
    businessMap[String(b.id)] = id;
    if (Number(b.coffers || 0) !== 0) {
      await env.DB.prepare(`
        INSERT INTO coffer_transactions
          (company_id, business_id, transaction_type, amount, note)
        VALUES (?, ?, 'OPENING_BALANCE', ?, 'Imported from browser ledger')
      `).bind(companyId, id, Number(b.coffers || 0)).run();
    }
  }

  const employeeMap = {};
  for (const e of legacy.employees || []) {
    const r = await env.DB.prepare(`
      INSERT INTO employees
        (company_id, display_name, email, company_role, is_company_owner, lifetime_earnings)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      companyId, e.name, e.email || null, e.role || "Employee",
      e.role === "Company Owner" ? 1 : 0, Number(e.earnings || 0)
    ).run();
    employeeMap[String(e.id)] = r.meta.last_row_id;
  }

  for (const e of legacy.employees || []) {
    const newEmployeeId = employeeMap[String(e.id)];
    for (const [oldBizId, a] of Object.entries(e.assignments || {})) {
      const businessId = businessMap[String(oldBizId)];
      if (!businessId) continue;
      await env.DB.prepare(`
        INSERT OR REPLACE INTO employee_business_access
          (employee_id, business_id, enabled, business_role, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(newEmployeeId, businessId, a.enabled ? 1 : 0, e.role || null).run();

      const ps = (a.permissions || []).includes("all")
        ? ["register","inventory_view","inventory_edit","orders","transfers","suppliers","notebook","tasks","coffers","coffers_edit","employees","permissions","businesses","settings"]
        : (a.permissions || []);
      for (const p of ps) {
        await env.DB.prepare(`
          INSERT OR REPLACE INTO employee_business_permissions
            (employee_id, business_id, permission_code, granted)
          VALUES (?, ?, ?, 1)
        `).bind(newEmployeeId, businessId, p).run();
      }
    }
  }

  const itemMap = {};
  const entryMap = {};
  for (const i of legacy.inventory || []) {
    let itemId = itemMap[i.name];
    if (!itemId) {
      const existingItem = await env.DB.prepare(
        "SELECT id FROM items WHERE company_id = ? AND name = ?"
      ).bind(companyId, i.name).first();
      if (existingItem) itemId = existingItem.id;
      else {
        const r = await env.DB.prepare(`
          INSERT INTO items (company_id, name, category)
          VALUES (?, ?, ?)
        `).bind(companyId, i.name, i.category || "Misc").run();
        itemId = r.meta.last_row_id;
      }
      itemMap[i.name] = itemId;
    }

    const businessId = businessMap[String(i.businessId)];
    if (!businessId) continue;
    const ir = await env.DB.prepare(`
      INSERT INTO inventory_entries
        (business_id, item_id, condition_name, unit_sale_price)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(business_id, item_id, condition_name)
      DO UPDATE SET unit_sale_price = excluded.unit_sale_price, updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `).bind(businessId, itemId, i.condition || "Standard", Number(i.price || 0)).first();
    entryMap[String(i.id)] = ir.id;

    for (const b of i.batches || []) {
      const contributor = employeeMap[String(b.contributorId)] || null;
      const br = await env.DB.prepare(`
        INSERT INTO stock_batches
          (business_id, item_id, condition_name, quantity_remaining, unit_sale_price,
           original_stocker_employee_id, source_type, source_note)
        VALUES (?, ?, ?, ?, ?, ?, 'IMPORT', ?)
      `).bind(
        businessId, itemId, i.condition || "Standard", Number(b.qty || 0),
        Number(i.price || 0), contributor, b.source || "Imported from browser ledger"
      ).run();
      const batchId = br.meta.last_row_id;

      const participantOldIds = [...new Set([
        ...(b.participantIds || []),
        b.contributorId
      ].filter(Boolean))];
      for (const oldId of participantOldIds) {
        const empId = employeeMap[String(oldId)];
        if (!empId) continue;
        await env.DB.prepare(`
          INSERT OR IGNORE INTO stock_batch_participants
            (batch_id, employee_id, role)
          VALUES (?, ?, ?)
        `).bind(batchId, empId, oldId === b.contributorId ? "STOCKER" : "TRANSFER_PARTICIPANT").run();
      }
    }
  }

  return {
    ok: true,
    maps: {
      businesses: businessMap,
      employees: employeeMap,
      inventory: entryMap
    }
  };
}

async function updateCompany(env, body) {
  const c = await firstCompany(env);
  if (!c) return null;
  await env.DB.prepare(`
    UPDATE companies SET
      name = ?, short_name = ?, initials = ?, subtitle = ?,
      owner_name = ?, owner_title = ?, default_company_cut_percent = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    body.name || c.name,
    body.shortName || body.name || c.short_name,
    body.initials || c.initials,
    body.subtitle || c.subtitle,
    body.owner ?? c.owner_name,
    body.ownerTitle ?? c.owner_title,
    Number(body.caravanCut ?? c.default_company_cut_percent),
    c.id
  ).run();
  return getCore(env);
}

async function createBusiness(env, body) {
  const c = await firstCompany(env);
  const r = await env.DB.prepare(`
    INSERT INTO businesses
      (company_id, name, business_type, hold, location, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    c.id, body.name, body.type || "Shop", body.hold || "", body.location || "",
    body.description || "", body.status || "Active"
  ).run();
  const businessId = r.meta.last_row_id;
  const { results: emps } = await env.DB.prepare(
    "SELECT id FROM employees WHERE company_id = ?"
  ).bind(c.id).all();
  for (const e of emps) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO employee_business_access
        (employee_id, business_id, enabled)
      VALUES (?, ?, 0)
    `).bind(e.id, businessId).run();
  }
  return getCore(env);
}

async function updateBusiness(env, id, body) {
  await env.DB.prepare(`
    UPDATE businesses SET
      name=?, business_type=?, status=?, hold=?, location=?, description=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    body.name, body.type || "Shop", body.status || "Active",
    body.hold || "", body.location || "", body.description || "", id
  ).run();
  return getCore(env);
}

async function createEmployee(env, body) {
  const c = await firstCompany(env);
  const r = await env.DB.prepare(`
    INSERT INTO employees
      (company_id, display_name, email, company_role, lifetime_earnings)
    VALUES (?, ?, ?, ?, 0)
  `).bind(c.id, body.name, body.email || null, body.role || "Employee").run();
  const employeeId = r.meta.last_row_id;

  if(body.password){
    await createPasswordRecord(env, employeeId, String(body.password), true);
  }

  const { results: businesses } = await env.DB.prepare(
    "SELECT id FROM businesses WHERE company_id = ?"
  ).bind(c.id).all();
  for (const b of businesses) {
    await env.DB.prepare(`
      INSERT INTO employee_business_access
        (employee_id, business_id, enabled)
      VALUES (?, ?, 0)
    `).bind(employeeId, b.id).run();
  }
  return getCore(env);
}

async function updateEmployeeAccess(env, id, body) {
  for (const [businessId, a] of Object.entries(body.assignments || {})) {
    await env.DB.prepare(`
      INSERT INTO employee_business_access
        (employee_id, business_id, enabled, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, business_id)
      DO UPDATE SET enabled=excluded.enabled, updated_at=CURRENT_TIMESTAMP
    `).bind(id, Number(businessId), a.enabled ? 1 : 0).run();

    await env.DB.prepare(`
      DELETE FROM employee_business_permissions
      WHERE employee_id=? AND business_id=?
    `).bind(id, Number(businessId)).run();

    for (const p of a.permissions || []) {
      await env.DB.prepare(`
        INSERT INTO employee_business_permissions
          (employee_id, business_id, permission_code, granted)
        VALUES (?, ?, ?, 1)
      `).bind(id, Number(businessId), p).run();
    }
  }
  return getCore(env);
}

async function createInventoryEntry(env, body) {
  const c = await firstCompany(env);
  let item = await env.DB.prepare(
    "SELECT id FROM items WHERE company_id=? AND name=?"
  ).bind(c.id, body.name).first();
  let itemId = item?.id;
  if (!itemId) {
    const r = await env.DB.prepare(`
      INSERT INTO items (company_id, name, category)
      VALUES (?, ?, ?)
    `).bind(c.id, body.name, body.category || "Misc").run();
    itemId = r.meta.last_row_id;
  }
  await env.DB.prepare(`
    INSERT INTO inventory_entries
      (business_id, item_id, condition_name, unit_sale_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(business_id,item_id,condition_name)
    DO UPDATE SET
      unit_sale_price=excluded.unit_sale_price,
      is_active=1,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    Number(body.businessId), itemId, body.condition || "Standard",
    Number(body.price || 0)
  ).run();
  return getCore(env);
}

async function stockIntake(env, body) {
  const ie = await env.DB.prepare(`
    SELECT * FROM inventory_entries WHERE id=?
  `).bind(Number(body.inventoryEntryId)).first();
  if (!ie) throw new Error("Inventory entry not found");

  const r = await env.DB.prepare(`
    INSERT INTO stock_batches
      (business_id, item_id, condition_name, quantity_remaining,
       unit_sale_price, original_stocker_employee_id, source_type, source_note)
    VALUES (?, ?, ?, ?, ?, ?, 'STOCK_INTAKE', ?)
  `).bind(
    ie.business_id, ie.item_id, ie.condition_name, Number(body.qty),
    ie.unit_sale_price, Number(body.employeeId), body.source || "Stock Intake"
  ).run();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO stock_batch_participants
      (batch_id, employee_id, role)
    VALUES (?, ?, 'STOCKER')
  `).bind(r.meta.last_row_id, Number(body.employeeId)).run();
  return getCore(env);
}

async function createNotebookEntry(env,body){
  const c=await firstCompany(env);
  await env.DB.prepare(`INSERT INTO notebook_entries(company_id,business_id,author_employee_id,entry_text,is_pinned) VALUES(?,?,?,?,?)`)
    .bind(c.id,Number(body.businessId)||null,Number(body.employeeId)||null,body.text,body.pinned?1:0).run();
  return getCore(env);
}
async function createTransfer(env,body){
  const c=await firstCompany(env);
  const entry=await env.DB.prepare(`SELECT ie.*,i.name FROM inventory_entries ie JOIN items i ON i.id=ie.item_id WHERE ie.id=?`).bind(Number(body.inventoryEntryId)).first();
  if(!entry)throw new Error("Inventory entry not found");
  const qty=Number(body.qty||0); if(qty<=0)throw new Error("Invalid quantity");
  const available=await env.DB.prepare(`SELECT COALESCE(SUM(quantity_remaining),0) qty FROM stock_batches WHERE business_id=? AND item_id=? AND condition_name=? AND quantity_remaining>0`)
    .bind(entry.business_id,entry.item_id,entry.condition_name).first();
  if(Number(available.qty)<qty)throw new Error("Not enough stock");
  const tr=await env.DB.prepare(`INSERT INTO transfers(company_id,from_business_id,to_business_id,performed_by_employee_id,status,note,completed_at) VALUES(?,?,?,?, 'Completed', ?, CURRENT_TIMESTAMP)`)
    .bind(c.id,entry.business_id,Number(body.toBusinessId),Number(body.employeeId)||null,body.note||"").run();
  const transferId=tr.meta.last_row_id;
  const tl=await env.DB.prepare(`INSERT INTO transfer_lines(transfer_id,item_id,condition_name,quantity) VALUES(?,?,?,?)`)
    .bind(transferId,entry.item_id,entry.condition_name,qty).run();
  const lineId=tl.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO inventory_entries(business_id,item_id,condition_name,unit_sale_price) VALUES(?,?,?,?) ON CONFLICT(business_id,item_id,condition_name) DO UPDATE SET unit_sale_price=excluded.unit_sale_price,is_active=1,updated_at=CURRENT_TIMESTAMP`)
    .bind(Number(body.toBusinessId),entry.item_id,entry.condition_name,entry.unit_sale_price).run();
  const {results:batches}=await env.DB.prepare(`SELECT * FROM stock_batches WHERE business_id=? AND item_id=? AND condition_name=? AND quantity_remaining>0 ORDER BY id`)
    .bind(entry.business_id,entry.item_id,entry.condition_name).all();
  let need=qty;
  for(const b of batches){
    if(need<=0)break;
    const moved=Math.min(need,Number(b.quantity_remaining));
    await env.DB.prepare("UPDATE stock_batches SET quantity_remaining=quantity_remaining-? WHERE id=?").bind(moved,b.id).run();
    const nr=await env.DB.prepare(`INSERT INTO stock_batches(business_id,item_id,condition_name,quantity_remaining,unit_sale_price,original_stocker_employee_id,parent_batch_id,source_type,source_reference_id,source_note) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(Number(body.toBusinessId),b.item_id,b.condition_name,moved,b.unit_sale_price,b.original_stocker_employee_id,b.id,"TRANSFER",transferId,"Transfer stock").run();
    const newBatchId=nr.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO transfer_batch_movements(transfer_line_id,source_batch_id,destination_batch_id,quantity) VALUES(?,?,?,?)`).bind(lineId,b.id,newBatchId,moved).run();
    const {results:parts}=await env.DB.prepare("SELECT employee_id,role FROM stock_batch_participants WHERE batch_id=?").bind(b.id).all();
    for(const p of parts)await env.DB.prepare(`INSERT OR IGNORE INTO stock_batch_participants(batch_id,employee_id,role) VALUES(?,?,?)`).bind(newBatchId,p.employee_id,p.role).run();
    if(body.employeeId)await env.DB.prepare(`INSERT OR IGNORE INTO stock_batch_participants(batch_id,employee_id,role) VALUES(?,?, 'TRANSFEROR')`).bind(newBatchId,Number(body.employeeId)).run();
    need-=moved;
  }
  return getCore(env);
}
async function createSale(env,body){
  const c=await firstCompany(env),businessId=Number(body.businessId),sellerId=Number(body.sellerId);
  const discount=Math.max(0,Math.min(100,Number(body.discount||0))),cart=body.items||[];
  let subtotal=0; for(const x of cart)subtotal+=Number(x.price||0)*Number(x.qty||0);
  const total=Math.round(subtotal*(1-discount/100)),cutPercent=Number(body.companyCutPercent??c.default_company_cut_percent??0),cut=Math.round(total*cutPercent/100),pool=total-cut;
  const sr=await env.DB.prepare(`INSERT INTO sales(business_id,seller_employee_id,subtotal,discount_percent,sale_total,company_cut_percent,company_cut_amount,employee_pool_amount,status) VALUES(?,?,?,?,?,?,?,?,'Completed')`)
    .bind(businessId,sellerId,subtotal,discount,total,cutPercent,cut,pool).run();
  const saleId=sr.meta.last_row_id,contributors=new Set(),participants=new Set([sellerId,...(body.extraParticipantIds||[]).map(Number)]);
  for(const x of cart){
    const ie=await env.DB.prepare("SELECT * FROM inventory_entries WHERE id=?").bind(Number(x.inventoryEntryId)).first();
    if(!ie)throw new Error("Inventory entry missing");
    const qty=Number(x.qty),lr=await env.DB.prepare(`INSERT INTO sale_lines(sale_id,item_id,condition_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)`)
      .bind(saleId,ie.item_id,ie.condition_name,qty,Number(x.price),qty*Number(x.price)).run(),lineId=lr.meta.last_row_id;
    const {results:batches}=await env.DB.prepare(`SELECT * FROM stock_batches WHERE business_id=? AND item_id=? AND condition_name=? AND quantity_remaining>0 ORDER BY id`).bind(businessId,ie.item_id,ie.condition_name).all();
    let need=qty;
    for(const b of batches){
      if(need<=0)break;
      const used=Math.min(need,Number(b.quantity_remaining));
      await env.DB.prepare("UPDATE stock_batches SET quantity_remaining=quantity_remaining-? WHERE id=?").bind(used,b.id).run();
      await env.DB.prepare("INSERT INTO sale_line_batches(sale_line_id,batch_id,quantity) VALUES(?,?,?)").bind(lineId,b.id,used).run();
      const {results:parts}=await env.DB.prepare("SELECT employee_id FROM stock_batch_participants WHERE batch_id=?").bind(b.id).all();
      for(const p of parts)contributors.add(Number(p.employee_id));
      if(b.original_stocker_employee_id)contributors.add(Number(b.original_stocker_employee_id));
      need-=used;
    }
    if(need>0)throw new Error("Not enough stock");
  }
  contributors.forEach(id=>participants.add(id));
  const ids=[...participants].filter(Boolean),share=ids.length?Math.floor(pool/ids.length):0,extras=(body.extraParticipantIds||[]).map(Number);
  for(const id of ids){
    const roles=[]; if(id===sellerId)roles.push("Seller"); if(contributors.has(id))roles.push("Stock Contributor"); if(extras.includes(id))roles.push("Additional");
    for(const role of roles)await env.DB.prepare(`INSERT OR IGNORE INTO sale_participants(sale_id,employee_id,role,is_auto_added,payout_amount) VALUES(?,?,?,?,?)`).bind(saleId,id,role,role==="Stock Contributor"?1:0,share).run();
    await env.DB.prepare(`UPDATE employees SET lifetime_earnings=lifetime_earnings+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(share,id).run();
  }
  if(cut)await env.DB.prepare(`INSERT INTO coffer_transactions(company_id,business_id,transaction_type,amount,reference_type,reference_id,performed_by_employee_id,note) VALUES(?,?, 'SALE_COMPANY_CUT', ?, 'SALE', ?, ?, 'Completed sale')`).bind(c.id,businessId,cut,saleId,sellerId).run();
  return getCore(env);
}

async function createCustomerOrder(env,user,body){
  const c=await firstCompany(env);
  const businessId=Number(body.businessId);
  if(!businessId)throw new HttpError(400,"Business is required.");

  const customerName=String(body.customerName||"").trim();
  const holdDelivery=String(body.holdDelivery||"").trim();
  const estimatedTime=String(body.estimatedTime||"").trim();
  const items=Array.isArray(body.items)?body.items:[];
  if(!customerName)throw new HttpError(400,"Client name is required.");
  if(!holdDelivery)throw new HttpError(400,"Hold delivery is required.");
  if(!estimatedTime)throw new HttpError(400,"Estimated time is required.");
  if(!items.length)throw new HttpError(400,"Add at least one order item.");

  let receivedBy=Number(body.receivedByEmployeeId)||null;
  if(user && !user.isOwner)receivedBy=user.id;
  if(!receivedBy)receivedBy=user?.id||null;

  let total=0;
  const normalized=[];

  for(const raw of items){
    const qty=Math.max(1,Number(raw.qty)||1);
    const price=Math.max(0,Number(raw.price)||0);
    total+=qty*price;

    let itemId=Number(raw.itemId)||null;
    let condition=String(raw.condition||"Standard").trim()||"Standard";

    if(itemId){
      const existing=await env.DB.prepare(
        "SELECT id,name,category FROM items WHERE id=? AND company_id=?"
      ).bind(itemId,c.id).first();
      if(!existing)throw new HttpError(400,"One selected item is no longer available.");
    }else{
      const customName=String(raw.name||"").trim();
      if(!customName)throw new HttpError(400,"Custom item name is required.");
      let existing=await env.DB.prepare(
        "SELECT id FROM items WHERE company_id=? AND lower(name)=lower(?)"
      ).bind(c.id,customName).first();
      if(existing)itemId=existing.id;
      else{
        const r=await env.DB.prepare(
          "INSERT INTO items(company_id,name,category) VALUES(?,?,?)"
        ).bind(c.id,customName,String(raw.category||"Misc").trim()||"Misc").run();
        itemId=r.meta.last_row_id;
      }
    }

    normalized.push({itemId,condition,qty,price});
  }

  const r=await env.DB.prepare(`
    INSERT INTO customer_orders(
      company_id,business_id,customer_name,destination_hold,quoted_total,
      company_cut_percent,status,notes,created_by_employee_id,
      received_by_employee_id,estimated_time
    ) VALUES(?,?,?,?,?,?, 'Open', ?,?,?,?)
  `).bind(
    c.id,businessId,customerName,holdDelivery,total,
    Number(c.default_company_cut_percent||0),
    String(body.notes||""),
    user?.id||receivedBy,
    receivedBy,
    estimatedTime
  ).run();

  const orderId=r.meta.last_row_id;
  for(const x of normalized){
    await env.DB.prepare(`
      INSERT INTO customer_order_items(
        order_id,item_id,condition_name,quantity,unit_price
      ) VALUES(?,?,?,?,?)
    `).bind(orderId,x.itemId,x.condition,x.qty,x.price).run();
  }

  return orderId;
}

async function updateOrderStatus(env,orderId,status){
  const allowed=["Open","In Progress","Cancelled"];
  if(!allowed.includes(status))throw new HttpError(400,"Invalid order status.");
  const order=await env.DB.prepare(
    "SELECT status FROM customer_orders WHERE id=?"
  ).bind(Number(orderId)).first();
  if(!order)throw new HttpError(404,"Order not found.");
  if(order.status==="Completed")throw new HttpError(409,"Completed orders cannot be changed.");
  await env.DB.prepare(
    "UPDATE customer_orders SET status=? WHERE id=?"
  ).bind(status,Number(orderId)).run();
}

async function orderFulfillmentPreview(env,orderId){
  const order=await env.DB.prepare(
    "SELECT * FROM customer_orders WHERE id=?"
  ).bind(Number(orderId)).first();
  if(!order)throw new HttpError(404,"Order not found.");

  const {results:items}=await env.DB.prepare(`
    SELECT oi.*,i.name AS item_name
    FROM customer_order_items oi
    JOIN items i ON i.id=oi.item_id
    WHERE oi.order_id=?
    ORDER BY oi.id
  `).bind(Number(orderId)).all();

  const availability=[];
  let canFulfill=true;
  for(const x of items){
    const ie=await env.DB.prepare(`
      SELECT id FROM inventory_entries
      WHERE business_id=? AND item_id=? AND condition_name=? AND is_active=1
      LIMIT 1
    `).bind(order.business_id,x.item_id,x.condition_name).first();

    let available=0;
    if(ie){
      const row=await env.DB.prepare(`
        SELECT COALESCE(SUM(quantity_remaining),0) AS qty
        FROM stock_batches
        WHERE business_id=? AND item_id=? AND condition_name=? AND quantity_remaining>0
      `).bind(order.business_id,x.item_id,x.condition_name).first();
      available=Number(row?.qty||0);
    }
    if(!ie || available<Number(x.quantity))canFulfill=false;
    availability.push({
      orderItemId:x.id,itemId:x.item_id,name:x.item_name,
      condition:x.condition_name,needed:Number(x.quantity),
      available,inventoryEntryId:ie?.id||null,price:Number(x.unit_price||0)
    });
  }
  return {order,items:availability,canFulfill};
}

async function fulfillCustomerOrder(env,user,orderId,body){
  const preview=await orderFulfillmentPreview(env,orderId);
  const order=preview.order;
  if(order.status==="Completed")throw new HttpError(409,"Order is already completed.");
  if(order.status==="Cancelled")throw new HttpError(409,"Cancelled orders cannot be fulfilled.");
  if(!preview.canFulfill)throw new HttpError(409,"There is not enough matching inventory to fulfill the full order.");

  const c=await firstCompany(env);
  const businessId=Number(order.business_id);
  let fulfillerId=user?.id||Number(body.fulfilledByEmployeeId)||null;
  if(!fulfillerId)throw new HttpError(400,"Fulfilling employee is required.");

  const subtotal=preview.items.reduce((a,x)=>a+(x.price*x.needed),0);
  const total=subtotal;
  const cutPercent=Number(order.company_cut_percent??c.default_company_cut_percent??0);
  const cut=Math.round(total*cutPercent/100);
  const pool=total-cut;

  const sr=await env.DB.prepare(`
    INSERT INTO sales(
      business_id,seller_employee_id,subtotal,discount_percent,sale_total,
      company_cut_percent,company_cut_amount,employee_pool_amount,
      customer_name,note,status
    ) VALUES(?,?,?,0,?,?,?,?,?,?,'Completed')
  `).bind(
    businessId,fulfillerId,subtotal,total,cutPercent,cut,pool,
    order.customer_name,
    `Fulfilled order #${order.id} · Delivery: ${order.destination_hold||""}`
  ).run();
  const saleId=sr.meta.last_row_id;

  const contributorIds=new Set();
  const participantIds=new Set();

  // Order receiver participates automatically.
  if(order.received_by_employee_id)participantIds.add(Number(order.received_by_employee_id));
  participantIds.add(fulfillerId);
  for(const id of (body.extraParticipantIds||[]).map(Number).filter(Boolean))participantIds.add(id);

  for(const x of preview.items){
    const lr=await env.DB.prepare(`
      INSERT INTO sale_lines(
        sale_id,item_id,condition_name,quantity,unit_price,line_total
      ) VALUES(?,?,?,?,?,?)
    `).bind(saleId,x.itemId,x.condition,x.needed,x.price,x.needed*x.price).run();
    const lineId=lr.meta.last_row_id;

    const {results:batches}=await env.DB.prepare(`
      SELECT *
      FROM stock_batches
      WHERE business_id=? AND item_id=? AND condition_name=? AND quantity_remaining>0
      ORDER BY id
    `).bind(businessId,x.itemId,x.condition).all();

    let need=x.needed;
    for(const b of batches){
      if(need<=0)break;
      const used=Math.min(need,Number(b.quantity_remaining));
      await env.DB.prepare(
        "UPDATE stock_batches SET quantity_remaining=quantity_remaining-? WHERE id=?"
      ).bind(used,b.id).run();

      await env.DB.prepare(
        "INSERT INTO sale_line_batches(sale_line_id,batch_id,quantity) VALUES(?,?,?)"
      ).bind(lineId,b.id,used).run();

      const {results:parts}=await env.DB.prepare(
        "SELECT employee_id FROM stock_batch_participants WHERE batch_id=?"
      ).bind(b.id).all();
      for(const p of parts)contributorIds.add(Number(p.employee_id));
      if(b.original_stocker_employee_id)contributorIds.add(Number(b.original_stocker_employee_id));
      need-=used;
    }
    if(need>0)throw new HttpError(409,"Inventory changed during fulfillment. Try again.");
  }

  contributorIds.forEach(id=>participantIds.add(id));
  const ids=[...participantIds].filter(Boolean);
  const share=ids.length?Math.floor(pool/ids.length):0;
  const extras=(body.extraParticipantIds||[]).map(Number);
  const receiverId=Number(order.received_by_employee_id)||null;

  for(const id of ids){
    const roles=[];
    if(id===fulfillerId)roles.push("Order Fulfiller");
    if(id===receiverId)roles.push("Order Receiver");
    if(contributorIds.has(id))roles.push("Stock Contributor");
    if(extras.includes(id))roles.push("Additional");

    for(const role of roles){
      await env.DB.prepare(`
        INSERT OR IGNORE INTO sale_participants(
          sale_id,employee_id,role,is_auto_added,payout_amount
        ) VALUES(?,?,?,?,?)
      `).bind(
        saleId,id,role,
        (role==="Stock Contributor"||role==="Order Receiver")?1:0,
        share
      ).run();

      await env.DB.prepare(`
        INSERT OR IGNORE INTO customer_order_participants(
          order_id,employee_id,role,payout_amount
        ) VALUES(?,?,?,?)
      `).bind(order.id,id,role,share).run();
    }

    await env.DB.prepare(`
      UPDATE employees
      SET lifetime_earnings=lifetime_earnings+?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(share,id).run();
  }

  if(cut){
    await env.DB.prepare(`
      INSERT INTO coffer_transactions(
        company_id,business_id,transaction_type,amount,
        reference_type,reference_id,performed_by_employee_id,note
      ) VALUES(?,?, 'ORDER_COMPANY_CUT', ?, 'ORDER', ?, ?, ?)
    `).bind(
      c.id,businessId,cut,order.id,fulfillerId,
      `Completed order #${order.id}`
    ).run();
  }

  await env.DB.prepare(`
    UPDATE customer_orders
    SET status='Completed',completed_at=CURRENT_TIMESTAMP,sale_id=?
    WHERE id=?
  `).bind(saleId,order.id).run();

  return {saleId,share,total,cut,participantIds:ids};
}


export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/health"){
        const result=await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          worker:true,database:result?.ok===1,
          authMode:"native",
          authEnforced:authEnforced(env)
        });
      }

      if(url.pathname==="/api/auth/me"&&request.method==="GET")
        return authMe(request,env);
      if(url.pathname==="/api/auth/login"&&request.method==="POST")
        return loginNative(request,env);
      if(url.pathname==="/api/auth/logout"&&request.method==="POST")
        return logoutNative(request,env);
      if(url.pathname==="/api/auth/setup-owner"&&request.method==="POST")
        return setupOwner(request,env);

      const user=await requireUser(request,env);

      if(url.pathname==="/api/auth/change-password"&&request.method==="POST")
        return changeOwnPassword(request,env,user);

      if(url.pathname==="/api/core"&&request.method==="GET")
        return json(await getAuthorizedCore(env,user));

      if(url.pathname==="/api/bootstrap"&&request.method==="POST"){
        if(authEnforced(env))throw new HttpError(403,"Bootstrap is disabled.");
        const body=await readJson(request);
        const result=await bootstrap(env,body.state||{});
        return json(result,{status:result.ok?200:409});
      }

      if(url.pathname==="/api/company"&&request.method==="PATCH"){
        await requireCompanyPermission(env,user,"settings");
        await updateCompany(env,await readJson(request));
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/businesses"&&request.method==="POST"){
        await requireCompanyPermission(env,user,"businesses");
        await createBusiness(env,await readJson(request));
        return json(await getAuthorizedCore(env,user));
      }

      let match=url.pathname.match(/^\/api\/businesses\/(\d+)$/);
      if(match&&request.method==="PUT"){
        await requireCompanyPermission(env,user,"businesses");
        await updateBusiness(env,Number(match[1]),await readJson(request));
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/employees"&&request.method==="POST"){
        await requireCompanyPermission(env,user,"employees");
        const body=await readJson(request);
        await createEmployee(env,body);
        const newest=await env.DB.prepare(
          "SELECT id FROM employees WHERE lower(email)=lower(?) ORDER BY id DESC LIMIT 1"
        ).bind(body.email||"").first();
        if(newest&&body.password)await adminSetPassword(env,newest.id,String(body.password),true);
        return json(await getAuthorizedCore(env,user));
      }

      match=url.pathname.match(/^\/api\/employees\/(\d+)$/);
      if(match&&request.method==="PUT"){
        await requireCompanyPermission(env,user,"employees");
        await updateEmployeeProfile(env,Number(match[1]),await readJson(request));
        return json(await getAuthorizedCore(env,user));
      }

      match=url.pathname.match(/^\/api\/employees\/(\d+)\/password$/);
      if(match&&request.method==="PUT"){
        await requireCompanyPermission(env,user,"employees");
        const body=await readJson(request);
        await adminSetPassword(env,Number(match[1]),String(body.password||""),body.mustChange!==false);
        return json({ok:true});
      }

      match=url.pathname.match(/^\/api\/employees\/(\d+)\/access$/);
      if(match&&request.method==="PUT"){
        await requireCompanyPermission(env,user,"permissions");
        await updateEmployeeAccess(env,Number(match[1]),await readJson(request));
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/inventory"&&request.method==="POST"){
        const body=await readJson(request);
        await requireBusinessPermission(env,user,body.businessId,"inventory_edit");
        await createInventoryEntry(env,body);
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/stock-intake"&&request.method==="POST"){
        const body=await readJson(request);
        const ie=await env.DB.prepare("SELECT business_id FROM inventory_entries WHERE id=?")
          .bind(Number(body.inventoryEntryId)).first();
        if(!ie)throw new HttpError(404,"Inventory entry not found.");
        await requireBusinessPermission(env,user,ie.business_id,"inventory_edit");
        if(user)body.employeeId=user.id;
        await stockIntake(env,body);
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/notebook"&&request.method==="POST"){
        const body=await readJson(request);
        await requireBusinessPermission(env,user,body.businessId,"notebook");
        if(user)body.employeeId=user.id;
        await createNotebookEntry(env,body);
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/transfers"&&request.method==="POST"){
        const body=await readJson(request);
        const ie=await env.DB.prepare("SELECT business_id FROM inventory_entries WHERE id=?")
          .bind(Number(body.inventoryEntryId)).first();
        if(!ie)throw new HttpError(404,"Inventory entry not found.");
        await requireBusinessPermission(env,user,ie.business_id,"transfers");
        if(user)body.employeeId=user.id;
        await createTransfer(env,body);
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/sales"&&request.method==="POST"){
        const body=await readJson(request);
        await requireBusinessPermission(env,user,body.businessId,"register");
        if(user)body.sellerId=user.id;
        await createSale(env,body);
        return json(await getAuthorizedCore(env,user));
      }

      if(url.pathname==="/api/orders"&&request.method==="POST"){
        const body=await readJson(request);
        await requireBusinessPermission(env,user,body.businessId,"orders");
        const orderId=await createCustomerOrder(env,user,body);
        return json({ok:true,orderId,core:await getAuthorizedCore(env,user)});
      }

      match=url.pathname.match(/^\/api\/orders\/(\d+)\/status$/);
      if(match&&request.method==="PATCH"){
        const order=await env.DB.prepare(
          "SELECT business_id FROM customer_orders WHERE id=?"
        ).bind(Number(match[1])).first();
        if(!order)throw new HttpError(404,"Order not found.");
        await requireBusinessPermission(env,user,order.business_id,"orders");
        const body=await readJson(request);
        await updateOrderStatus(env,Number(match[1]),String(body.status||""));
        return json(await getAuthorizedCore(env,user));
      }

      match=url.pathname.match(/^\/api\/orders\/(\d+)\/preview$/);
      if(match&&request.method==="GET"){
        const order=await env.DB.prepare(
          "SELECT business_id FROM customer_orders WHERE id=?"
        ).bind(Number(match[1])).first();
        if(!order)throw new HttpError(404,"Order not found.");
        await requireBusinessPermission(env,user,order.business_id,"orders");
        return json(await orderFulfillmentPreview(env,Number(match[1])));
      }

      match=url.pathname.match(/^\/api\/orders\/(\d+)\/fulfill$/);
      if(match&&request.method==="POST"){
        const order=await env.DB.prepare(
          "SELECT business_id FROM customer_orders WHERE id=?"
        ).bind(Number(match[1])).first();
        if(!order)throw new HttpError(404,"Order not found.");
        await requireBusinessPermission(env,user,order.business_id,"orders");
        const body=await readJson(request);
        const receipt=await fulfillCustomerOrder(env,user,Number(match[1]),body);
        return json({ok:true,receipt,core:await getAuthorizedCore(env,user)});
      }

      if(url.pathname.startsWith("/api/"))
        return json({error:"Not found"},{status:404});

      return env.ASSETS.fetch(request);
    }catch(error){
      return json(
        {error:error?.message||String(error)},
        {status:error?.status||500}
      );
    }
  }
};
