import { Router } from 'express'
import db from '../config/db.js'
import storageService from '../services/storageService.js'

const router = Router()

const selectFields = `p.id, p.name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, p.description, p.detail, p.main_image, p.created_at`

function publicProduct(product) {
  return {
    ...product,
    price: Number(product.price),
    original_price: product.original_price === null ? null : Number(product.original_price),
    main_image_url: storageService.getUrl(product.main_image),
  }
}

// 分类列表（只返回启用的）
router.get('/categories', async (_req, res, next) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name, parent_id, sort_order FROM category WHERE status = 1 ORDER BY parent_id, sort_order, id'
    )
    res.json({ success: true, data: rows })
  } catch (error) {
    next(error)
  }
})

// 商品列表（分页 + 筛选）
router.get('/products', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null

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
    const where = `WHERE ${clauses.join(' AND ')}`

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM product p ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
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
    res.json({ success: true, data: settings })
  } catch (error) {
    next(error)
  }
})

export default router
