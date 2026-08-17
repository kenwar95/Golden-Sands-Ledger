-- Golden Sands Ledger — Orders v1

ALTER TABLE customer_orders ADD COLUMN sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE customer_orders ADD COLUMN received_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE customer_orders ADD COLUMN estimated_time TEXT;

CREATE INDEX IF NOT EXISTS idx_customer_orders_business_status
ON customer_orders(business_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_orders_sale
ON customer_orders(sale_id);
