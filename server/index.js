import './config/env.js'
// 启动时自动执行数据库迁移，确保新环境/首次启动时 server/sql 下的迁移都会被应用
import './migrate.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import adminRouter from './routes/admin.js'
import adminsRouter from './routes/admins.js'
import adminCustomersRouter from './routes/customers.js'
import adminOrdersRouter from './routes/orders.js'
import categoriesRouter from './routes/categories.js'
import productsRouter from './routes/products.js'
import importsRouter, { startImportCleanupTask } from './routes/imports.js'
// 收支明细：仅超级管理员，挂在 /api/admin/finance（见 routes/finance.js）
import financeRouter from './routes/finance.js'
import logsRouter from './routes/logs.js'
import settingsRouter from './routes/settings.js'
import publicRouter from './routes/public.js'
// 汇率设置：后台管理挂在 /api/admin/exchange-rates，前台只读挂在 /api/public/exchange-rates
import { adminRouter as adminExchangeRatesRouter, publicRouter as publicExchangeRatesRouter } from './routes/exchangeRates.js'
// 运费设置：后台管理挂在 /api/admin/shipping-rates，前台只读挂在 /api/public/shipping-rates
import { adminRouter as adminShippingRatesRouter, publicRouter as publicShippingRatesRouter } from './routes/shippingRates.js'
// 商品评论：后台管理（/api/admin-reviews）与前台按商品读取（/api/public/products/:id/reviews）
import { adminRouter as adminReviewsRouter, publicRouter as publicReviewsRouter } from './routes/reviews.js'
import checkoutRouter from './routes/checkout.js'
// 图形验证码：一份实现挂在 /api/customer（前台）与 /api（后台）两个前缀下
import captchaRouter from './routes/captcha.js'
import customerRouter from './routes/customer.js'
import customerAddressRouter from './routes/customerAddress.js'
import customerCartRouter from './routes/customerCart.js'
import customerFavoriteRouter from './routes/customerFavorite.js'
import customerOrderRouter from './routes/customerOrder.js'
import customerReviewRouter from './routes/customerReview.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const uploadDir = resolve(process.env.UPLOAD_DIR || './uploads')

// trust proxy：生产环境挂在 Nginx 等反向代理后面时，让 req.ip 取 X-Forwarded-For 里的真实客户端 IP。
// 未设置 TRUST_PROXY 时默认不信任任何代理（false），避免把「伪造的 X-Forwarded-For」当成真实客户端 IP。
// 只有显式设置才启用：false/0 表示不信任，正整数 n 表示信任 n 层代理。
function resolveTrustProxy() {
  const raw = process.env.TRUST_PROXY
  if (raw === undefined || raw === '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Config] 未设置 TRUST_PROXY：挂在反向代理（如 Nginx）后面时请设为 1，否则登录/注册限流会退化为按代理 IP 计数。')
    }
    return false
  }
  if (raw === 'false') return false
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : false
}
app.set('trust proxy', resolveTrustProxy())

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 JWT_SECRET')
  }
  process.env.JWT_SECRET = 'development-only-change-this-jwt-secret-32chars'
  console.warn('[Config] 未设置 JWT_SECRET，正在使用仅限本地开发的临时密钥；部署前必须配置 .env.production。')
}

// 顾客端使用独立密钥，避免顾客 token 与管理端 token 互相通用
if (!process.env.CUSTOMER_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 CUSTOMER_JWT_SECRET')
  }
  process.env.CUSTOMER_JWT_SECRET = 'development-only-change-this-customer-jwt-secret-32chars'
  console.warn('[Config] 未设置 CUSTOMER_JWT_SECRET，正在使用仅限本地开发的临时密钥；部署前必须配置 .env.production。')
}

await mkdir(resolve(uploadDir, 'avatars'), { recursive: true })
await mkdir(resolve(uploadDir, 'products'), { recursive: true })
await mkdir(resolve(uploadDir, 'settings'), { recursive: true })
await mkdir(resolve(uploadDir, 'import-temp'), { recursive: true })
// helmet：安全响应头。本服务只提供 API 与 /uploads 静态文件（无 SPA 静态托管），默认配置即可
app.use(helmet())
// helmet 默认给所有响应加 Cross-Origin-Resource-Policy: same-origin，会阻止 5173 前端跨源加载
// 3001 后端的 /uploads 图片（ERR_BLOCKED_BY_RESPONSE.NotSameOrigin）。仅对 /uploads 放开为
// cross-origin，其余 API 响应保持 helmet 默认。
app.use('/uploads', (_req, res, next) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
})
// 禁止通过 HTTP 访问导入临时目录：import-temp 存放后台批量导入尚未确认的图片，
// 属于内部临时文件，不应对外暴露（返回 404，不泄漏目录是否存在）。
app.use('/uploads', (req, res, next) => {
  const path = String(req.originalUrl || '').split('?')[0]
  if (path === '/uploads/import-temp' || path.startsWith('/uploads/import-temp/')) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }
  next()
})
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }))
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadDir, { fallthrough: false, maxAge: '1d' }))
app.get('/api/health', (_req, res) => res.json({ success: true }))
app.use('/api/admin', adminRouter)
app.use('/api/admins', adminsRouter)
app.use('/api/admin-customers', adminCustomersRouter)
app.use('/api/admin-orders', adminOrdersRouter)
app.use('/api/admin-reviews', adminReviewsRouter)
app.use('/api/categories', categoriesRouter)
// 批量导入相关接口独立挂在 /api/product-imports，与 productsRouter 的 /:id 路由互不影响
app.use('/api/product-imports', importsRouter)
app.use('/api/products', productsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/admin/exchange-rates', adminExchangeRatesRouter)
app.use('/api/admin/shipping-rates', adminShippingRatesRouter)
app.use('/api/admin/finance', financeRouter)
app.use('/api/public', publicRouter)
app.use('/api/public/exchange-rates', publicExchangeRatesRouter)
app.use('/api/public/shipping-rates', publicShippingRatesRouter)
app.use('/api/public', publicReviewsRouter)
app.use('/api/public', checkoutRouter)
// 验证码签发：/api/customer/captcha（前台顾客登录）与 /api/captcha（后台管理员登录）共用同一实现
app.use('/api/customer', captchaRouter)
app.use('/api', captchaRouter)
app.use('/api/customer', customerRouter)
app.use('/api/customer/addresses', customerAddressRouter)
app.use('/api/customer/cart', customerCartRouter)
app.use('/api/customer/favorites', customerFavoriteRouter)
app.use('/api/customer/orders', customerOrderRouter)
app.use('/api/customer', customerReviewRouter)
app.use((err, _req, res, _next) => {
  console.error(err)
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: '图片大小不能超过 5MB' })
  const status = Number(err.status) || 500
  // 生产环境 5xx 一律回传笼统文案，不回传 err.message（避免泄漏内部细节）；完整错误仍记录在 console.error。
  // 4xx 保持现状，继续返回 err.message 以便前端/用户看到具体原因。
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? '服务器内部错误' : (err.message || '服务器内部错误')
  res.status(status).json({ success: false, message })
})
app.listen(port, () => {
  console.log(`[Server] API service: http://localhost:${port}`)
  startImportCleanupTask()
})
