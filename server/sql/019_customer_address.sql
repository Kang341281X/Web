-- 顾客收货地址
--
-- 约束：同一顾客最多只能有一个 is_default = 1 的地址。
-- SQLite 的 CHECK 只能校验单行内部数据，无法表达「同表跨行」约束，
-- 因此该约束由应用层在事务中保证：先把该顾客其它地址 is_default 置 0，再把目标地址置 1。
CREATE TABLE IF NOT EXISTS customer_address (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  province TEXT,
  city TEXT,
  district TEXT,
  detail_address TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_customer_address_customer ON customer_address (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_address_default ON customer_address (customer_id, is_default);
