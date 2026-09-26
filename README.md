# 购物网站后台管理系统

[![Test](https://github.com/Kang341281X/Web/actions/workflows/test.yml/badge.svg)](https://github.com/Kang341281X/Web/actions/workflows/test.yml)

## 首次启动

```
# 0. 前置：装好 Node.js（建议 LTS，比如 18 或 20；better-sqlite3 是原生模块，版本差太多可能装不上)
git clone https://github.com/Kang341281X/Web.git
cd Web

# 1. 装依赖
npm install
# 如果这一步报 403 或下载失败（国内常见），先换源再重试：
# npm config set registry https://registry.npmjs.org/
# npm install

# 2. 配置环境变量（开发用这份）
cp .env.development.example .env.development
# 打开改一下 JWT_SECRET / CUSTOMER_JWT_SECRET（随便填够 32 位的随机字符串即可，开发环境不严格也能跑）

# 3. 初始化数据库表结构（脚本幂等，重复跑也没事）
npm run db:migrate

# 4. 写入种子账号
npm run db:seed
# 会建 superadmin / admin / admin01 / admin02 四个账号，密码都是 123456
# 且首次登录会强制要求改密码

# 5. 分别起两个进程（要开两个终端窗口）
npm run server   # 后端 Express，默认 3001
npm run dev      # 前端 Vite，默认 5173
```



## 哪些文件不入库（.gitignore 说明）

以下几类文件是**运行时产物或本机配置**，已被 `.gitignore` 排除且不应再提交：

| 类别 | 匹配规则 | 不入库的原因 |
|---|---|---|
| SQLite 数据库及其 WAL/SHM 伴随文件 | `server/data.db*`、`server/test.db*`、`server/tmp*.db*`、`server/backup-*/` | `data.db` 由 `npm run db:migrate` + `npm run db:seed` 随时重建，且内容随运行不断变化（订单、用户、bcrypt 密码哈希），提交会造成无意义的巨大 diff 与合并冲突；`-shm` / `-wal` 是 SQLite 运行期的共享内存与预写日志，只在本机有意义 |
| 运行日志 | `*.log` | dev / 部署脚本重定向输出的本地日志，含请求 IP 等环境相关信息，无协作价值且会无限增长 |
| 真实环境变量文件 | `.env`、`.env.*`（例外：各 `*.example` 模板继续入库） | 真实配置包含部署差异与 JWT 密钥等敏感值；模板 `.env.development.example` / `.env.production.example` / `.env.example` 已覆盖全部需要配置的变量，新环境复制模板后填写即可 |
| 依赖与构建产物 | `node_modules/`、`dist/` | 可由 `npm install` / `npm run build` 复现，仓库根目录 `.npmrc` 已固定官方源保证可复现性 |
| 测试产物 | `test-results/`、`playwright-report/`、`server/test.db*` | 每次 `npm test` 重新生成 |
| 用户上传内容 | `uploads/*`（保留 `.gitkeep` 占位） | 运行时生成，属于部署环境的数据而非代码 |

如果某个本应忽略的文件已被 git 跟踪，`.gitignore` 不会自动生效，需要先 `git rm --cached <文件>` 再提交。



## 顾客下单 → 后台人工发货

- 顾客在购物车结算弹窗里登录后可「提交订单」，系统在事务内校验并扣减库存、写入 `customer_order` / `order_item`，并清空已下单商品的购物车项；后台「订单管理」随即能看到新订单（`pending`），由管理员手工改状态发货。
- 下单时会把收货信息与账号信息（`customer_username` 用户名快照、`customer_email` 邮箱快照，见 `server/sql/026`）一并快照进订单，之后账号资料被改或被删都不影响历史订单。
- 运费以服务端为准：下单事务内按前端声明的界面语言查 `shipping_rate` 重新计算并写入订单（计入 `total_amount`）；与页面展示值不一致（如后台刚调价）返回 `409` 提示刷新重试，详见「汇率与运费」。
- 取消订单（顾客端或后台）只回补库存、不回滚销量；只有 `pending` / `confirmed` 可取消，`shipped` / `completed` / `cancelled` 为终态，重复取消幂等。
- 「下载结算清单 Excel」作为提交订单之外的并行选项保留：无需登录，导出后可先与客服核对再下单。本期不涉及任何在线支付、收银台或支付回调。

## 顾客账号与登录（用户名 + 密码）

- 登录凭证是**用户名**：`POST /api/customer/register` 需同时提交 `username` 与 `phone`。用户名为 4-20 位字母、数字或下划线且全局唯一，冲突返回 `409「用户名已被占用」`；手机号仍按原有规则校验、保持唯一，冲突返回 `409「该手机号已注册」`。
- `phone` 仍是 `customer` 表的主键 / 内部唯一标识（订单、地址、评论都锚定 `customer.id`），只是不再用于登录，其结构与约束未做改动；`username` 见 `server/sql/030`。
- 历史账号由迁移 030 自动回填 `username = phone`，因此老账号可直接用手机号当作用户名登录。**用户名一经注册不可修改**：它是登录凭证，个人中心（`Account.vue`）只展示不提供改名入口，`PUT /api/customer/profile` 也只接受手机号 / 邮箱 / 头像；后台同样没有改名接口。昵称字段已在迁移 035 中删除，展示名直接用用户名。
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
- `POST /api/customer/orders`（下单，body：`address_id`、`locale`（界面语言，用于服务端重算运费）、`shipping_fee`（页面展示运费，仅做一致性校验，不一致返回 `409`）、`remark?`、`items?`；`items` 省略时按购物车下单）
- `GET /api/customer/orders`（我的订单，支持 `page` / `page_size` / `status`）
- `GET /api/customer/orders/:id`（订单详情）
- `PUT /api/customer/orders/:id/cancel`（取消订单并回补库存）

顾客端结算清单导出（公开，无需登录）：

- `POST /api/public/checkout/export`
- `POST /api/public/intent-orders`（下载清单时保存的意向单，已废弃，仅作过渡保留）

后台订单管理：

- `GET /api/admin-orders`、`GET /api/admin-orders/stats`、`GET /api/admin-orders/:id`
- `PUT /api/admin-orders/:id/status`
- `POST /api/admin-orders/export`（导出订单 Excel，`mode: filter / selected`）

## 商品评论（登录可写，24 小时内可改，删除不限时）

- 入口在商品详情页「买家评价」面板：登录后可「写评价」（评分 1-5 + 文字 + 可选配图）；自己发布的评论展示「编辑 / 删除」。
- **只允许对「已完成（`status = completed`）」订单中包含的商品评价**：发布时把最近一笔命中订单的 id 写入 `product_review.order_id`，`is_purchased`（已购买标识）由此生效；没有已完成订单时返回 `400`「请先购买该商品后再评价」，前台同步隐藏「写评价」入口并提示（公开评论接口对已登录顾客返回 `can_review` 资格字段，与服务端校验同一口径）。
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

> 后台为什么也要加：后台权限远高于顾客账号（可改商品、订单、管理员），是比顾客端更值得挡的撞库目标；复用已有实现只需增加一个挂载点，成本近乎为零。若希望后台保持无障碍登录（例如内部脚本直连 `/api/admin/login`），删掉 `server/routes/admin.js` 里那段 `consumeCaptcha` 校验即可恢复。

可调环境变量（均有默认值，可不配置）：

- `CAPTCHA_TTL_MS`：有效期，默认 `300000`（5 分钟）
- `CAPTCHA_MAX_STORE`：同时存活的验证码条数上限，默认 `5000`

限流现状（`server/middleware/rateLimit.js`，按 IP 计数）：

- 登录接口（管理员 + 顾客）挂 `loginLimiter`：15 分钟 10 次，`skipSuccessfulRequests` 使登录成功的请求不消耗额度，额度只留给失败尝试（防爆破）。
- 注册接口挂 `registerLimiter`：每小时 10 次。注册本身无验证码，用限流兜底批量灌注册 / 用户名撞库探测。
- 生产环境挂在 Nginx 后面时必须配置 `X-Forwarded-For` 并设置 `TRUST_PROXY`（见「上传到服务器」第 6 步），否则限流取不到真实客户端 IP，会退化成全站共用额度。

仍未做（如需请另行确认）：按手机号维度的登录频率限制、验证码接口本身的限流。图形验证码只提高单次尝试成本，配合限流效果更好。

## 汇率与运费

- 汇率：后台「系统设置 → 汇率」维护 5 种语言各自的展示货币（`locale` / `currency_symbol` / `currency_code` / `rate_from_cny`，见 `server/sql/` 的 `exchange_rate` 表）。语言 store 启动时拉取一次 `/api/public/exchange-rates` 并缓存，`language.price()` 据此把人民币价格换算成当前语言的展示货币。
- 汇率只影响**展示**：`zh-CN` 恒为 `1`；下单、扣库存与订单金额一律按人民币计算，改汇率不会改变任何实际金额。
- 运费：后台「系统设置 → 运费」按区域维护（`region_key` 取 `CN` / `TW` / `JP` / `KR` / `OTHER`，`fee_cny` 为人民币运费，`0` 表示包邮，`note` 为可选备注，见 `shipping_rate` 表）。商品详情页按当前语言对应区域展示「预计运费」。下单时后端在下单事务内按前端声明的界面语言查 `shipping_rate.fee_cny` 重新计算运费并计入订单 `total_amount`（`shipping_fee` 列），前端传入的展示值仅做一致性校验：与当前费率不相等（后台调价后页面过期 / 数值被篡改）返回 `409`，提示「运费信息已过期，请刷新页面重试」，保证顾客被收取的运费永远与页面展示一致。

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
- `GET` / `PUT /api/customer/profile`（`PUT` 为 `multipart/form-data`，可改手机号 / 邮箱 / 头像；**用户名不可改**）、`PUT /api/customer/password`
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
- 商品导入（独立挂在 `/api/product-imports` 下）：`GET /api/product-imports/template`、`POST /api/product-imports/preview`、`POST /api/product-imports/confirm`、`POST /api/product-imports/online`、`POST /api/product-imports/:batchId/rename-folder`、`POST /api/product-imports/:batchId/create-category`、`PUT /api/product-imports/:batchId/rows/:row/sku`、`POST /api/product-imports/:batchId/generate-skus`、`DELETE /api/product-imports/:batchId`
- 分类：`GET` / `POST /api/categories`、`PUT` / `DELETE /api/categories/:id`、`POST /api/categories/:id/image`、`DELETE /api/categories/:id/image`
- 顾客：`GET /api/admin-customers`（`keyword` 匹配用户名 / 手机号 / 邮箱，可按 `status` 筛选）、`GET /api/admin-customers/stats`、`GET /api/admin-customers/:id`、`PUT /api/admin-customers/:id/status`
- 订单：`GET /api/admin-orders`、`GET /api/admin-orders/stats`、`GET /api/admin-orders/:id`、`PUT /api/admin-orders/:id/status`、`POST /api/admin-orders/export`（导出订单 Excel，`mode: filter / selected`，与商品导出同一套交互）
- 意向单（访客下载结算清单的只读记录）：`GET /api/admin-intent-orders`、`GET /api/admin-intent-orders/:id`
- 评论：`GET /api/admin-reviews`、`GET /api/admin-reviews/stats`、`PUT /api/admin-reviews/:id/status`、`DELETE /api/admin-reviews/:id`
- 收支明细（仅超级管理员，收入来自订单实时聚合、支出来自 `finance_expense` 手工登记）：`GET /api/admin/finance/summary`（`start_date` / `end_date` / `granularity=day|month`）、`GET /api/admin/finance/income`、`GET` / `POST /api/admin/finance/expenses`、`PUT` / `DELETE /api/admin/finance/expenses/:id`、`POST /api/admin/finance/export`（导出收入 / 支出明细 Excel）
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
每次修改代码后，重复以下命令即可同步（推送分支是 `master`）：
```
git add .
git commit -m ""
git push origin master
```



# 上传到服务器

这一步比本地运行多不少东西，核心是"从两个开发进程"变成"一套能长期稳定运行、能被外网安全访问的服务"：

**1. 服务器基础环境**
 一台 Linux 云主机，装好同版本的 Node.js，把代码传上去（git clone 或 CI 打包上传）。

**2. 前端要打包成静态文件，而不是继续跑 `npm run dev`**

```bash
npm run build   # 生成 dist/ 静态文件
```

生产环境不用 Vite 开发服务器，`dist/` 交给 Nginx 或者 Express 的静态托管来发。

**3. 配置生产环境变量**

```bash
cp .env.production.example .env.production
```

然后把里面几个值全部换成真实的：

- `JWT_SECRET` / `CUSTOMER_JWT_SECRET`：换成真正随机、足够长、互不相同的字符串——README 特别提到**生产环境缺少这两个密钥会直接拒绝启动**
- `PUBLIC_BASE_URL`：改成后端真实可访问的域名，比如 `https://api.yourshop.com`（决定图片上传后返回的地址对不对）
- `CORS_ORIGIN`：改成前端真实域名，比如 `https://yourshop.com`，不然前端调接口会被浏览器 CORS 挡掉
- `DB_PATH`、`UPLOAD_DIR`：改成服务器上一个会持久化、会被备份的绝对路径，别放在会被重新部署清空的目录里

**4. 在服务器上跑一次初始化**

```bash
npm run db:migrate
npm run db:seed
```

种子密码同样是 `123456`——**这个千万不能带着默认密码就对外网开放**，登录后立刻改掉，或者干脆自己写个种子脚本改成强密码后再上线。

**5. 让后端进程"常驻"，而不是前台跑一下就没了**
 SSH 断开、终端关掉，`npm run server` 就会跟着退出。需要进程守护，比如：

```bash
npm install -g pm2
pm2 start server/index.js --name shop-api
pm2 save
pm2 startup   # 让它开机自启
```

**6. 前面挡一层反向代理 + HTTPS**
 后端 Express 只监听 `127.0.0.1:3001`，不直接对公网暴露；用 Nginx（或 Caddy）做：

- 静态文件 `dist/` 直接由 Nginx 托管
- `/api/...` 之类的请求反向代理到 `127.0.0.1:3001`
- 用 certbot / Let's Encrypt 签发免费 HTTPS 证书

反代时必须把真实客户端 IP 传给后端，否则后端看到的 `req.ip` 恒为 `127.0.0.1`，登录/注册的按 IP 限流会退化成全站共用额度：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Host $host;
}
```

后端通过 `TRUST_PROXY` 环境变量决定是否信任该头（默认 `1`，即信任一层代理，`.env.production.example` 已带）；本地不挂代理直连开发时在 `.env.development` 里设 `TRUST_PROXY=false`。

**7. 防火墙 / 安全组**
 只放行 80、443（和你需要的 22 端口做 SSH），**3001 端口不要对公网开放**。

**8. 域名解析**
 把域名的 DNS A 记录指向服务器公网 IP。

**9. 数据备份**
 SQLite 是单文件数据库，定期备份 `data.db` 和 `uploads/` 目录就行。如果以后访问量变大想换真正的数据库（如 MySQL），`server/config/db.js` 已把查询封装成 `execute` / `getConnection` 形态（兼容 mysql2 风格的接口），届时引入对应驱动替换实现即可，业务代码基本不用动。

有一点我没能确认：`server/index.js` 里后端是否已经顺手把 `dist/` 静态文件也托管了（如果是，部署会更简单——一个 Node 进程 + Nginx 只做 HTTPS 终端和反代就够了，不用额外配 Nginx 托管静态文件那一段）。建议你打开这个文件看一眼有没有 `express.static(...)` 之类的代码，如果没有，就按上面第 6 步"Nginx 托管 dist + 反代 API"这套来做。
