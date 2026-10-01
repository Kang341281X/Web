# Craftora 购物网站 — 项目文档

> 仓库：`https://github.com/Kang341281X/Web`（package.json 中项目名：`craftora-marketplace-demo`）
> 文档生成时间：2026-09-26　审查人：Claude
> 本文档基于对源码的实际克隆、依赖安装、数据库迁移、服务启动、前端构建、自动化测试全流程验证撰写，并非仅凭静态阅读代码得出结论。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [功能清单](#4-功能清单)
5. [数据库设计](#5-数据库设计)
6. [API 接口一览](#6-api-接口一览)
7. [本地开发环境搭建](#7-本地开发环境搭建)
8. [本次验证过程与结果](#8-本次验证过程与结果)
9. [代码质量评估](#9-代码质量评估)
10. [Etsy 风格专项对照评审](#10-etsy-风格专项对照评审)
11. [问题清单与修复建议汇总](#11-问题清单与修复建议汇总)
12. [附录 A：可直接用于 Claude Code 的修复提示词](#附录-a可直接用于-claude-code-的修复提示词)
13. [附录 B：部署要点速查](#附录-b部署要点速查)
14. [已知的产品级限制（非 bug，设计如此）](#14-已知的产品级限制非-bug设计如此)

---

## 1. 项目概述

这是一个仿 **Etsy**（手工艺 / 原创设计电商平台）视觉风格的购物网站项目，前台品牌名为 **Craftora**（"手作灵感集市"），包含：

- **顾客端**：首页、商品列表/分类/搜索、商品详情、购物车、结算（含下单与导出结算清单两条路径）、收藏、账户中心、收货地址管理、我的订单、商品评价。
- **后台管理端**：商品/分类/图片管理、商品批量导入、订单管理、顾客管理、评论管理、收支明细（财务）、系统设置（汇率/运费/联系方式/社交媒体二维码）、操作日志、管理员账号管理（含超级管理员分权）。
- **技术形态**：Vue 3 + Express + SQLite 的前后端分离单体应用，**没有集成任何在线支付**，走"顾客提交订单 → 后台人工确认发货"的轻量交易模式，这是产品设计上的明确选择（README 与代码注释中均有说明），不是遗漏。

项目定位准确地说是 **"单店铺、多语言、仿 Etsy 视觉风格的电商 + 后台管理系统"**，而不是 Etsy 那种"多商户入驻"的市场型平台——这一点会在第 10、14 节详细展开，直接关系到"店铺/卖家"相关功能应该如何理解。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | Vue 3（`<script setup>` 组合式 API）+ Vite |
| 前端路由/状态 | vue-router 4、Pinia |
| UI 组件库 | Element Plus（部分使用，另有大量自定义组件） |
| 图表 | ECharts（仅后台仪表盘/财务页，路由级懒加载） |
| 图片裁剪 | Cropperjs（头像/分类图裁剪） |
| 后端框架 | Express 5 |
| 数据库 | SQLite（better-sqlite3，同步驱动，无需额外部署数据库服务） |
| 鉴权 | JWT（管理员与顾客使用**两套独立密钥**，互不通用） |
| 安全 | helmet、express-rate-limit（登录/注册限流）、bcryptjs（密码哈希）、自托管 svg-captcha（图形验证码，不依赖任何外部服务） |
| 文件处理 | multer（上传）、exceljs / xlsx（Excel 导入导出）、adm-zip（批量图片导入解压） |
| 测试 | Playwright（本项目中仅用于**接口级** HTTP 测试，未驱动浏览器） |

---

## 3. 目录结构

```
Web/
├─ index.html                 # Vite 入口 HTML
├─ src/
│  ├─ main.js                 # 应用入口，注册 Element Plus / Pinia / Router
│  ├─ App.vue
│  ├─ router/index.js         # 路由表 + 登录态守卫 + 进度条
│  ├─ stores/                 # Pinia：cart / customer / user / favorites / language / address / customerOrder ...
│  ├─ services/                # axios 封装：publicApi / customerApi / customerReviews / ...
│  ├─ views/                  # 顾客端页面（Home / Products / ProductDetail / Cart / Account / Orders ...）
│  │  └─ admin/                # 后台管理页面（AdminProducts / AdminOrders / AdminFinance ...）
│  ├─ components/
│  │  ├─ header/ footer/       # 头部（含搜索、语言切换、账户菜单）、页脚
│  │  ├─ product/               # 商品卡片、图集、筛选面板、评价组件等
│  │  ├─ category/              # 分类卡片/轮播（⚠️ 见第 11 节，当前未被引用）
│  │  ├─ address/               # 收货地址表单与管理
│  │  ├─ common/                # 登录弹窗、结算弹窗、图片组件、回到顶部等
│  │  └─ admin/                 # 后台专用：图片裁剪弹窗、商品导入向导、在线建品弹窗
│  ├─ data/translations.js     # 5 语言 UI 文案 + 商品演示翻译（⚠️ 见第 11 节，覆盖范围有限）
│  ├─ styles/main.css          # 前台全局样式（Etsy 风格设计系统）
│  └─ styles/admin.css         # 后台全局样式（标准后台管理系统风格，含 Element Plus 主题覆盖）
├─ server/
│  ├─ index.js                 # Express 入口，中间件与路由挂载
│  ├─ migrate.js / seed.js      # 数据库迁移 / 种子账号
│  ├─ config/                   # 数据库连接封装、环境变量加载
│  ├─ middleware/                # 管理员鉴权、顾客鉴权、限流
│  ├─ routes/                    # 按业务模块拆分的路由（20 个文件）
│  ├─ utils/                     # 订单状态机、订单号生成、评价重算等业务逻辑
│  ├─ services/                  # 验证码服务、文件存储服务
│  ├─ scripts/                   # 演示数据生成脚本（400 商品 / 100 顾客 + 500 订单 + 1000 评论）
│  └─ sql/                       # 35 个迁移 SQL 文件（编号递增，不可回退修改历史文件）
├─ shared/productRules.js       # 前后端共用的商品校验规则
├─ tests/                        # Playwright 接口测试（30 条用例）
└─ playwright.config.js          # 测试专用端口/数据库/密钥配置
```

---

## 4. 功能清单

### 4.1 顾客端

| 模块 | 功能点 | 状态 |
|---|---|---|
| 浏览 | 首页（Hero + 分类入口 + 分类聚合的推荐区块 + 分页）、商品列表、分类页、搜索（含搜索建议与本地搜索历史） | ✅ 可用 |
| 商品详情 | 图集轮播、价格/折扣、库存、数量选择、加入购物车、收藏、预估运费、Tab 切换（描述/规格/物流/评价）、相关商品 | ✅ 可用（风格与交互细节见第 10 节） |
| 购物车 | 增删改数量、清空（二次确认）、金额与运费小计 | ✅ 可用 |
| 结算 | 选择收货地址、买家备注、提交订单（人工确认发货）、下载结算清单 Excel（需登录加购） | ✅ 可用 |
| 收藏 | 收藏/取消收藏、收藏列表页 | ✅ 可用 |
| 账户 | 注册（用户名+手机号+密码）、登录（用户名+密码+图形验证码）、个人资料/头像、改密 | ✅ 可用 |
| 收货地址 | 增删改、设默认 | ✅ 可用 |
| 我的订单 | 列表（按状态筛选）、详情、取消订单（回补库存） | ✅ 可用 |
| 商品评价 | 已完成订单方可评价、发布/24 小时内可改/随时可删、评分分布、评价配图 | ✅ 可用，实现质量高 |
| 多语言 | 简体中文 / 繁体中文 / English / 日本語 / 한국어，UI 文案全覆盖 | ⚠️ **商品自身标题/描述的多语言仅覆盖演示数据前 20 条**，见第 11 节 |
| 多币种展示 | 按语言对应汇率换算展示价格（下单金额仍以人民币为准） | ✅ 可用 |

### 4.2 后台管理端

| 模块 | 功能点 | 状态 |
|---|---|---|
| 商品管理 | CRUD、多图管理与排序、批量删除、Excel 导入（预览/确认/生成 SKU/建分类）、Excel 导出 | ✅ 可用，功能非常完整 |
| 分类管理 | CRUD、封面图上传 | ✅ 可用 |
| 订单管理 | 列表/筛选/详情、改状态（人工发货）、Excel 导出 | ✅ 可用 |
| 顾客管理 | 列表/搜索（用户名/手机号/邮箱）、详情、启用/禁用 | ✅ 可用 |
| 评论管理 | 列表、隐藏/显示、删除 | ✅ 可用 |
| 财务（仅超管） | 收入自动聚合、支出手工登记、按日/月统计、导出 | ✅ 可用 |
| 系统设置 | 站点联系方式、社交媒体二维码、汇率（5 语言）、运费（5 区域） | ✅ 可用 |
| 操作日志 | 按关键词/模块/时间筛选 | ✅ 可用 |
| 管理员管理（仅超管） | 增删改、重置密码、角色分权 | ✅ 可用 |
| 登录安全 | 图形验证码 + 登录/注册限流 + 首次登录强制改密 | ✅ 可用，设计得比较严谨 |

**结论**：功能覆盖面非常完整，是一个可以真实运营的轻量电商后台，不存在"半成品"页面或按钮点了没反应的情况（详见第 8、9 节验证过程）。

---

## 5. 数据库设计

SQLite，共 **20 张业务表**（不含内部的 `schema_migrations`）：

| 表名 | 用途 |
|---|---|
| `admin` | 后台管理员账号 |
| `category` | 商品分类（支持父子级） |
| `product` | 商品主表 |
| `product_image` | 商品图集 |
| `product_review` | 商品评价 |
| `customer` | 顾客账号（手机号为内部主键，用户名为登录凭证） |
| `customer_address` | 顾客收货地址 |
| `customer_favorite` | 顾客收藏 |
| `customer_order` | 顾客订单（快照收货信息与账号信息） |
| `order_item` | 订单明细 |
| `cart_item` | 服务端购物车（登录用户） |
| `exchange_rate` | 5 语言展示汇率 |
| `shipping_rate` | 5 区域运费 |
| `finance_expense` | 后台手工登记的支出 |
| `import_batch` | 商品批量导入的批次记录 |
| `intent_order` | 意向单（**已废弃**，仅历史兼容保留） |
| `operation_log` | 后台操作日志 |
| `site_setting` | 站点设置（联系方式等） |
| `social_media` | 社交媒体二维码 |
| `schema_migrations` | 迁移版本记录 |

**设计上值得注意的点**：

- `product` 表 `name`/`description`/`detail` 均为**单一语言**字段，没有多语言列或关联的翻译表（见第 11 节的多语言缺陷）。
- `customer` 用手机号做内部唯一标识/外键锚点，用户名只是登录凭证且**注册后不可改**，历史账号由迁移自动回填 `username = phone`。
- 运费与汇率都是**展示层**换算，下单金额与库存扣减始终以人民币 + 服务端重新计算的运费为准，前端传的展示值只做一致性校验（不一致返回 409，防止后台调价后旧页面按老价格下单）。
- 订单状态机：`pending → confirmed → shipped → completed`，以及可从 `pending`/`confirmed` 转到 `cancelled`；`shipped`/`completed`/`cancelled` 为终态。取消订单只回补库存、不回滚销量。

---

## 6. API 接口一览

统一前缀 `/api`，响应体统一为 `{ success, data, message?, pagination? }`。三套鉴权互不通用：

- **管理员 token**：`/api/admin`、`/api/admins`（超管）、`/api/admin-*`、`/api/products`、`/api/categories`、`/api/settings`、`/api/logs`
- **顾客 token**：`/api/customer/*`
- **公开**：`/api/public/*`、`/api/captcha`、`/api/customer/captcha`、`/api/health`

### 6.1 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/public/categories` | 首页轮播用分类（需有封面图且启用） |
| GET | `/api/public/products` | 商品列表：`keyword`/`category_id`/`min_price`/`max_price`/`sort`+分页 |
| GET | `/api/public/products/:id` | 商品详情（含图集） |
| GET | `/api/public/products/:id/reviews` | 买家评价 + 评分概览 |
| GET | `/api/public/settings` | 站点设置 + 社交媒体二维码 |
| GET | `/api/public/exchange-rates` / `shipping-rates` | 汇率 / 运费（各 5 条） |
| GET | `/api/customer/captcha` / `/api/captcha` | 顾客端 / 后台登录验证码（同一实现挂两次） |
| POST | `/api/public/checkout/export` | 导出结算清单 Excel（需登录加购，限流 20 次/分钟） |

### 6.2 顾客接口（需 `Authorization: Bearer <customer_token>`，注册/登录除外）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/customer/register` | 用户名+手机号+密码，均需唯一 |
| POST | `/api/customer/login` | 用户名+密码+验证码 |
| GET/PUT | `/api/customer/profile` | 个人资料（PUT 为 multipart，可改头像） |
| PUT | `/api/customer/password` | 改密 |
| 地址 | `/api/customer/addresses` 系列 | 增删改、设默认 |
| 购物车 | `/api/customer/cart` 系列 | 增删改（需登录，登录后从服务端拉取，无游客购物车） |
| 收藏 | `/api/customer/favorites` 系列 | 增删（需登录，登录后从服务端拉取，无游客收藏） |
| 订单 | `/api/customer/orders` 系列 | 下单、列表、详情、取消 |
| 评价 | `/api/customer/products/:id/reviews`、`/api/customer/reviews/:id` | 发布/改/删 |

### 6.3 后台接口（需管理员 token）

| 模块 | 关键路径 |
|---|---|
| 登录/当前账号 | `POST /api/admin/login`、`GET/PUT /api/admin/profile` |
| 管理员管理（超管） | `/api/admins` 系列 |
| 商品 | `/api/products` 系列（含图片、导出）、`/api/product-imports` 系列（批量导入全流程） |
| 分类 | `/api/categories` 系列 |
| 顾客 | `/api/admin-customers` 系列 |
| 订单 | `/api/admin-orders` 系列 |
| 评论 | `/api/admin-reviews` 系列 |
| 财务（超管） | `/api/admin/finance/*` |
| 设置 | `/api/settings`、`/api/settings/socials` |
| 汇率/运费 | `/api/admin/exchange-rates`、`/api/admin/shipping-rates` |
| 日志 | `GET /api/logs` |

> 完整字段级说明（请求体、返回码语义等）请参考仓库 `README.md`，写得非常详细，本文档不重复搬运，只做结构化归类。

---

## 7. 本地开发环境搭建

```bash
# 0. 前置：Node.js 18/20 LTS（better-sqlite3 是原生模块，版本差太多可能装不上）
git clone https://github.com/Kang341281X/Web.git
cd Web
npm install

# 1. 环境变量
cp .env.development.example .env.development
# 修改 JWT_SECRET / CUSTOMER_JWT_SECRET 为任意 32 位以上随机字符串

# 2. 数据库
npm run db:migrate
npm run db:seed          # 生成 superadmin/admin/admin01/admin02，密码均为 123456，首次登录强制改密
npm run seed:products    # 可选：400 条商品假数据
npm run seed:dev         # 可选：100 位顾客 + 500 订单 + 1000 评论

# 3. 启动（两个终端）
npm run server   # 后端 http://localhost:3001
npm run dev      # 前端 http://localhost:5173
```

> ⚠️ **沙盒环境提示**：如果在无法访问 `nodejs.org` 的环境中安装依赖，`better-sqlite3` 的 `node-gyp rebuild` 会因下载不到 Node 头文件而失败。正常开发机（能访问外网）不会遇到这个问题；万一遇到，可用 `npm install --nodedir=<本机 Node 头文件目录>` 绕过。这不是项目本身的缺陷。

---

## 8. 本次验证过程与结果

为了准确回答"功能是否完整可行、测试是否都能通过"，本次审查**没有只读代码**，而是完整跑了一遍：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 克隆仓库 | `git clone` | ✅ 成功 |
| 安装依赖 | `npm install` | ✅ 成功（351 个包） |
| 数据库迁移 | `npm run db:migrate` | ✅ 35 个迁移文件全部 `Applied`，无报错 |
| 种子账号 | `npm run db:seed` | ✅ 成功创建 4 个管理员账号 |
| 启动后端 | `npm run server` | ✅ `/api/health` 返回 `{"success":true}` |
| 前端构建 | `npm run build` | ✅ 构建成功，仅有 1 条关于 `echarts` 分包体积较大的常规提示，**无报错** |
| 自动化测试 | `npm test`（Playwright，30 条用例） | ✅ **30/30 全部通过**，耗时约 23 秒 |

测试用例覆盖范围（节选自实际运行输出）：

```
✓ 顾客登录 › 验证码错误 → 400（不进入账号密码校验）
✓ 顾客登录 › 账号密码错误 → 401
✓ 顾客登录 › 不存在的用户名 → 401（不泄漏账号是否存在）
✓ 越权隔离 › 顾客 token 不能访问后台接口（401）
✓ 越权隔离 › 顾客 A 不能查看顾客 B 的订单（404，不泄漏订单存在性）
✓ 越权隔离 › 普通 admin 不能访问财务、管理员管理等仅超管接口（403）
✓ 图形验证码一次性机制 › 同一个 captchaId 用两次，第二次必须失败
✓ 结算清单导出防护 › 超过条目上限/空 items/限流场景
✓ 订单取消 › 库存回补 + 重复取消幂等；已发货订单不可取消
✓ 完整下单流程 › 加购 → 运费不一致拒绝(409) → 正常下单 → 库存扣减 → 购物车清空
✓ 订单号生成 › 格式、唯一性、并发冲突判定
✓ 商品库存丢失更新修复 › 编辑商品不覆盖库存、PATCH 增量接口原子生效
✓ 顾客注册唯一性冲突 › 用户名/手机号重复场景
✓ 评价权限与 24 小时窗口 › 无完成订单不能评价、超时只能删、不能改删别人的评价
```

**结论**：后端核心业务逻辑（鉴权、越权隔离、下单、库存、订单状态机、评价权限窗口、验证码防爆破）都有对应测试且全部通过，工程质量扎实。

**但要指出一个覆盖面上的局限**：这 30 条测试全部是**接口级 HTTP 测试**（`playwright.config.js` 里两个 `webServer` 只是把前后端都拉起来，测试本身不驱动浏览器）。也就是说：

- 前端组件的渲染逻辑、交互行为（比如本文档重点讨论的详情页图集、Tab 切换等）**没有任何自动化测试覆盖**；
- 没有端到端（E2E）浏览器测试验证"用户在浏览器里点几下能不能完成下单"这类真实路径。

这不是"测试没通过"，而是"测试范围目前只到接口层"，如果后续要加固，建议补充关键路径的 E2E 测试（详见第 11 节）。

---

## 9. 代码质量评估

整体评价：**质量在同类项目中偏上**，具体体现在：

- **无遗留半成品标记**：全仓库搜索 `TODO/FIXME/XXX/待实现/未完成` 等关键词，没有发现真正遗留的未完工代码，仅有的几处匹配都是正常的业务说明性注释或字段命名。
- **注释详尽且解释"为什么"而非只说"是什么"**：大量注释在解释设计决策的原因（例如为什么验证码要一次性作废、为什么运费要在服务端重算、为什么取消订单只回补库存不回滚销量），这对后续维护和交接非常友好。
- **前后端共用校验规则**：`shared/productRules.js` 被前后端同时引用，避免规则两边写岔。
- **安全细节到位**：验证码校验顺序（先验证码后查库，防止用响应时间探测账号是否存在）、越权隔离测试、限流分级（登录/注册不同阈值）、生产环境强制要求 JWT 密钥不能为空。
- **多语言 i18n 采用安全的展开兜底模式**（`en`/`ja`/`ko` 都用 `{ ...zh, 覆盖若干字段 }` 的方式），不会出现翻译缺失导致渲染空白或 `undefined` 的情况——**但这套机制只覆盖 UI 文案，不覆盖商品数据本身**，见第 11 节。

代码质量上没有发现的问题：

- 没有发现明显的安全漏洞（如 SQL 拼接注入、越权访问）。
- 没有发现"点击无反应"的死按钮。
- 没有发现路由指向不存在组件的情况。

---

## 10. Etsy 风格专项对照评审

这是本次审查按你的要求重点检查的部分，尤其是商品详情页。评审方法：通读 `src/styles/main.css`（全局设计系统）、`ProductDetail.vue`、`ProductGallery.vue`、`ProductCard.vue`、`Home.vue`、`Header.vue`、`ProductReviews.vue`、`CheckoutDialog.vue` 等文件，并与 Etsy.com 真实的首页与商品详情页交互模式逐项比对。

### 10.1 已经做得好、与 Etsy 高度一致的地方

| 项目 | 说明 |
|---|---|
| 品牌色 | `--clay: #F1641E` **就是 Etsy 官方品牌橙色**，说明作者是刻意对标设计，不是巧合 |
| 搜索框 | 胶囊形状（`border-radius: 96px`）+ 聚焦态描边，与 Etsy 搜索框视觉一致 |
| 主按钮 | 黑色底、胶囊圆角（`.button.primary`），与 Etsy 的"加入购物车"按钮风格一致 |
| 商品卡片 | 正方形图片、左上角折扣/新品角标、右上角收藏爱心、店铺名在标题上方、星级+评价数、原价划线，结构与 Etsy 商品卡完全对应 |
| 评价区 | 平均分 + 评分分布条 + "已购买"徽章 + 头像圆圈 + 评价配图 + "查看全部评价"展开，是本项目里**实现质量最高、与 Etsy 最贴近**的模块 |
| 品牌定位文案 | "手作灵感集市"、"由独立创作者用心制作"等文案精准复刻了 Etsy 的"手工艺/独立创作者"调性，不是通用电商模板文案 |
| 自定义下拉/筛选控件 | `PanelSelect.vue` 等专门做了自定义组件替代 Element Plus 原生 select，说明开发者已经意识到要避免组件库默认样式破坏整体设计语言 |

### 10.2 与 Etsy 有明显差距的地方

| # | 项目 | 现状 | Etsy 实际做法 | 影响 |
|---|---|---|---|---|
| 1 | **前台 Element Plus 主题色** | `main.css` 未覆盖 `--el-color-primary`，仅 `admin.css` 覆盖且限定后台作用域 | 全站不存在蓝色元素 | 结算弹窗"提交订单"主按钮、首页/列表页分页控件显示 Element Plus 默认蓝色 `#409eff`，与全站黑/橙配色**直接冲突**，是最扎眼的一处不一致，且出现在下单这个最关键的转化节点上 |
| 2 | **商品详情图集交互** | 主图 + 下方横向缩略图 + 5 秒自动轮播 | 桌面端左侧竖排缩略图（不自动播放）+ 悬停放大镜局部放大 | 自动轮播对正在细看商品图的用户是负体验；没有放大镜看不清材质细节，这对"手工艺品"类目尤其重要（材质、做工是购买决策关键因素） |
| 3 | **商品详情页信息组织** | 描述/规格/物流/评价放在 Tab 里，默认只显示"商品介绍"，评价需要点击才可见 | 单页连续滚动，评价默认在页面内可见 | 评价是建立信任、促成转化的关键内容，藏在 Tab 后面等于主动降低了它的曝光 |
| 4 | **首页分类入口** | 纯文字胶囊按钮（`Home.vue` 内联的 `etsy-category-row`） | 圆形/竖版商品分类图片 | 已经有一个实现更接近 Etsy 效果的 `CategoryCarousel.vue` 组件，但**没有被任何页面引用**，等于白做了 |
| 5 | **店铺/卖家信息** | 头像是取店铺名首字母生成的色块圆圈；点击"店铺名"固定跳转到 `/products`（全部商品），并未按该卖家筛选 | 显示真实店铺头像图片；点击进入该店铺的专属主页，只显示该店铺商品 | 会让用户误以为点进去能看到"这个店铺的其他作品"，实际看到的是无关的全量商品列表，属于误导性交互（详见第 11 节，根源是架构上本来就是单店铺系统） |
| 6 | Logo 配色 | "✦craftora" 中的 ✦ 符号被着色为品牌橙 | Etsy 当前实际 wordmark 是纯色黑字，不给字母/符号单独上色 | 影响很小，是否调整看个人取舍 |

### 10.3 关于 el-rate 与其他小组件

`ProductReviews.vue` 里写评价用的 `el-rate` 星级选择器颜色是 Element Plus 默认的 `#F7BA2A`（橙黄色），与 `--clay: #F1641E` 很接近但不完全一致，属于低优先级的小瑕疵，可以在做第 10.2 第 1 条修复时顺手统一。

---

## 11. 问题清单与修复建议汇总

按优先级排列（P0 = 建议优先处理，P2 = 锦上添花）：

| 优先级 | 类型 | 问题 | 对应修复提示词 |
|---|---|---|---|
| P0 | 功能完整性 | 商品标题/描述的多语言翻译只覆盖演示数据 id 1-20，数据库表本身无多语言字段；**默认数据库里 id 21-40（一半商品）切到英/日/韩语言后仍显示中文原文**，已用真实数据验证 | 提示词 1 |
| P0 | 视觉一致性 | 前台 Element Plus 组件（结算弹窗提交按钮、分页控件）未套用站点主题色，仍是默认蓝色，与 Etsy 风格设计系统冲突，且出现在下单核心路径上 | 提示词 2 |
| P1 | Etsy 风格 | 已完整实现的 `CategoryCarousel.vue` 分类轮播组件未被任何页面引用，首页分类入口退化为纯文字胶囊 | 提示词 3 |
| P1 | Etsy 风格 | 商品详情图集为"自动轮播+下方横排缩略图"，应改为"静态左侧竖排缩略图+悬停放大镜"，更符合 Etsy 与一般电商详情页习惯 | 提示词 4 |
| P1 | Etsy 风格（可选） | 商品详情页用 Tab 分区隐藏评价内容，建议改为单页连续滚动、评价默认可见 | 提示词 5 |
| P2 | 功能/交互 | "访问店铺"链接实际固定跳转全部商品页，未按卖家筛选，存在误导性 | 提示词 6 |
| P2 | 测试覆盖 | 现有 30 条自动化测试均为后端接口级测试，前端组件/交互、端到端浏览器路径无任何自动化覆盖 | 见下方说明 |
| P2 | 代码整洁度 | `CategoryCard.vue` 完整实现但无任何引用，属于死代码 | 提示词 3 已包含处理建议 |

### 关于"补充 E2E 测试"的建议（未单独写提示词，供你判断是否需要）

如果希望进一步加固测试覆盖，可以让 Claude Code 基于现有 `@playwright/test` 依赖新增一组真正驱动浏览器的 E2E 测试（新建 `tests/e2e/` 目录，与现有接口测试区分），至少覆盖：游客浏览商品 → 加购 → 登录 → 提交订单的完整链路，以及后台管理员登录 → 新建商品 → 前台可见的链路。这类测试需要下载 Chromium（`npx playwright install chromium`），在你本地或 CI 环境执行不会有问题；本次审查所在的沙盒环境因网络限制无法下载 Chromium，因此没有替你先跑通，需要你在自己的环境里跑一遍确认。

---

## 附录 A：可直接用于 Claude Code 的修复提示词

> 以下提示词已在对话中给出，这里完整归档一份，方便你直接从文档复制使用。逐条粘给 Claude Code 独立执行，不要一次性全部粘贴，避免改动范围过大难以 review。

### 提示词 1（P0）多语言商品文案

```
项目背景：src/data/translations.js 里 productTitle()/productDescription() 对英语/日语/韩语的翻译，
依赖一个写死的 20 条 englishTitles 数组，product 数据库表（server/sql/002_catalog.sql）本身只有
单一语言的 name/description/detail 字段。结果是 id > 20 的商品（默认数据库里 id 21-40，以及所有
后台新建/导入的商品）切换到非中文语言时，仍然显示原始中文标题和描述，破坏了多语言体验。

请你：
1. 在 product 表新增多语言字段（建议方案：新增 product_translation 表，
   字段 product_id / locale / name / description / detail，联合唯一键 (product_id, locale)，
   通过新的 server/sql/036_xxx.sql 迁移文件创建，不要直接改 002_catalog.sql）。
2. 后台商品编辑表单（src/views/admin/AdminProducts.vue）为「商品名称」「简要描述」「商品详情」
   增加多语言 Tab（zh-CN / zh-TW / en / ja / ko），未填写时的语言回退到 zh-CN 原文，不强制必填。
3. 后端 GET /api/public/products 和 GET /api/public/products/:id 支持按当前语言返回对应译文，
   查询参数或请求头里没有对应语言的翻译时同样回退到 zh-CN。
4. 前端 productTitle()/productDescription() 改为直接使用接口返回的当前语言字段，
   移除写死的 20 条 englishTitles 数组（zh-TW 的处理逻辑可以保留 fallback 到 zh-CN 原文的行为，
   除非你也想让后台支持繁体字段）。
5. 补充/更新 tests/ 下的接口测试，覆盖「有译文时返回译文」「无译文时回退原文」两种情况。
6. 运行 npm run db:migrate && npm test 确认全部通过。
```

### 提示词 2（P0）统一 Element Plus 主题色，修掉蓝色按钮

```
项目背景：src/styles/main.css 是前台自定义的 Etsy 风格设计系统（--ink 黑色文字、--clay:#F1641E
橙色强调色、黑色主按钮、胶囊形状控件），但从未覆盖 Element Plus 的 --el-color-primary 系列变量
（该覆盖目前只存在于 src/styles/admin.css，且限定在 .admin-layout 作用域下，只影响后台）。
这导致前台顾客可见的 Element Plus 组件仍是默认蓝色 #409eff，与全站视觉严重不一致，
尤其是 src/components/common/CheckoutDialog.vue 里的「提交订单」主按钮（el-button type="primary"）
和 el-dialog / el-alert / el-table，以及 Home.vue / Products.vue / Category.vue / Search.vue
里的 el-pagination。

请你：
1. 在 src/styles/main.css（或新建一个 src/styles/element-theme.css 并在 main.js 里引入）中，
   针对前台作用域覆盖以下变量，使其与 --ink / --clay 保持一致：
   --el-color-primary、--el-color-primary-light-3/5/7/8/9、--el-color-primary-dark-2、
   以及 el-pagination 的 hover/active 态、el-button--primary 的背景色。
   注意：不要影响 .admin-layout 下已有的蓝色后台主题，做好选择器隔离（例如用一个顶层
   .storefront 容器类包裹 App.vue 里前台部分，或反向限定 admin.css 优先级更高）。
2. CheckoutDialog.vue 里的「提交订单」按钮改为使用全站的 .button.primary 黑色按钮样式
   （或者保留 el-button 但样式上与之视觉一致），而不是 Element Plus 默认蓝色。
3. el-pagination 当前页高亮色、hover 色改为 --clay 或 --ink，与全站强调色呼应。
4. 检查 ProductReviews.vue 里的 el-rate 星星颜色是否需要一并统一为 --clay（#F1641E）。
5. 完成后跑一遍前台几个关键页面（首页、商品列表、购物车结算弹窗、商品详情写评价）目测确认
   没有残留的默认蓝色控件，并跑 npm run build 确认无报错。
```

### 提示词 3（P1）接入已有的分类轮播组件

```
项目背景：src/components/category/CategoryCarousel.vue 是一个已经完整实现的分类图片轮播组件
（自动横向滚动、无缝循环、支持少于 5 个分类时静态展示），但目前没有被任何页面引用；
src/views/Home.vue 目前用的是内联的纯文字胶囊按钮（class="etsy-category-row"）展示分类入口，
视觉上比 Etsy 首页「Shop by Category」的图片化分类区弱很多。
另外 src/components/category/CategoryCard.vue 同样没有被引用，是死代码。

请你：
1. 确认 CategoryCarousel.vue 依赖的 category.image_url 字段后台是否已支持上传
   （参考 src/views/admin/AdminCategories.vue），如果分类还没有图片，给出后台补充上传入口的方案。
2. 在 Home.vue 中用 CategoryCarousel 替换或补充现有的 etsy-category-row 胶囊列表
   （保留胶囊列表也可以，但建议把 CategoryCarousel 放在更醒目的位置，比如 Hero 之后第一屏）。
3. 如果确认 CategoryCard.vue 在产品上不再需要，删除该文件及其未使用的 CSS
   （.category-grid/.category-card 等，注意确认 main.css 里这些类没有被别处复用再删）；
   如果保留作为其他场景（比如某个分类聚合页）备用，请在文件顶部加注释说明用途和引用位置。
4. 移动端要保证 CategoryCarousel 在小屏下的卡片数量、触摸滑动体验正常。
5. npm run build 确认无报错，并手动检查首页在桌面端/移动端的展示效果。
```

### 提示词 4（P1）商品详情页图集改为静态缩略图 + 悬停放大镜

```
项目背景：src/components/product/ProductGallery.vue 目前实现为「主图 + 下方横向缩略图 +
5 秒自动轮播 + 左右箭头 + 移动端滑动」。这与 Etsy 真实商品详情页的图集交互不同：
Etsy 桌面端是「主图右侧或左侧的竖排缩略图（点击切换，不自动播放）+ 鼠标悬停在主图上出现
放大镜效果（局部放大预览）」，移动端才是横向滑动。自动轮播对精看商品图的用户体验不友好
（用户还在看图时被强制切换）。

请你重构 ProductGallery.vue：
1. 移除自动轮播逻辑（AUTOPLAY_MS 相关的 startAuto/stopAuto/timer），改为完全手动切换。
2. 桌面端（可用现有断点 760px）布局改为：缩略图竖排在主图左侧（宽度约 80-90px），
   主图占据剩余空间；移动端保留现在「主图 + 下方横向缩略图 + 手势滑动」的方案。
3. 桌面端主图增加鼠标悬停放大镜效果：鼠标移入主图时，在鼠标位置显示放大后的局部图像
   （可以用简单的 CSS transform: scale + 跟随鼠标位移实现，不需要引入第三方库；
   如果引入库，只能用 package.json 里已有的依赖或普通 CSS/JS，不要新增运行时依赖）。
4. 保留现有的无障碍支持（键盘左右切换、aria-label 等）和减弱动态效果偏好（prefers-reduced-motion）
   的处理逻辑。
5. 更新 src/styles/main.css 里 .gallery 相关的样式，移动端和桌面端都要过一遍视觉效果。
6. npm run build 确认无报错，手动检查商品详情页在桌面端和移动端下图集的展示与交互。
```

### 提示词 5（P1，可选）详情页从 Tab 切换改为连续滚动布局

```
项目背景：src/views/ProductDetail.vue 目前把「商品介绍」「商品规格」「配送信息」「买家评价」
放在一个 Tab 切换区（.detail-tabs / .tab-list），默认只显示「商品介绍」，用户需要点击才能看到评价。
Etsy 真实的商品详情页是单页连续滚动结构：描述在前（过长可折叠「查看更多」）、
接着是店铺/物流信息卡片、然后评价区（带评分分布条）默认就在页面里可见，不需要点击 Tab。
评价默认可见有利于建立信任、提升转化，也更符合真实购物网站的 SEO 习惯。

请你重构 ProductDetail.vue 的下半部分：
1. 移除 Tab 切换（activeTab 相关逻辑与 .detail-tabs/.tab-list 结构）。
2. 改为纵向依次排列的 section：商品介绍 → 商品规格 → 配送信息 → 买家评价（ProductReviews 组件），
   每个 section 用小标题（如 <h2> 或 <h3>）分隔，不需要点击展开。
3. 商品介绍文字如果较长（比如超过 4-5 行），增加「查看更多/收起」的折叠交互
   （用 CSS max-height + JS toggle 即可，不需要引入库）。
4. 原本用于「点击评分跳到评价 Tab 并滚动」的 scrollToReviews 逻辑，
   改为直接 scrollIntoView 到评价 section（因为评价不再是 Tab，行为要相应调整）。
5. 更新 main.css 里 detail-tabs/tab-list/tab-content 相关样式为新的分区布局样式。
6. 确认 npm test 中涉及 ProductDetail 交互的用例仍然通过（目前测试是接口级，不直接测这个组件，
   但请顺手确认没有引入无关回归）；跑 npm run build 确认无报错。
```

### 提示词 6（P2）店铺入口指向真实的店铺筛选，或去掉误导性交互

```
项目背景：src/views/ProductDetail.vue 中「店铺名 + 头像」的链接（class="detail-shop"）
无论商品的 seller 是什么，点击后都固定跳转到 /products（全部商品列表），并没有真正按
该商品的 seller/brand 过滤展示「这个店铺的其他商品」。seller 字段来自
src/services/publicApi.js 里 raw.brand || raw.manufacturer 的取值。

请你二选一实现：
方案 A（更贴近 Etsy 体验，工作量更大）：
  1. 在 Products.vue / 后端 GET /api/public/products 支持按 seller（brand）筛选的查询参数；
  2. detail-shop 链接改为跳转到 /products?seller=xxx 或类似路由，并在该列表页顶部显示
     「XXX 的更多作品」标题；
  3. 如果同一 seller 下商品很少（比如只有 1-2 件），给出「该店铺暂无更多作品」的空状态提示。
方案 B（工作量小，先止损）：
  1. 如果当前不打算做真正的按店铺筛选，把 detail-shop 从可点击链接改为不可点击的纯展示
     （比如去掉 RouterLink，只保留头像+名字的静态展示），避免用户点击后产生「这是店铺主页」
     的错误预期。
请说明你选择的方案和理由，实现后跑 npm run build 确认无报错。
```

---

## 附录 B：部署要点速查

（完整细节见仓库 `README.md`"上传到服务器"一节，这里只列关键动作，避免重复长篇引用）

1. 服务器装同版本 Node.js，代码上传，`npm run build` 生成 `dist/` 静态文件。
2. 复制 `.env.production.example` → `.env.production`，**必须**填写足够随机的 `JWT_SECRET` / `CUSTOMER_JWT_SECRET`（生产环境留空会直接拒绝启动），以及正确的 `PUBLIC_BASE_URL`、`CORS_ORIGIN`、`DB_PATH`、`UPLOAD_DIR`。
3. `npm run db:migrate && npm run db:seed`，**上线前务必修改种子账号的默认密码 `123456`**。
4. 用 `pm2` 或类似工具常驻后端进程（`pm2 start server/index.js --name shop-api`）。
5. Nginx（或 Caddy）做反向代理 + HTTPS，静态 `dist/` 交给 Nginx 托管，`/api/` 反代到 `127.0.0.1:3001`，并透传 `X-Forwarded-For`（否则登录/注册限流会按 IP 失效，退化成全站共用额度）。
6. 防火墙只放行 80/443/22，`3001` 不对公网开放。
7. SQLite 是单文件数据库，定期备份 `data.db` 与 `uploads/` 目录即可；未来若要换 MySQL，`server/config/db.js` 已经把查询封装成兼容 `mysql2` 风格的 `execute`/`getConnection`，替换驱动即可，业务代码基本不用改。

---

## 14. 已知的产品级限制（非 bug，设计如此）

为了避免误把"产品定位选择"当成"缺陷"去修，这里单独说明几点：

1. **不支持在线支付**：结算流程是"提交订单 → 后台人工确认 → 线下/线上其他方式收款 → 后台手动改状态发货"，代码里有明确的提示文案和注释说明这是当前阶段的既定范围，不是漏做了支付功能。
2. **不是多商户市场**：整个后台只有"管理员"角色（分超级管理员和普通管理员），所有商品由同一个后台统一管理；商品上的"店铺/卖家"信息实际借用的是商品的品牌/制造商字段，用于营造 Etsy 式的"独立创作者店铺"视觉效果，但底层不存在真正的多商户入驻、店铺独立后台、店铺结算分账等机制。如果未来产品方向真的要做成多商户市场，这将是一次架构级改造（需要新增商户账号体系、商户维度的商品归属、分账逻辑等），不是简单的前端样式调整，建议提前明确产品定位再决定是否投入。
3. **运费/汇率是展示层近似值**：本站只按顾客选择的界面语言区分展示币种/运费区域，并不采集真实收货国家，因此详情页"预计运费"是近似估算，页面上也有对应文案提示"以物流商核算为准"。
4. **忘记密码没有自助找回**：没有接入短信/邮件服务，顾客忘记用户名或密码需要联系管理员在后台处理，这是有意为之的轻量化设计（避免引入短信网关等外部依赖），不是遗漏。

---

*文档完*
