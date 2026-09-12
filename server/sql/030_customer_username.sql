-- 顾客登录凭证由「手机号」改为「用户名」：
--   phone 仍保留为主键 / 内部唯一标识（订单、地址、评论等仍以 customer.id / phone 为锚点），不做任何改动；
--   新增 username 作为唯一的登录账号，登录接口改为「用户名 + 密码」。
ALTER TABLE customer ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_username ON customer (username);

-- 历史账号回填：老数据没有用户名，直接用其手机号充当用户名。
-- phone 本身唯一，因此回填值天然不冲突；这样老账号仍能用「手机号（其实就是它的用户名）+ 密码」登录，
-- 之后可在个人中心把用户名改成自己想要的（修改时会做唯一性校验）。
UPDATE customer SET username = phone WHERE username IS NULL OR username = '';
