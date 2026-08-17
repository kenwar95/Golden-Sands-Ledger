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
    history:saleRows.map(s=>({id:s.id,businessId:s.business_id,type:"Sale",date:s.created_at,who:s.seller_name||"Unknown",detail:saleLineRows.filter(x=>x.sale_id===s.id).map(x=>`${x.item_name} × ${x.quantity}`).join(", "),amount:Number(s.sale_total||0),companyCut:Number(s.company_cut_amount||0),share:0,participants:salePartRows.filter(x=>x.sale_id===s.id).map(x=>({id:x.employee_id,name:x.display_name,roles:[x.role],payout:Number(x.payout_amount||0)}))}))
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ worker: true, database: result?.ok === 1 });
      }

      if (url.pathname === "/api/core" && request.method === "GET")
        return json(await getCore(env));

      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        const body = await readJson(request);
        const result = await bootstrap(env, body.state || {});
        return json(result, { status: result.ok ? 200 : 409 });
      }

      if (url.pathname === "/api/company" && request.method === "PATCH")
        return json(await updateCompany(env, await readJson(request)));

      if (url.pathname === "/api/businesses" && request.method === "POST")
        return json(await createBusiness(env, await readJson(request)));

      let match = url.pathname.match(/^\/api\/businesses\/(\d+)$/);
      if (match && request.method === "PUT")
        return json(await updateBusiness(env, Number(match[1]), await readJson(request)));

      if (url.pathname === "/api/employees" && request.method === "POST")
        return json(await createEmployee(env, await readJson(request)));

      match = url.pathname.match(/^\/api\/employees\/(\d+)\/access$/);
      if (match && request.method === "PUT")
        return json(await updateEmployeeAccess(env, Number(match[1]), await readJson(request)));

      if (url.pathname === "/api/inventory" && request.method === "POST")
        return json(await createInventoryEntry(env, await readJson(request)));

      if (url.pathname === "/api/stock-intake" && request.method === "POST")
        return json(await stockIntake(env, await readJson(request)));

      if (url.pathname === "/api/notebook" && request.method === "POST")
        return json(await createNotebookEntry(env, await readJson(request)));
      if (url.pathname === "/api/transfers" && request.method === "POST")
        return json(await createTransfer(env, await readJson(request)));
      if (url.pathname === "/api/sales" && request.method === "POST")
        return json(await createSale(env, await readJson(request)));

      if (url.pathname.startsWith("/api/"))
        return json({ error: "Not found" }, { status: 404 });

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || String(error) }, { status: 500 });
    }
  }
};
