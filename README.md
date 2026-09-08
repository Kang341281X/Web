# 购物网站后台管理系统

## 首次启动

1. 安装依赖：执行 `npm install`。
   > 若因默认镜像源返回 **403**（或下载失败），请先切换到官方源后重试：
   > ```
   > npm config set registry https://registry.npmjs.org/
   > npm install
   > ```
2. 环境变量：建议将 `.env.development.example` 复制为 `.env.development`，按需修改 `JWT_SECRET` 等；数据库为 SQLite，无需单独配置 MySQL，`DB_PATH` 默认指向 `./server/data.db`。生产环境请使用 `.env.production`（可参考 `.env.production.example`），生产环境缺少 JWT 密钥时会拒绝启动。
3. 初始化数据库：执行 `npm run db:migrate`，自动按 `server/sql/` 下的迁移脚本创建表结构（脚本幂等，可重复执行）。
4. 写入种子数据：执行 `npm run db:seed`，创建 `superadmin`、`admin`、`admin01`、`admin02` 四个初始账号，密码均为 `123456`，且 `must_change_password = 1`，首次登录后必须在“个人中心”修改密码。
5. 分别运行 `npm run server` 与 `npm run dev`，访问后台 `http://localhost:5173/admin/login`。

数据库中只保存相对图片路径，`PUBLIC_BASE_URL` 负责生成可访问图片地址。

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
