import { Router } from 'express'
import db from '../config/db.js'
import storageService from '../services/storageService.js'

const router = Router()

// 按当前语言取译文的字段列表：COALESCE 保证无译文时回退到 product 的 zh-CN 原文
const localizedSelectFields = `p.id, COALESCE(t.name, p.name) AS name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, COALESCE(t.description, p.description) AS description, COALESCE(t.detail, p.detail) AS detail, p.main_image, p.sku, p.is_customizable, p.rating, p.review_count, p.created_at`

// 把界面语言归一化为受支持的语言代码；无法识别时回退 zh-CN。
function normalizeLocale(raw) {
  if (!raw) return 'zh-CN'
  const lower = String(raw).split(',')[0].trim().replace('_', '-').toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  if (lower === 'ja' || lower.startsWith('ja-')) return 'ja'
  if (lower === 'ko' || lower.startsWith('ko-')) return 'ko'
  return 'zh-CN'
}

// 从查询参数 / 请求头解析界面语言：支持 ?locale=xx、X-Locale 请求头与 Accept-Language。
function resolveLocale(req) {
  const raw = req.query.locale || req.headers['x-locale'] || req.headers['accept-language']
  return normalizeLocale(raw)
}

function publicProduct(product) {
  return {
    ...product,
    price: Number(product.price),
    original_price: product.original_price === null ? null : Number(product.original_price),
    main_image_url: storageService.getUrl(product.main_image),
  }
}

// 分类列表（仅按启用状态过滤；无图的分类仍返回，由前端 CategoryCarousel 等统一显示占位图，避免导航 / 筛选 / 详情面包屑里「消失」）
router.get('/categories', async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, name, parent_id, sort_order, image FROM category WHERE status = 1 ORDER BY sort_order, id"
    )
    res.json({ success: true, data: rows.map(row => ({ ...row, image_url: row.image ? storageService.getUrl(row.image) : '' })) })
  } catch (error) {
    next(error)
  }
})

// 商品列表（分页 + 筛选 + 排序）
router.get('/products', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 60)
    const keyword = String(req.query.keyword || '').trim()
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null
    const sort = String(req.query.sort || 'recommended')
    const minPrice = req.query.min_price != null && req.query.min_price !== '' ? Number(req.query.min_price) : null
    const maxPrice = req.query.max_price != null && req.query.max_price !== '' ? Number(req.query.max_price) : null
    const seller = String(req.query.seller || '').trim()

    const clauses = ['p.status = 1']
    const params = []
    if (keyword) {
      clauses.push('(p.name LIKE ? OR p.manufacturer LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)')
      const like = `%${keyword}%`
      params.push(like, like, like, like)
    }
    if (categoryId && Number.isFinite(categoryId)) {
      clauses.push('p.category_id = ?')
      params.push(categoryId)
    }
    if (minPrice != null && Number.isFinite(minPrice)) {
      clauses.push('p.price >= ?')
      params.push(minPrice)
    }
    if (maxPrice != null && Number.isFinite(maxPrice)) {
      clauses.push('p.price <= ?')
      params.push(maxPrice)
    }
    if (seller) {
      clauses.push('(p.brand = ? OR p.manufacturer = ?)')
      params.push(seller, seller)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const locale = resolveLocale(req)

    let orderClause = 'ORDER BY p.created_at DESC, p.id DESC'
    if (sort === 'popular') {
      orderClause = 'ORDER BY p.sales DESC, p.id DESC'
    } else if (sort === 'newest') {
      orderClause = 'ORDER BY p.created_at DESC, p.id DESC'
    } else if (sort === 'rating') {
      orderClause = 'ORDER BY p.rating DESC, p.review_count DESC, p.id DESC'
    }

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM product p ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${localizedSelectFields} FROM product p JOIN category c ON c.id = p.category_id LEFT JOIN product_translation t ON t.product_id = p.id AND t.locale = ? ${where} ${orderClause} LIMIT ? OFFSET ?`,
      [locale, ...params, pageSize, (page - 1) * pageSize]
    )
    res.json({
      success: true,
      data: rows.map(publicProduct),
      pagination: { page, page_size: pageSize, total },
    })
  } catch (error) {
    next(error)
  }
})

// 商品详情
router.get('/products/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: '商品不存在' })
    const locale = resolveLocale(req)
    const [rows] = await db.execute(
      `SELECT ${localizedSelectFields} FROM product p JOIN category c ON c.id = p.category_id LEFT JOIN product_translation t ON t.product_id = p.id AND t.locale = ? WHERE p.id = ? AND p.status = 1`,
      [locale, id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: '商品不存在' })
    const [images] = await db.execute(
      'SELECT id, image_url, is_main, sort_order FROM product_image WHERE product_id = ? ORDER BY sort_order, id',
      [id]
    )
    const product = {
      ...publicProduct(rows[0]),
      images: images.map(image => ({
        ...image,
        image_url: storageService.getUrl(image.image_url),
      })),
    }
    res.json({ success: true, data: product })
  } catch (error) {
    next(error)
  }
})

// 站点设置
router.get('/settings', async (_req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT setting_key, setting_value FROM site_setting ORDER BY id')
    const settings = {}
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value
    }
    // 社交媒体：名称可配置、可新增，仅返回已上传二维码的平台
    const [socials] = await db.execute(
      "SELECT id, name, image FROM social_media WHERE image IS NOT NULL AND image != '' ORDER BY sort_order, id"
    )
    settings.social_media = socials.map(social => ({ id: social.id, name: social.name, image_url: storageService.getUrl(social.image) }))
    res.json({ success: true, data: settings })
  } catch (error) {
    next(error)
  }
})

export default router
