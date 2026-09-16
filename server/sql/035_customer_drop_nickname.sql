-- 移除 customer.nickname：展示名（昵称）由登录用户名 username 直接承担，不再单独维护。
-- 历史昵称数据随本列一并删除；前台、后台与订单/财务/评价等所有展示位统一改用 username。
-- 新库仍会先经 018 建 nickname 再由本文件删除，保持迁移链完整。
ALTER TABLE customer DROP COLUMN nickname;
