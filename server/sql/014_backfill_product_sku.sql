-- 回填历史数据中缺失的商品编号（SKU）：sku 为空时先用「SKU + 6 位商品 id」占位，
-- 保证 013 新增的 sku 列没有空值（唯一索引允许 NULL，但业务上不希望出现空编号）。
-- 注意：该占位格式已过时，服务器随后会执行 017_product_sku_format.sql，
--      统一重排为最终 10 位格式（3 位大写字母 + 7 位数字），本文件仅作为历史步骤保留。
-- 幂等：本语句只在存在 sku IS NULL 的记录时生效，服务器每次启动重复执行无副作用。
UPDATE product
SET sku = 'SKU' || substr('000000' || CAST(id AS TEXT), -6)
WHERE sku IS NULL;
