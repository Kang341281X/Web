CREATE TABLE IF NOT EXISTS intent_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  items TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'completed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_intent_order_status ON intent_order (status);
CREATE INDEX IF NOT EXISTS idx_intent_order_created ON intent_order (created_at);
