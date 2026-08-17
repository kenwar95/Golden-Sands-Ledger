PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    initials TEXT NOT NULL DEFAULT 'GS',
    subtitle TEXT,
    owner_name TEXT,
    owner_title TEXT,
    default_company_cut_percent REAL NOT NULL DEFAULT 20 CHECK(default_company_cut_percent >= 0 AND default_company_cut_percent <= 100),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'Shop',
    hold TEXT,
    location TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive','Archived')),
    manager_employee_id INTEGER,
    company_cut_percent REAL CHECK(company_cut_percent IS NULL OR (company_cut_percent >= 0 AND company_cut_percent <= 100)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    google_sub TEXT,
    company_role TEXT NOT NULL DEFAULT 'Employee',
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive','Suspended')),
    is_company_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_company_owner IN (0,1)),
    lifetime_earnings INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, email),
    UNIQUE(google_sub)
);

CREATE TABLE IF NOT EXISTS employee_business_access (
    employee_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    business_role TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(employee_id, business_id),
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_business_permissions (
    employee_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL,
    permission_code TEXT NOT NULL,
    granted INTEGER NOT NULL DEFAULT 1 CHECK(granted IN (0,1)),
    PRIMARY KEY(employee_id, business_id, permission_code),
    FOREIGN KEY(employee_id, business_id) REFERENCES employee_business_access(employee_id, business_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Misc',
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS stock_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL DEFAULT 'Standard',
    quantity_remaining INTEGER NOT NULL CHECK(quantity_remaining >= 0),
    unit_sale_price INTEGER NOT NULL DEFAULT 0 CHECK(unit_sale_price >= 0),
    original_stocker_employee_id INTEGER,
    parent_batch_id INTEGER,
    source_type TEXT NOT NULL DEFAULT 'STOCK_INTAKE',
    source_reference_id INTEGER,
    source_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT,
    FOREIGN KEY(original_stocker_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY(parent_batch_id) REFERENCES stock_batches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_batch_participants (
    batch_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    first_added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(batch_id, employee_id, role),
    FOREIGN KEY(batch_id) REFERENCES stock_batches(id) ON DELETE CASCADE,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    from_business_id INTEGER NOT NULL,
    to_business_id INTEGER NOT NULL,
    performed_by_employee_id INTEGER,
    status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Draft','Completed','Cancelled')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(from_business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY(to_business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY(performed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CHECK(from_business_id <> to_business_id)
);

CREATE TABLE IF NOT EXISTS transfer_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL DEFAULT 'Standard',
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY(transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transfer_batch_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_line_id INTEGER NOT NULL,
    source_batch_id INTEGER NOT NULL,
    destination_batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY(transfer_line_id) REFERENCES transfer_lines(id) ON DELETE CASCADE,
    FOREIGN KEY(source_batch_id) REFERENCES stock_batches(id) ON DELETE RESTRICT,
    FOREIGN KEY(destination_batch_id) REFERENCES stock_batches(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    seller_employee_id INTEGER,
    subtotal INTEGER NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
    discount_percent REAL NOT NULL DEFAULT 0 CHECK(discount_percent >= 0 AND discount_percent <= 100),
    sale_total INTEGER NOT NULL DEFAULT 0 CHECK(sale_total >= 0),
    company_cut_percent REAL NOT NULL DEFAULT 0 CHECK(company_cut_percent >= 0 AND company_cut_percent <= 100),
    company_cut_amount INTEGER NOT NULL DEFAULT 0 CHECK(company_cut_amount >= 0),
    employee_pool_amount INTEGER NOT NULL DEFAULT 0 CHECK(employee_pool_amount >= 0),
    customer_name TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Draft','Completed','Voided')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY(seller_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sale_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL DEFAULT 'Standard',
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
    line_total INTEGER NOT NULL CHECK(line_total >= 0),
    FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sale_line_batches (
    sale_line_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(sale_line_id, batch_id),
    FOREIGN KEY(sale_line_id) REFERENCES sale_lines(id) ON DELETE CASCADE,
    FOREIGN KEY(batch_id) REFERENCES stock_batches(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sale_participants (
    sale_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    is_auto_added INTEGER NOT NULL DEFAULT 0 CHECK(is_auto_added IN (0,1)),
    payout_amount INTEGER NOT NULL DEFAULT 0 CHECK(payout_amount >= 0),
    PRIMARY KEY(sale_id, employee_id, role),
    FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS coffer_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    business_id INTEGER,
    transaction_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    performed_by_employee_id INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE SET NULL,
    FOREIGN KEY(performed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    hold TEXT,
    location TEXT,
    raven_contact TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_items (
    supplier_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    buy_price INTEGER NOT NULL DEFAULT 0 CHECK(buy_price >= 0),
    notes TEXT,
    is_available INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0,1)),
    PRIMARY KEY(supplier_id, item_id),
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    business_id INTEGER,
    created_by_employee_id INTEGER,
    assigned_to_employee_id INTEGER,
    title TEXT NOT NULL,
    details TEXT,
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK(priority IN ('Low','Normal','High','Urgent')),
    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Completed','Cancelled')),
    due_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY(assigned_to_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notebook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    business_id INTEGER,
    author_employee_id INTEGER,
    entry_text TEXT NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    FOREIGN KEY(author_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    business_id INTEGER,
    customer_name TEXT NOT NULL,
    destination_hold TEXT,
    destination_location TEXT,
    quoted_total INTEGER NOT NULL DEFAULT 0 CHECK(quoted_total >= 0),
    company_cut_percent REAL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Completed','Cancelled')),
    notes TEXT,
    created_by_employee_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL DEFAULT 'Standard',
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price INTEGER NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
    FOREIGN KEY(order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customer_order_participants (
    order_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'Participant',
    payout_amount INTEGER NOT NULL DEFAULT 0 CHECK(payout_amount >= 0),
    PRIMARY KEY(order_id, employee_id, role),
    FOREIGN KEY(order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    employee_id INTEGER,
    business_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE SET NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_businesses_company ON businesses(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employee_access_business ON employee_business_access(business_id, enabled);
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_item ON stock_batches(business_id, item_id, condition_name);
CREATE INDEX IF NOT EXISTS idx_stock_batches_parent ON stock_batches(parent_batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_participants_employee ON stock_batch_participants(employee_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_to ON transfers(from_business_id, to_business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_business_created ON sales(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_participants_employee ON sale_participants(employee_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_coffers_company_business ON coffer_transactions(company_id, business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_business_status ON tasks(business_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_notebook_business_created ON notebook_entries(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON customer_orders(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_created ON audit_log(company_id, created_at);

PRAGMA defer_foreign_keys = OFF;
