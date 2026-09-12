import './config/env.js'
// 启动时自动执行数据库迁移，确保新环境/首次启动时 server/sql 下的迁移都会被应用
import './migrate.js'
import express from 'express'
import cors from 'cors'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import adminRouter from './routes/admin.js'
import adminsRouter from './routes/admins.js'
import adminCustomersRouter from './routes/customers.js'
import adminOrdersRouter from './routes/orders.js'
import categoriesRouter from './routes/categories.js'
import productsRouter from './routes/products.js'
import importsRouter, { startImportCleanupTask } from './routes/imports.js'
import logsRouter from './routes/logs.js'
import settingsRouter from './routes/settings.js'
import publicRouter from './routes/public.js'
import checkoutRouter from './routes/checkout.js'
import customerRouter from './routes/customer.js'
import customerAddressRouter from './routes/customerAddress.js'
import customerCartRouter from './routes/customerCart.js'
import customerFavoriteRouter from './routes/customerFavorite.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const uploadDir = resolve(process.env.UPLOAD_DIR || './uploads')

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
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }))
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadDir, { fallthrough: false, maxAge: '1d' }))
app.get('/api/health', (_req, res) => res.json({ success: true }))
app.use('/api/admin', adminRouter)
app.use('/api/admins', adminsRouter)
app.use('/api/admin-customers', adminCustomersRouter)
app.use('/api/admin-orders', adminOrdersRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/products', productsRouter)
app.use('/api/products', importsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/public', publicRouter)
app.use('/api/public', checkoutRouter)
app.use('/api/customer', customerRouter)
app.use('/api/customer/addresses', customerAddressRouter)
app.use('/api/customer/cart', customerCartRouter)
app.use('/api/customer/favorites', customerFavoriteRouter)
app.use((err, _req, res, _next) => {
  console.error(err)
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: '图片大小不能超过 5MB' })
  res.status(err.status || 500).json({ success: false, message: err.message || '服务器内部错误' })
})
app.listen(port, () => {
  console.log(`[Server] API service: http://localhost:${port}`)
  startImportCleanupTask()
})
