-- Bootstrap only when creating a new, empty PREVIEW database.
-- Safe for an existing schema: no DROP, TRUNCATE, or customer-data migration.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  duration TEXT NOT NULL,
  price_baisa INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'production')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rejected', 'submitting', 'issuing', 'ready', 'review')),
  notification TEXT NOT NULL DEFAULT 'sending'
    CHECK (notification IN ('sending', 'sent', 'failed')),
  notification_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_at INTEGER,
  topup_id TEXT,
  delivery TEXT,
  provider_error TEXT,
  last_poll INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  order_number INTEGER
);
