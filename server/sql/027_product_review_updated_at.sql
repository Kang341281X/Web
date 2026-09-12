-- product_review 增加 updated_at（最后修改时间）
--
-- 背景：顾客端新增「评论发布后 24 小时内可修改，之后只能删除」的规则，需要把两件事分开记录：
--   created_at：发布时间，既是列表排序依据，也是 24 小时可修改窗口的唯一计算依据——
--              必须保持不变，否则「改一次就续期」会让时间限制形同虚设；
--   updated_at：最后一次修改时间，仅用于展示「已编辑」标记。
--
-- SQLite 的 ALTER TABLE ADD COLUMN 不支持「默认值等于另一列」（DEFAULT 只能是常量），
-- 因此先加可空列，再把存量评论的 updated_at 回填为 created_at（等价于「默认等于 created_at」）。
-- 应用层写入时一定显式给 updated_at 赋值，不依赖数据库默认值。
--
-- 幂等：迁移器按 PRAGMA table_info 检测列是否存在，已存在则整体跳过本文件。
ALTER TABLE product_review ADD COLUMN updated_at DATETIME;

-- 存量评论回填：未填写 updated_at 的一律视为「从未修改过」，与 created_at 相同
UPDATE product_review SET updated_at = created_at WHERE updated_at IS NULL;
