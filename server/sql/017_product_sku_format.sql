-- 商品编号(SKU) 格式重设计 —— 存量数据统一为最终 10 位格式（幂等）
--
-- 最终格式：固定 10 位
--   前 3 位：当前登录管理员的用户名 → 3 位大写英文字母（A-Z）
--   后 7 位：生成时刻的时间戳   → 7 位数字编码（0-9）
--   正则： ^[A-Z]{3}[0-9]{7}$
--
-- 背景：013 新增 sku 列、014 用 'SKU000123' 之类的占位值回填，均不符合上述最终格式。
-- 本迁移把「sku 为空 / 长度不为 10 / 不符合最终格式」的历史编号统一重排为符合格式的假数据：
-- 前 3 位字母、后 7 位数字均由商品 id 稳定推导（id 全局唯一，故不会相互冲突），
-- 已符合最终格式的真实编号不会被覆盖。
--
-- 假数据示例（前 3 位字母按 id 循环推导，后 7 位为左补 0 的 7 位 id）：
--   id=1  锤目纹银戒      → AAA0000001
--   id=2  珍珠黄铜耳环    → AAB0000002
--   id=5  珐琅彩绘胸针    → AAE0000005
--   id=27 实木相框        → ABA0000027
--   id=40 羊毛手织围巾    → ABN0000040
--
-- 幂等：条件对已合规编号恒为 false，重复执行无副作用。
UPDATE product
SET sku =
  substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (CAST((id - 1) / 676 AS INTEGER) % 26) + 1, 1) ||
  substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (CAST((id - 1) / 26  AS INTEGER) % 26) + 1, 1) ||
  substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ', ((id - 1) % 26) + 1, 1) ||
  substr('0000000' || CAST(id AS TEXT), -7)
WHERE sku IS NULL
   OR length(sku) <> 10
   OR sku NOT GLOB '[A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';
