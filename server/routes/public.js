import { Router } from 'express'
import db from '../config/db.js'
import storageService from '../services/storageService.js'

const router = Router()

const selectFields = `p.id, p.name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, p.description, p.detail, p.main_image, p.sku, p.is_customizable, p.rating, p.review_count, p.created_at`

function publicProduct(product) {
  return {
    ...product,
    price: Number(product.price),
    original_price: product.original_price === null ? null : Number(product.original_price),
    main_image_url: storageService.getUrl(product.main_image),
  }
}

// 分类列表（只返回启用且有封面图的，用于首页轮播展示）
router.get('/categories', async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, name, parent_id, sort_order, image FROM category WHERE status = 1 AND image IS NOT NULL AND image != '' ORDER BY sort_order, id"
    )
    res.json({ success: true, data: rows.map(row => ({ ...row, image_url: storageService.getUrl(row.image) })) })
  } catch (error) {
    next(error)
  }
})

// 商品列表（分页 + 筛选 + 排序）
router.get('/products', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null
    const sort = String(req.query.sort || 'recommended')
    const minPrice = req.query.min_price != null && req.query.min_price !== '' ? Number(req.query.min_price) : null
    const maxPrice = req.query.max_price != null && req.query.max_price !== '' ? Number(req.query.max_price) : null

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
    const where = `WHERE ${clauses.join(' AND ')}`

    let orderClause = 'ORDER BY p.created_at DESC, p.id DESC'
    if (sort === 'popular') {
      orderClause = 'ORDER BY p.sales DESC, p.id DESC'
    } else if (sort === 'newest') {
      orderClause = 'ORDER BY p.created_at DESC, p.id DESC'
    } else if (sort === 'rating') {
      orderClause = 'ORDER BY p.sales DESC, p.id DESC'
    }

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM product p ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id ${where} ${orderClause} LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
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
    const [rows] = await db.execute(
      `SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id WHERE p.id = ? AND p.status = 1`,
      [id]
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

// 保存意向订单（无需登录）
router.post('/intent-orders', async (req, res, next) => {
  try {
    const body = req.body || {}
    const items = Array.isArray(body.items) ? body.items : null
    const totalAmount = Number(body.totalAmount)

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: '商品列表不能为空' })
    }
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return res.status(400).json({ success: false, message: '合计金额无效' })
    }

    // 校验每条商品快照
    const snapshot = items.map(item => ({
      product_id: Number(item.product_id) || null,
      name: String(item.name || '').slice(0, 200),
      price: Number(item.price) || 0,
      quantity: Math.max(1, Number(item.quantity) || 1),
      subtotal: Number(item.subtotal) || 0,
    }))

    // 生成订单编号：IO + 时间戳 + 4位随机数
    const now = Date.now()
    const random = Math.floor(1000 + Math.random() * 9000)
    const orderNo = `IO${now}${random}`

    await db.execute(
      'INSERT INTO intent_order (order_no, items, total_amount) VALUES (?, ?, ?)',
      [orderNo, JSON.stringify(snapshot), totalAmount.toFixed(2)]
    )

    res.json({ success: true, data: { order_no: orderNo } })
  } catch (error) {
    next(error)
  }
})

export default router
