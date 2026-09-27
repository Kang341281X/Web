-- 商品多语言译文表：为商品的 name / description / detail 提供按语言区分的译文。
--
-- 设计取舍：
--   1) 放在独立的 product_translation 表，而非扩 product 表增加多列，避免主表结构膨胀，
--      且无译文的商品不产生冗余行。
--   2) (product_id, locale) 联合唯一：同一商品同一语言只允许一条译文。
--   3) 译文各字段允许为空；前端/后端约定「无该语言译文」时回退到 product 的 zh-CN 原文
--      (product.name / product.description / product.detail)。
--   4) ON DELETE CASCADE：删除商品时译文随之外键级联删除。
CREATE TABLE IF NOT EXISTS product_translation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  name TEXT,
  description TEXT,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, locale),
  FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_product_translation_product_locale ON product_translation (product_id, locale);