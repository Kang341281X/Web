import { Router } from 'express'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import { PRODUCT_FIELDS, publicProduct, parseProductId, findProduct } from '../utils/customerShop.js'

const router = Router()

// 收藏全部接口都要求已登录顾客，customer_id 一律取自 token
router.use(requireCustomerAuth)

const FAVORITE_FIELDS = `f.id AS favorite_id, f.created_at, ${PRODUCT_FIELDS}`

// 收藏列表：联表返回商品基本信息，前端可直接渲染成商品卡片
async function listFavorites(customerId, connection = db) {
  const [rows] = await connection.execute(
    `SELECT ${FAVORITE_FIELDS} FROM customer_favorite f JOIN product p ON p.id = f.product_id JOIN category c ON c.id = p.category_id WHERE f.customer_id = ? ORDER BY f.created_at DESC, f.id DESC`,
    [customerId]
  )
  return rows.map(publicProduct)
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listFavorites(req.customer.id) })
  } catch (error) { next(error) }
})

// 合并本地收藏：兼容 product_id 数组与 { product_ids: [...] } 两种入参
// 注意：必须注册在 /:productId 之前，否则 /merge 会被当成商品 id
router.post('/merge', async (req, res, next) => {
  const connection = await db.getConnection()
  try {
    const raw = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.product_ids) ? req.body.product_ids : [])
    const ids = [...new Set(raw.map(parseProductId).filter(Boolean))]

    let added = 0
    if (ids.length) {
      await connection.beginTransaction()
      try {
        for (const productId of ids) {
          // 已删除的商品直接跳过，不阻断整体合并
          if (!await findProduct(productId, connection)) continue
          const [result] = await connection.execute('INSERT OR IGNORE INTO customer_favorite (customer_id, product_id) VALUES (?, ?)', [req.customer.id, productId])
          added += result.affectedRows
        }
        await connection.commit()
      } catch (error) { await connection.rollback(); throw error }
    }

    res.json({
      success: true,
      message: added ? `已合并 ${added} 个收藏` : '没有新增的收藏',
      merged: added,
      data: await listFavorites(req.customer.id),
    })
  } catch (error) { next(error) } finally { connection.release() }
})

// 收藏（幂等：重复收藏不报错，由唯一索引 + INSERT OR IGNORE 兜底）
router.post('/:productId', async (req, res, next) => {
  try {
    const productId = parseProductId(req.params.productId)
    if (!productId) return res.status(404).json({ success: false, message: '商品不存在' })
    if (!await findProduct(productId)) return res.status(404).json({ success: false, message: '商品不存在' })

    const [result] = await db.execute('INSERT OR IGNORE INTO customer_favorite (customer_id, product_id) VALUES (?, ?)', [req.customer.id, productId])
    res.status(result.affectedRows ? 201 : 200).json({
      success: true,
      message: result.affectedRows ? '收藏成功' : '已收藏过该商品',
      data: { product_id: productId, favorited: true },
    })
  } catch (error) { next(error) }
})

// 取消收藏
router.delete('/:productId', async (req, res, next) => {
  try {
    const productId = parseProductId(req.params.productId)
    if (!productId) return res.status(404).json({ success: false, message: '尚未收藏该商品' })
    const [result] = await db.execute('DELETE FROM customer_favorite WHERE customer_id = ? AND product_id = ?', [req.customer.id, productId])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '尚未收藏该商品' })
    res.json({ success: true, message: '已取消收藏' })
  } catch (error) { next(error) }
})

export default router
