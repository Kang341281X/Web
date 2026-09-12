-- 顾客购物车：同一顾客对同一商品只允许一条记录，重复加购应在应用层累加 quantity
CREATE TABLE IF NOT EXISTS cart_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_cart_item_customer_product ON cart_item (customer_id, product_id);
