-- 迁移记录表：记录 server/sql/ 下每个 .sql 文件是否已成功执行过。
--
-- 背景：修复 migrate.js 每次启动重复执行所有 SQL 的问题——
--   老实现只对 ALTER TABLE ADD COLUMN 做幂等判断，006_seed_catalog.sql /
--   009_reseed_catalog.sql 这类「DELETE 整表 + 重新插入演示数据」的脚本
--   每次启动都会重跑，导致管理员在后台维护的商品/分类被清空。
--
-- 修复后 migrate.js 会先创建本表，并为每个成功执行的 .sql 文件写入一行记录；
-- 文件一旦被记录，后续启动即跳过，只有新文件才会被执行。
--
-- 注意：该表是迁移器自身的元数据表，migrate.js 在执行任何业务迁移之前会主动
--   创建它（否则无法判断 001-030 是否已执行）。此处保留同名建表语句，
--   使结构变更在 sql 目录内同样可追溯，且保证脚本可重复执行不报错。
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
