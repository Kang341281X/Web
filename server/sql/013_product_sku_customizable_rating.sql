-- 商品编号 / 是否支持定制 / 商品评分
ALTER TABLE product ADD COLUMN sku TEXT;
ALTER TABLE product ADD COLUMN is_customizable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product ADD COLUMN rating REAL NOT NULL DEFAULT 5.0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sku ON product (sku) WHERE sku IS NOT NULL;
