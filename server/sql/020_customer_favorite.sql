-- 顾客商品收藏：同一顾客对同一商品只允许一条记录
CREATE TABLE IF NOT EXISTS customer_favorite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_customer_favorite_customer_product ON customer_favorite (customer_id, product_id);
CREATE INDEX IF NOT EXISTS idx_customer_favorite_product ON customer_favorite (product_id);
