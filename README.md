# 丹康园（Dankangyuan）购物网站

丹康园是一个面向手作商品的单店铺购物网站，采用 Vue 3、Vite、Express 和 SQLite。顾客可以浏览商品、管理购物车和地址、提交订单及发布评价；管理员通过独立后台维护商品、订单和站点数据。

本站不接在线支付。顾客提交订单后由后台人工确认并处理发货。商品的 brand/manufacturer 可用于展示卖家名称和筛选作品，但系统没有多商户入驻、独立店铺账号或店铺结算流程。

## 功能

### 顾客端

- 首页、分类页、商品列表和搜索；支持筛选、排序、分页、搜索建议与本地搜索历史。
- 商品详情含图片集、手动切图、桌面端悬停放大、库存、运费估算、相关商品与评价。
- 支持简体中文、繁体中文、英语、日语、韩语界面。商品名称、描述和详情从 `product_translation` 读取当前语言译文；缺少译文时回退到商品原文。搜索同时匹配原文及当前语言译文。
- 登录顾客可管理服务端购物车、收藏、个人资料、收货地址、订单和评价。购物车加购前需要登录。
- 结算可提交订单或下载 Excel 结算清单。下单时服务端重新校验运费、库存和地址，并在事务中扣库存、创建订单和清除已购购物车项。
- 订单未发货前可取消；取消会回补库存。完成订单后可以评价，发布后 24 小时内可编辑。
- 商品价格按当前语言的汇率展示，订单金额仍以人民币记录。

### 管理后台

- 商品与图片管理、分类管理、Excel 商品导入/导出。
- 订单状态管理、顾客管理、评价管理。
- 汇率、运费、联系方式及社交媒体二维码设置。
- 操作日志、财务收支、管理员账号和权限管理；财务、管理员管理等功能仅超级管理员可用。
- 管理员登录使用图形验证码；新建管理员首次登录需要修改密码。

## 技术结构

```text
src/                 Vue 前端：页面、组件、状态和 API 客户端
server/              Express API、SQLite 迁移、后台与顾客接口
server/sql/          按序号管理的数据库迁移（当前 001–038）
shared/              前后端共用的商品规则
tests/               Playwright API 测试
playwright.config.js  测试服务、端口和隔离数据库配置
```

前端由 Vite 开发服务器提供；Express API 默认监听 `3001`。数据库默认使用 `server/data.db`，可通过 `DB_PATH` 更改。上传文件默认写入 `uploads/`。

## 本地开发

需要安装项目支持的 Node.js 版本和 npm。`better-sqlite3` 是原生依赖，安装时需使用当前 Node 版本对应的预编译包或构建工具。

```bash
npm install
```

复制开发环境变量模板并按需调整密钥：

```bash
cp .env.development.example .env.development
```

数据库迁移会在启动服务时自动执行；也可以手动运行迁移和种子数据：

```bash
npm run db:migrate
npm run db:seed
```

可选的演示数据脚本：

```bash
npm run seed:products
npm run seed:dev
```

在两个终端分别启动前端与 API：

```bash
npm run server
```
```
npm run dev


前端默认地址为 `http://localhost:5173`，API 默认地址为 `http://localhost:3001`。健康检查地址：`/api/health`。

## 测试与构建

```bash
npm test
npm run build
```

Playwright 覆盖后端 HTTP API 和地址管理浏览器流程。测试会在 `server/test.db` 上运行，基线复制自 `server/data.db`，不会将测试订单等数据写入开发数据库。测试使用 `3999` 端口运行 API，并在 `5999` 端口启动 Vite 服务，浏览器测试通过该 Vite 服务代理到测试 API。运行浏览器用例需要安装 Google Chrome，或调整 `playwright.config.js` 的浏览器通道。

最近一次验证（2026-10-18）：

- `npm test`：35 项通过，包含 5 种中国地址粘贴格式、默认地址/上限 API 边界及国际地址表单浏览器流程。
- `npm run build`：构建成功。Vite 仍提示 ECharts 相关分块约 1.1 MB，超过默认 500 kB 提示阈值；不影响构建成功。
- 本次构建输出 `dist/`，该目录是可重建产物，不需要提交；需要重新生成时运行 `npm run build`。

现有 API 测试覆盖登录/验证码、权限隔离、注册、结算清单导出、下单与取消、库存变更、订单号、商品译文回退和评价权限。尚无浏览器级 E2E 测试，因此前端页面布局和真实浏览器交互不由 `npm test` 覆盖。

## API 概览

所有 API 以 `/api` 为前缀。顾客与管理员使用各自独立的 JWT 密钥。

- 公开：`/api/health`、`/api/public/*`、`/api/captcha`。
- 顾客：`/api/customer/*`，包括注册/登录、个人资料、地址、购物车、收藏、订单和评价。
- 管理：`/api/admin`、`/api/admins`、`/api/products`、`/api/categories`、`/api/admin-orders`、`/api/admin-customers`、`/api/admin-reviews`、`/api/product-imports`、`/api/settings`、`/api/logs`、`/api/admin/finance`。

商品公开接口支持按 `X-Locale` 请求头或 `locale` 查询参数选择商品译文。商品列表支持关键词、分类、价格范围、卖家、排序和分页。

## 收货地址配置

- 顾客地址接口为 `/api/customer/addresses`，数据保存在 `customer_address`。迁移 `038_global_customer_address.sql` 在原中国地址字段基础上增加国家代码、E.164 电话、地址行、地区代码、标签和配送备注，并保留旧字段供历史订单和旧客户端读取。
- 国家字段顺序、英文/中文标签、必填项、正则、下拉选项和电话区号定义在 `src/data/address-countries.js`。新增国家时添加一个配置项；没有专用项的 ISO 国家代码自动使用通用字段模板。`SHIPPING_COUNTRIES` 是当前配送白名单，可按运营范围调整；下单接口会再次校验白名单。地址上限由服务端 `MAX_USER_ADDRESSES` 环境变量配置，默认 10（1–50）。
- 中国行政区静态数据：[`src/data/china-regions.json`](src/data/china-regions.json)，来源为 [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) 的 `dist/pca-code.json`（GB/T 2260 省市区数据，项目保留其上游层级码并将省、市码补齐为 6 位）。数据按需动态导入。更新时从上游获取最新版 `dist/pca-code.json` 覆盖该文件，检查东莞、中山等无区县地级市和直辖市，再运行地址配置测试。上游说明数据来源包括民政部和国家统计局；请同时检查上游许可证和更新时间。
- 中文地址粘贴识别在 `src/utils/chinaAddress.js`，使用本地区划数据匹配常见的姓名、手机号、省市区和详细地址顺序；识别失败时可以手动输入地区，也可修改所有识别字段。

```js
// src/data/address-countries.js：添加一项即可使用通用表单渲染
{ code: 'NZ', names: { en: 'New Zealand', zh: '新西兰' }, dial: '+64', fields: [person, line1, line2, city, postal, phone] }
```

## 部署注意事项

- 生产环境必须设置高熵且独立的 `JWT_SECRET` 与 `CUSTOMER_JWT_SECRET`；生产环境缺少密钥时 API 会拒绝启动。
- 配置 `PUBLIC_BASE_URL`、`CORS_ORIGIN`、`DB_PATH`、`UPLOAD_DIR`。反向代理部署时按代理层数配置 `TRUST_PROXY`。
- 运行 `npm run build` 生成前端静态文件；将 `dist/` 部署到静态服务器，并把 `/api/` 转发到 Express 服务。
- 正式上线前修改种子管理员默认密码，并备份 SQLite 数据库与上传文件。
- 不要把 `.env`、运行日志、测试数据库或本地上传数据提交到仓库。
