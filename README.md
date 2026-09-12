# 购物网站后台管理系统

## 首次启动

1. 安装依赖：执行 `npm install`。
   > 若因默认镜像源返回 **403**（或下载失败），请先切换到官方源后重试：
   > ```
   > npm config set registry https://registry.npmjs.org/
   > npm install
   > ```
2. 环境变量：建议将 `.env.development.example` 复制为 `.env.development`，按需修改 `JWT_SECRET` 等；数据库为 SQLite，无需单独配置 MySQL，`DB_PATH` 默认指向 `./server/data.db`。生产环境请使用 `.env.production`（可参考 `.env.production.example`），生产环境缺少 JWT 密钥时会拒绝启动。
3. 初始化数据库：执行 `npm run db:migrate`，自动按 `server/sql/` 下的迁移脚本创建表结构（脚本幂等，可重复执行；`npm run server` 启动时也会自动跑一遍迁移）。新增迁移脚本请按现有编号递增，不要修改历史文件。
4. 写入种子数据：执行 `npm run db:seed`，创建 `superadmin`、`admin`、`admin01`、`admin02` 四个初始账号，密码均为 `123456`，且 `must_change_password = 1`，首次登录后必须在“个人中心”修改密码。
5. 分别运行 `npm run server` 与 `npm run dev`，访问后台 `http://localhost:5173/admin/login`。
6. 可选：写入开发联调用的大批量假数据（都带可识别标记，重复执行会先清理上一轮再重建），按下面顺序执行：
   - `npm run seed:products`：写入 400 条商品假数据，按权重分布在现有 7 个分类下，图片统一复用 `/assets/images/placeholders/product-placeholder.svg`。SKU 统一使用保留前缀 `ZZZ` + 7 位数字作为清理标记（后台是只读字段，改名或改描述都不影响识别），因此脚本只删除上一轮由它自己创建的商品，不会影响管理后台手工新增的商品，也不会影响 `006` / `009` 的 40 条历史演示商品。脚本跑完会把 `006_seed_catalog.sql`、`009_reseed_catalog.sql` 写入 `schema_migrations` 标记为已执行，避免后续迁移重跑它们（它们是「整表清空 + 重建 40 条」的破坏性写法）把商品目录清空。
   - `npm run seed:dev`：在现有商品之上写入 100 位测试顾客（`seeduser001` ~ `seeduser100`，密码 `123456`）、500 条订单（pending / confirmed / shipped / completed / cancelled = 20% / 20% / 20% / 30% / 10%）与 1000 条商品评论（长尾分布），并回写 `product.rating` / `product.review_count`。
   > 完整顺序：`npm run db:migrate` → `npm run db:seed` → `npm run seed:products` → `npm run seed:dev`。
   >
   > 注意：`seed:products` 重跑会把这 400 条假商品连同它们的评论 / 收藏 / 购物车一起删掉重建（历史订单明细只解绑商品关联，商品名/SKU/单价快照仍保留），所以重跑它之后需要再执行一次 `npm run seed:dev` 补回评论。

数据库中只保存相对图片路径，`PUBLIC_BASE_URL` 负责生成可访问图片地址。

`node_modules`、`dist`、`uploads`（用户上传内容）与本地数据库 `server/data.db*`、`server/tmp*.db`（含 WAL / SHM）都不入库，由 `npm install` / `npm run build` / 启动脚本在本地生成；`uploads` 仅保留 `.gitkeep` 占位。

## 顾客下单 → 后台人工发货

- 顾客在购物车结算弹窗里登录后可「提交订单」，系统在事务内校验并扣减库存、写入 `customer_order` / `order_item`，并清空已下单商品的购物车项；后台「订单管理」随即能看到新订单（`pending`），由管理员手工改状态发货。
- 下单时会把收货信息与账号信息（`customer_username` 昵称快照、`customer_email` 邮箱快照，见 `server/sql/026`）一并快照进订单，之后账号资料被改或被删都不影响历史订单。
- 取消订单（顾客端或后台）只回补库存、不回滚销量；只有 `pending` / `confirmed` 可取消，`shipped` / `completed` / `cancelled` 为终态，重复取消幂等。
- 「下载结算清单 Excel」作为提交订单之外的并行选项保留：无需登录，导出后可先与客服核对再下单。本期不涉及任何在线支付、收银台或支付回调。

## 顾客账号与登录（用户名 + 密码）

- 登录凭证是**用户名**：`POST /api/customer/register` 需同时提交 `username` 与 `phone`。用户名为 4-20 位字母、数字或下划线且全局唯一，冲突返回 `409「用户名已被占用」`；手机号仍按原有规则校验、保持唯一，冲突返回 `409「该手机号已注册」`。
- `phone` 仍是 `customer` 表的主键 / 内部唯一标识（订单、地址、评论都锚定 `customer.id`），只是不再用于登录，其结构与约束未做改动；`username` 见 `server/sql/030`。
- 历史账号由迁移 030 自动回填 `username = phone`，因此老账号可直接用手机号当作用户名登录，之后可在个人中心改成其它用户名（改名前会做唯一性校验，重复则返回 `409`）。
- 本应用没有短信 / 邮件找回，忘记用户名时管理员可在后台「顾客管理」（支持按用户名搜索）查看。

## 结算与订单接口

顾客端（除注册/登录外均需顾客 token，`Authorization: Bearer <customer_token>`）：

- `POST /api/customer/register`（校验用户名 + 手机号格式，用户名全局唯一）、`POST /api/customer/login`（**用户名 + 密码**，需带 `captchaId` / `captchaText`，见下文「登录防机器人验证」）
- `GET` / `PUT /api/customer/profile`、`PUT /api/customer/password`
- `GET` / `POST /api/customer/addresses`、`PUT` / `DELETE /api/customer/addresses/:id`、`PUT /api/customer/addresses/:id/set-default`
- `GET` / `POST` / `DELETE /api/customer/cart`、`PUT` / `DELETE /api/customer/cart/:productId`、`POST /api/customer/cart/merge`
- `GET` / `POST /api/customer/favorites`、`POST` / `DELETE /api/customer/favorites/:productId`、`POST /api/customer/favorites/merge`
- `POST /api/customer/products/:productId/reviews`（发布评价）
- `PUT /api/customer/reviews/:id`（修改评价，发布超过 24 小时拒绝）
- `DELETE /api/customer/reviews/:id`（删除评价，不限时间）
- `POST /api/customer/orders`（下单，body：`address_id`、`remark?`、`items?`；`items` 省略时按购物车下单）
- `GET /api/customer/orders`（我的订单，支持 `page` / `page_size` / `status`）
- `GET /api/customer/orders/:id`（订单详情）
- `PUT /api/customer/orders/:id/cancel`（取消订单并回补库存）

顾客端结算清单导出（公开，无需登录）：

- `POST /api/public/checkout/export`
- `POST /api/public/intent-orders`（下载清单时保存的意向单，已废弃，仅作过渡保留）

后台订单管理：

- `GET /api/admin-orders`、`GET /api/admin-orders/stats`、`GET /api/admin-orders/:id`
- `PUT /api/admin-orders/:id/status`

## 商品评论（登录可写，24 小时内可改，删除不限时）

- 入口在商品详情页「买家评价」面板：登录后可「写评价」（评分 1-5 + 文字 + 可选配图）；自己发布的评论展示「编辑 / 删除」。
- 任何登录用户都可以评价，**不校验是否购买过**；`is_purchased` 仅在评论绑定了订单时为真，顾客端入口产生的评价恒为 `false`。
- 发布后 24 小时内可修改，超过 24 小时只能删除（前端不展示「编辑」按钮，后端返回 400「评论发布超过 24 小时，无法修改」）。`created_at` 是判定窗口的唯一依据，改一次不会重新计时（见 `server/sql/027`）。
- 增 / 改 / 删都会重算商品评分（`product.rating` / `review_count`）。后台「隐藏评论」与顾客「删除评论」共用 `server/utils/review.js` 里的同一份重算逻辑，保证两边口径一致。
- 评论配图存放在 `/uploads/reviews/`，单张不超过 5MB、单条评论最多 6 张；删除评论或编辑时移除配图会一并清理文件。

顾客端（需顾客 token）：

- `POST /api/customer/products/:productId/reviews`（`multipart/form-data`：`rating` 1-5、`content` 1-500 字、`images` 多个文件可选）
- `PUT /api/customer/reviews/:id`（只能改自己的评论；`keep_images` 传保留的旧图、`images` 传新增图片）
- `DELETE /api/customer/reviews/:id`（只能删自己的评论，不限时间）

前台（公开，无需登录；带顾客 token 时会额外返回 `is_mine` / `can_edit`，仅用于按钮显隐，真正拦截仍在服务端）：

- `GET /api/public/products/:id/reviews`

后台评论管理（页面无需改动，已复用同一份评分重算逻辑）：

- `GET /api/admin-reviews`、`GET /api/admin-reviews/stats`
- `PUT /api/admin-reviews/:id/status`、`DELETE /api/admin-reviews/:id`

## 登录防机器人验证（图形验证码）

- 目的：给登录加一层人机校验，抬高暴力破解 / 撞库的成本。**不使用短信验证码，也不接入 Google reCAPTCHA 等外部服务**；注册流程仍不校验验证码（只校验用户名与手机号格式）。
- 方案：自托管 `svg-captcha`（纯 JS、无原生依赖、不发起任何外部请求，直接产出 SVG）。
- 存储：进程内 `Map`（`server/services/captchaService.js`）。本项目是单进程 + SQLite，不需要外部存储；`captchaId` 为随机 UUID，默认 5 分钟过期；签发前惰性清理 + 每分钟兜底清理，并限制同时存活条数，避免内存无上限增长。将来若要多实例部署，把这个 store 换成 Redis / 数据库即可，对外接口不变。
- **一次性**：无论校验成功还是失败，该 `captchaId` 都会立即作废。这是防爆破的关键——否则攻击者只要人工识别一次，就能拿同一张图反复试密码。相应地，前端在**任何**登录失败后都会自动换一张新图。
- 校验顺序：先验验证码、再验账号密码；验证码不通过时**完全不查数据库**，既省下一次 bcrypt 开销，也不会通过响应快慢泄漏用户名 / 账号是否存在。
- 失败统一返回 `400` + `{ "code": "CAPTCHA_INVALID", "message": "验证码错误或已过期" }`。用 `400` 而非 `401`，是因为 `401` 在本项目语义固定为「账号或密码错误」；带 `code` 是为了让前端可靠地区分「该刷新验证码」，不必去匹配中文提示。

验证码签发（公开，无需登录）：

- `GET /api/customer/captcha` —— 前台顾客登录（`src/components/common/LoginModal.vue`）
- `GET /api/captcha` —— 后台管理员登录（`src/views/admin/AdminLogin.vue`）

两者是**同一份实现挂在两个前缀下**（`server/routes/captcha.js` 在 `server/index.js` 中被挂载两次）。验证码本身不携带任何身份、与「是谁在登录」无关，做两套实现和两份存储只会重复 TTL、清理、作废等边界逻辑，并没有额外安全收益。

响应：

```
{
  "success": true,
  "captchaId": "0f1c…",                  // 登录时随表单回传
  "image": "data:image/svg+xml;base64,…",// 可直接给 <img src>
  "expiresIn": 300                       // 有效期（秒）
}
```

`image` 用 data URI 而不是 SVG 源码：源码方式前端只能 `v-html` 注入，等于把服务端返回的字符串当 HTML 解析；包成 data URI 后浏览器按图片处理，不存在脚本执行面。

登录请求体新增两个字段（`captchaId` / `captchaText`，同时兼容 `captcha_id` / `captcha_text`）：

- `POST /api/customer/login`：`{ username, password, captchaId, captchaText }`
- `POST /api/admin/login`：`{ username, password, captchaId, captchaText }`

> 后台为什么也要加：后台权限远高于顾客账号（可改商品、订单、管理员），且登录页上直接写着默认口令提示，是比顾客端更值得挡的撞库目标；复用已有实现只需增加一个挂载点，成本近乎为零。若希望后台保持无障碍登录（例如内部脚本直连 `/api/admin/login`），删掉 `server/routes/admin.js` 里那段 `consumeCaptcha` 校验即可恢复。

可调环境变量（均有默认值，可不配置）：

- `CAPTCHA_TTL_MS`：有效期，默认 `300000`（5 分钟）
- `CAPTCHA_MAX_STORE`：同时存活的验证码条数上限，默认 `5000`

当前未做（如需请另行确认）：按 IP / 手机号维度的登录频率限制、验证码接口本身的限流。图形验证码只提高单次尝试成本，配合限流效果更好。

## 汇率与运费

- 汇率：后台「系统设置 → 汇率」维护 5 种语言各自的展示货币（`locale` / `currency_symbol` / `currency_code` / `rate_from_cny`，见 `server/sql/` 的 `exchange_rate` 表）。语言 store 启动时拉取一次 `/api/public/exchange-rates` 并缓存，`language.price()` 据此把人民币价格换算成当前语言的展示货币。
- 汇率只影响**展示**：`zh-CN` 恒为 `1`；下单、扣库存与订单金额一律按人民币计算，改汇率不会改变任何实际金额。
- 运费：后台「系统设置 → 运费」按区域维护（`region_key` 取 `CN` / `TW` / `JP` / `KR` / `OTHER`，`fee_cny` 为人民币运费，`0` 表示包邮，`note` 为可选备注，见 `shipping_rate` 表）。商品详情页按当前语言对应区域展示「预计运费」，同样只作展示参考，不参与结算金额。

相关接口：

- `GET /api/public/exchange-rates`、`GET /api/public/shipping-rates`（公开只读，各返回 5 条）
- `GET /api/admin/exchange-rates`（全部汇率）、`PUT /api/admin/exchange-rates/:locale`（改单条；`rate_from_cny` 必须大于 0，语言不支持返回 `400`，记录不存在返回 `404`）
- `GET` / `PUT /api/admin/shipping-rates`（`PUT` 同时支持批量保存与单条行内保存，body 为 `{ rates: [{ region_key, fee_cny, note? }] }`；区域非法返回 `400`，区域不存在返回 `404`，成功后返回全量列表）

## 接口总览

统一前缀 `/api`，响应体统一为 `{ success, data, message?, pagination? }`，列表分页参数统一为 `page` / `page_size`。三套鉴权互不通用；各接口的语义与边界条件见上文对应章节。

鉴权分组：管理员 token —— `/api/admin`、`/api/admins`（额外要求超管）、`/api/admin-*`、`/api/products`（含导入）、`/api/categories`、`/api/settings`、`/api/logs`；顾客 token —— `/api/customer/*`；公开无需 token —— `/api/public/*`、`/api/captcha`、`/api/customer/captcha`、`/api/health`。

### 公开接口（无需登录）

- `GET /api/health`
- `GET /api/public/categories`（有封面图的启用分类，首页轮播用）
- `GET /api/public/products`（`keyword` / `category_id` / `min_price` / `max_price` / `sort` + 分页，`page_size` 上限 100；前台搜索栏联想与搜索结果页共用此接口）
- `GET /api/public/products/:id`（商品详情，含图集）
- `GET /api/public/products/:id/reviews`（买家评价 + 评分概览）
- `GET /api/public/settings`（站点设置 + 社交媒体二维码）
- `GET /api/public/exchange-rates`、`GET /api/public/shipping-rates`
- `GET /api/customer/captcha`（顾客登录用）、`GET /api/captcha`（管理员登录用）
- `POST /api/public/checkout/export`（导出结算清单 Excel）
- `POST /api/public/intent-orders`（意向单，已废弃，仅作过渡保留）

### 顾客接口

- `POST /api/customer/register`（用户名 + 手机号 + 密码）、`POST /api/customer/login`（用户名 + 密码 + 验证码）—— 无需 token
- `GET` / `PUT /api/customer/profile`（`PUT` 为 `multipart/form-data`，可改昵称 / 用户名 / 邮箱 / 头像）、`PUT /api/customer/password`
- 收货地址：`GET` / `POST /api/customer/addresses`、`PUT` / `DELETE /api/customer/addresses/:id`、`PUT /api/customer/addresses/:id/set-default`
- 购物车：`GET` / `POST` / `DELETE /api/customer/cart`、`PUT` / `DELETE /api/customer/cart/:productId`、`POST /api/customer/cart/merge`
- 收藏：`GET` / `POST /api/customer/favorites`、`POST` / `DELETE /api/customer/favorites/:productId`、`POST /api/customer/favorites/merge`
- 订单：`POST` / `GET /api/customer/orders`、`GET /api/customer/orders/:id`、`PUT /api/customer/orders/:id/cancel`
- 评价：`POST /api/customer/products/:productId/reviews`、`PUT` / `DELETE /api/customer/reviews/:id`

### 后台接口

- 登录与当前账号：`POST /api/admin/login`（需带 `captchaId` / `captchaText`）、`GET` / `PUT /api/admin/profile`
- 管理员管理（超管）：`GET` / `POST /api/admins`、`GET` / `PUT` / `DELETE /api/admins/:id`、`PUT /api/admins/:id/reset-password`
- 商品：`GET` / `POST /api/products`、`GET /api/products/stats`、`GET` / `PUT` / `DELETE /api/products/:id`、`POST /api/products/batch-delete`、`POST /api/products/export`（导出商品 Excel，按选中项或筛选结果）
- 商品图片：`POST /api/products/:id/images`、`PUT /api/products/:id/images/sort`、`POST /api/products/images/:imageId/replace`、`PUT /api/products/images/:imageId/set-main`、`DELETE /api/products/images/:imageId`
- 商品导入（同样挂在 `/api/products` 下）：`GET /api/products/import-template`、`POST /api/products/import/preview`、`POST /api/products/import/confirm`、`POST /api/products/import/online`、`POST /api/products/import/:batchId/rename-folder`、`POST /api/products/import/:batchId/create-category`、`PUT /api/products/import/:batchId/rows/:row/sku`、`POST /api/products/import/:batchId/generate-skus`、`DELETE /api/products/import/:batchId`
- 分类：`GET` / `POST /api/categories`、`PUT` / `DELETE /api/categories/:id`、`POST /api/categories/:id/image`、`DELETE /api/categories/:id/image`
- 顾客：`GET /api/admin-customers`（`keyword` 匹配用户名 / 手机号 / 昵称 / 邮箱）、`GET /api/admin-customers/stats`、`GET /api/admin-customers/:id`、`PUT /api/admin-customers/:id/status`
- 订单：`GET /api/admin-orders`、`GET /api/admin-orders/stats`、`GET /api/admin-orders/:id`、`PUT /api/admin-orders/:id/status`
- 评论：`GET /api/admin-reviews`、`GET /api/admin-reviews/stats`、`PUT /api/admin-reviews/:id/status`、`DELETE /api/admin-reviews/:id`
- 设置：`GET` / `PUT /api/settings`、`GET` / `POST /api/settings/socials`、`PUT` / `DELETE /api/settings/socials/:id`、`POST /api/settings/socials/:id/image`
- 汇率与运费：见上文「汇率与运费」
- 操作日志：`GET /api/logs`（`keyword` / `module` / `start_date` / `end_date` + 分页）


# 启动命令
```
npm run db:migrate
npm run db:seed
npm run seed:products   # 可选：400 条商品假数据
npm run seed:dev        # 可选：100 位顾客 + 500 条订单 + 1000 条评论
npm run server
npm run dev
```

# GitHub
每次修改代码后，重复以下命令即可同步：
```
git add .
git commit -m ""
git push origin main
```
