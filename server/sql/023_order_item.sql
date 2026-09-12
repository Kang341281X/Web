-- 订单明细
--
-- product_id 允许为空并使用 ON DELETE SET NULL：商品支持硬删除（见 routes/products.js），
--   商品被删后历史订单明细仍需保留；商品名称/SKU/单价已快照在
--   product_name / product_sku / price，故解绑 product_id 不影响历史展示。
CREATE TABLE IF NOT EXISTS order_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  price REAL NOT NULL DEFAULT 0.00,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  subtotal REAL NOT NULL DEFAULT 0.00,
  FOREIGN KEY (order_id) REFERENCES customer_order(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_item_order ON order_item (order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_product ON order_item (product_id);
