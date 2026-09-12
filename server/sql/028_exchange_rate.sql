-- 汇率表：商品价格以人民币（CNY）为基准存储，前台按当前语言换算展示。
-- locale 取值即支持的 5 种语言，作为主键；每个语言一行。
-- 数据来源说明：改造前汇率硬编码在前端 src/data/currency.js 中，迁移后改由本表提供，
-- 后台「汇率设置」可动态调整，前台通过 GET /api/public/exchange-rates 只读获取并缓存。
CREATE TABLE IF NOT EXISTS exchange_rate (
  locale TEXT PRIMARY KEY,
  currency_symbol TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  rate_from_cny REAL NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 种子数据：沿用改造前 currency.js 中的静态汇率（es 语言已下线，不再写入）
INSERT OR IGNORE INTO exchange_rate (locale, currency_symbol, currency_code, rate_from_cny) VALUES
  ('zh-CN', '¥', 'CNY', 1),
  ('zh-TW', 'NT$', 'TWD', 4.4),
  ('en', '$', 'USD', 0.14),
  ('ja', '¥', 'JPY', 20.5),
  ('ko', '₩', 'KRW', 190);
