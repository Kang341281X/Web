-- 为分类添加图片字段（category.image），用于分类图标 / 首页轮播图
-- SQLite 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，因此由 migrate.js 在
-- 执行前通过 PRAGMA table_info(category) 检测列是否已存在；已存在时跳过本文件，
-- 保证迁移幂等、可重复执行。
ALTER TABLE category ADD COLUMN image TEXT;
