-- 回填历史商品/分类的"添加人"字段（假数据）：
-- 统一指定为系统中最早创建的超级管理员（不存在则取最早创建的任意管理员）
UPDATE product
SET created_by = (
      SELECT id FROM admin
      ORDER BY (role = 'super_admin') DESC, id ASC
      LIMIT 1
    ),
    created_by_name = (
      SELECT COALESCE(real_name, username) FROM admin
      ORDER BY (role = 'super_admin') DESC, id ASC
      LIMIT 1
    )
WHERE created_by IS NULL;

UPDATE category
SET created_by = (
      SELECT id FROM admin
      ORDER BY (role = 'super_admin') DESC, id ASC
      LIMIT 1
    ),
    created_by_name = (
      SELECT COALESCE(real_name, username) FROM admin
      ORDER BY (role = 'super_admin') DESC, id ASC
      LIMIT 1
    )
WHERE created_by IS NULL;
