-- Golden Sands Ledger — Core shared-data support
-- Adds stable logical inventory entries used by the current frontend.

CREATE TABLE IF NOT EXISTS inventory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL DEFAULT 'Standard',
    unit_sale_price INTEGER NOT NULL DEFAULT 0 CHECK(unit_sale_price >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT,
    UNIQUE(business_id, item_id, condition_name)
);

CREATE INDEX IF NOT EXISTS idx_inventory_entries_business
ON inventory_entries(business_id, is_active);
