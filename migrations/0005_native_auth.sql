-- Golden Sands Ledger — Native Authentication v1

CREATE TABLE IF NOT EXISTS auth_sessions (
    session_hash TEXT PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_employee
ON auth_sessions(employee_id, expires_at);

CREATE TABLE IF NOT EXISTS employee_credentials (
    employee_id INTEGER PRIMARY KEY,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL DEFAULT 210000,
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
    password_updated_at INTEGER NOT NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_credentials_updated
ON employee_credentials(password_updated_at);
