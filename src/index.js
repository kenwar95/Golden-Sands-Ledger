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
    inventory
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

      if (url.pathname.startsWith("/api/"))
        return json({ error: "Not found" }, { status: 404 });

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || String(error) }, { status: 500 });
    }
  }
};
