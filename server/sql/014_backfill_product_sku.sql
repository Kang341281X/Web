-- 回填历史数据中缺失的商品编号（SKU）
-- 规则：sku 为空时按「SKU + 6 位商品 id」补齐（id 全局唯一，故一次性回填不会相互冲突）；
-- 与运行时 generateUniqueSku() 的「SKU + 时间戳 + 序号」方案在长度/取值空间上互不重叠。
-- 幂等：本语句只在存在 sku IS NULL 的记录时生效，服务器每次启动重复执行无副作用。
UPDATE product
SET sku = 'SKU' || substr('000000' || CAST(id AS TEXT), -6)
WHERE sku IS NULL;
