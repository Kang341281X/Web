-- 顾客订单主表
--
-- 表名说明：使用 customer_order 而非 order。order 是 SQLite 保留关键字（ORDER BY），
--   若以 order 作表名，所有 SQL 都必须写成 `order` / "order" 转义；本项目查询均为裸表名拼接，
--   极易遗漏转义导致语法错误，故统一使用 customer_order。明细表沿用 order_item。
--
-- customer_id 允许为空：兼容未来可能的游客下单；并使用 ON DELETE SET NULL，
--   顾客账号被删除后订单仍保留（仅解绑账号），避免历史订单丢失。
-- receiver_name / receiver_phone / receiver_address 为下单时的地址快照，
--   刻意不引用 customer_address，避免顾客后续修改地址导致历史订单地址被改写。
-- handled_by / handled_by_name 沿用 015 的「管理员ID + 姓名快照」模式（不建外键），
--   管理员被删除或改名后仍能还原处理人。
CREATE TABLE IF NOT EXISTS customer_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  receiver_address TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipped', 'completed', 'cancelled')),
  remark TEXT,
  handled_by INTEGER,
  handled_by_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_order_customer ON customer_order (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_order_status ON customer_order (status);
CREATE INDEX IF NOT EXISTS idx_customer_order_created ON customer_order (created_at);
