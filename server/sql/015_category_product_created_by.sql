-- 商品/分类新增"添加人"字段：created_by 存管理员ID，created_by_name 存创建时的管理员姓名快照
-- 采用与 operation_log 表（admin_id + admin_username）一致的"ID + 姓名快照"模式，
-- 避免管理员账号后续被删除或改名后，历史商品/分类找不到创建人
ALTER TABLE product ADD COLUMN created_by INTEGER;
ALTER TABLE product ADD COLUMN created_by_name TEXT;
ALTER TABLE category ADD COLUMN created_by INTEGER;
ALTER TABLE category ADD COLUMN created_by_name TEXT;
CREATE INDEX IF NOT EXISTS idx_product_created_by ON product (created_by);
CREATE INDEX IF NOT EXISTS idx_category_created_by ON category (created_by);
