-- customer_order 下单人账号快照
--
-- 背景：customer_order.customer_id 使用 ON DELETE SET NULL（见 022），顾客账号被删除后订单会解绑，
--   管理端 LEFT JOIN customer 得到的 customer_phone / customer_nickname 会变成空值，历史订单无法还原下单人；
--   顾客修改昵称/邮箱后，同一订单展示的账号信息也会跟着变化。
--
-- 因此在下单时把账号信息「快照」进订单主表，之后无论账号资料被改还是被删，订单里的信息都不再变化：
--   customer_username：下单时昵称快照（昵称为空时取手机号），用于后台识别下单人；
--   customer_email：下单时邮箱快照。
--
-- 允许为空：兼容 022/023 阶段已存在的历史订单（无快照），也兼容 customer_id 为空的历史游客订单。
-- 幂等：迁移器按 PRAGMA table_info 检测列是否存在，已存在则跳过本文件。
ALTER TABLE customer_order ADD COLUMN customer_username TEXT;
ALTER TABLE customer_order ADD COLUMN customer_email TEXT;
