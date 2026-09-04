# 购物网站后台管理系统

## 首次启动

1. 建议将 `.env.development.example` 复制为 `.env.development`，填写数据库密码与 JWT 密钥；未配置时本地服务会使用临时 JWT 密钥，但生产环境会拒绝启动。
2. 执行 `npm run db:migrate`，自动创建数据库并导入 [管理员表结构](server/sql/001_admin.sql)。
3. 执行 `npm run db:seed`，创建 `superadmin`、`admin`、`admin01`、`admin02` 四个初始账号，密码均为 `123456`。
5. 分别运行 `npm run server` 与 `npm run dev`。

初始密码首次登录后必须在“个人中心”修改。生产部署时使用 `.env.production`（可参考 `.env.production.example`），数据库中只保存相对图片路径，`PUBLIC_BASE_URL` 负责生成可访问图片地址。

## 本期接口

- `POST /api/admin/login`
- `GET` / `PUT /api/admin/profile`
- `GET` / `POST /api/admins`
- `GET` / `PUT` / `DELETE /api/admins/:id`
- `PUT /api/admins/:id/reset-password`


# 启动命令
```
npm run db:migrate
npm run db:seed
npm run server
npm run dev
```