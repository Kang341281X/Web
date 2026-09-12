-- 商品评论表
--
-- product_id 使用 ON DELETE CASCADE：商品支持硬删除（见 routes/products.js），
--   商品没了，挂在它下面的评论也没有意义，一起清理。
-- customer_id 允许为空并使用 ON DELETE SET NULL：兼容「账号注销但评论保留」的场景；
--   列表展示用的是 customer_name 昵称快照，账号被删除后评论依然能正常显示。
-- customer_name TEXT NOT NULL：评论时的昵称快照，不跟随 customer 改名/删除变化。
-- images：评论配图，存 JSON 数组字符串（如 '["/uploads/products/xx.jpg"]'），
--   本阶段只留字段，前端暂未实现上传。
-- order_id 允许为空并使用 ON DELETE SET NULL：空 = 普通评价；有值 = 已购买用户评价。
--   订单被删除时仅解绑，不影响评论本身。
-- status：1 显示 / 0 隐藏，供后台管理员做评论管理（隐藏差评而不删数据，可恢复）。
CREATE TABLE IF NOT EXISTS product_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  customer_id INTEGER,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  images TEXT,
  order_id INTEGER,
  status INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES customer_order(id) ON DELETE SET NULL
);
-- 商品详情页固定按「某商品 + 时间倒序」取评论，该组合索引正好覆盖这个查询
CREATE INDEX IF NOT EXISTS idx_product_review_product ON product_review (product_id, created_at);
-- 顾客中心「我的评价」按 customer_id 查询
CREATE INDEX IF NOT EXISTS idx_product_review_customer ON product_review (customer_id);

-- product 表补 review_count（商品评论数）
-- 背景：前端 src/services/publicApi.js 的 adaptProduct 一直在读 raw.review_count，
--   但 product 表历史上只有 rating、没有评论数，后端也从未返回过该字段，
--   导致商品卡片上的评论数永远是 0（历史遗留 bug）。这里补上字段。
ALTER TABLE product ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
