import { Router } from 'express'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import { PRODUCT_FIELDS, publicProduct, parseProductId, requiredQuantity, findProduct } from '../utils/customerShop.js'

const router = Router()

// 购物车全部接口都要求已登录顾客，customer_id 一律取自 token，不接受前端传入
router.use(requireCustomerAuth)

const CART_FIELDS = `ci.id AS cart_id, ci.quantity, ci.created_at, ci.updated_at, ${PRODUCT_FIELDS}`

// 读取购物车：联表 product / category，返回商品名称、价格、库存、主图，前端可直接渲染
async function listCart(customerId, connection = db) {
  const [rows] = await connection.execute(
    `SELECT ${CART_FIELDS} FROM cart_item ci JOIN product p ON p.id = ci.product_id JOIN category c ON c.id = p.category_id WHERE ci.customer_id = ? ORDER BY ci.created_at DESC, ci.id DESC`,
    [customerId]
  )
  return rows.map(publicProduct)
}

// 购物车列表
router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listCart(req.customer.id) })
  } catch (error) { next(error) }
})

// 加入购物车：已存在则累加；累加后按当前库存截断，绝不超出可售数量
router.post('/', async (req, res, next) => {
  try {
    const productId = parseProductId(req.body.product_id)
    if (!productId) return res.status(400).json({ success: false, message: '商品参数不正确' })
    const adding = requiredQuantity(req.body.quantity)

    const product = await findProduct(productId)
    if (!product) return res.status(404).json({ success: false, message: '商品不存在' })
    if (!product.status) return res.status(400).json({ success: false, message: '商品已下架' })
    if (product.stock < 1) return res.status(400).json({ success: false, message: '商品库存不足' })

    const [existing] = await db.execute('SELECT quantity FROM cart_item WHERE customer_id = ? AND product_id = ?', [req.customer.id, productId])
    const requested = Number(existing[0]?.quantity || 0) + adding

    // UPSERT：新增时写入 min(加购量, 库存)，已存在时在 SQL 内累加并封顶，
    // 保证任何并发下写库的数量都不会超过库存。
    await db.execute(
      "INSERT INTO cart_item (customer_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT (customer_id, product_id) DO UPDATE SET quantity = MIN(cart_item.quantity + excluded.quantity, ?), updated_at = datetime('now')",
      [req.customer.id, productId, Math.min(adding, product.stock), product.stock]
    )
    const [after] = await db.execute('SELECT quantity FROM cart_item WHERE customer_id = ? AND product_id = ?', [req.customer.id, productId])
    const quantity = after[0].quantity
    const truncated = quantity < requested

    res.json({
      success: true,
      message: truncated ? `库存仅剩 ${product.stock} 件，购物车数量已调整为 ${quantity}` : '已加入购物车',
      truncated,
      data: { product_id: productId, quantity, stock: product.stock },
    })
  } catch (error) { next(error) }
})

// 合并游客购物车：兼容 [{ product_id, quantity }] 与 { items: [...] } 两种入参
// 同商品先在本函数内求和，再与服务端已有数量相加并按库存截断
router.post('/merge', async (req, res, next) => {
  const connection = await db.getConnection()
  try {
    const raw = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.items) ? req.body.items : [])
    // 先归并前端数组里重复的商品，避免同一商品被覆盖成单条
    const merged = new Map()
    for (const item of raw) {
      const productId = parseProductId(item?.product_id)
      if (!productId) continue
      const quantity = Math.max(1, Math.trunc(Number(item?.quantity)) || 1)
      merged.set(productId, (merged.get(productId) || 0) + quantity)
    }

    let added = 0
    const truncated = []
    if (merged.size) {
      await connection.beginTransaction()
      try {
        for (const [productId, quantity] of merged) {
          const product = await findProduct(productId, connection)
          // 商品不存在 / 已下架 / 无库存的直接跳过，不阻断整体合并
          if (!product || !product.status || product.stock < 1) continue
          const [existing] = await connection.execute('SELECT quantity FROM cart_item WHERE customer_id = ? AND product_id = ?', [req.customer.id, productId])
          const requested = Number(existing[0]?.quantity || 0) + quantity
          const target = Math.min(requested, product.stock)
          if (target < 1) continue
          if (target < requested) truncated.push({ product_id: productId, stock: product.stock, quantity: target })
          await connection.execute(
            "INSERT INTO cart_item (customer_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT (customer_id, product_id) DO UPDATE SET quantity = ?, updated_at = datetime('now')",
            [req.customer.id, productId, target, target]
          )
          added++
        }
        await connection.commit()
      } catch (error) { await connection.rollback(); throw error }
    }

    res.json({
      success: true,
      message: added
        ? `已合并 ${added} 种商品${truncated.length ? `，其中 ${truncated.length} 种因库存不足已按库存调整` : ''}`
        : '没有可合并的购物车商品',
      merged: added,
      truncated,
      data: await listCart(req.customer.id),
    })
  } catch (error) { next(error) } finally { connection.release() }
})

// 修改某个商品的数量（同样按库存封顶）
router.put('/:productId', async (req, res, next) => {
  try {
    const productId = parseProductId(req.params.productId)
    if (!productId) return res.status(404).json({ success: false, message: '购物车中没有该商品' })
    const quantity = requiredQuantity(req.body.quantity, { required: true })

    const product = await findProduct(productId)
    if (!product) return res.status(404).json({ success: false, message: '商品不存在' })
    if (!product.status) return res.status(400).json({ success: false, message: '商品已下架' })
    const target = Math.min(quantity, product.stock)
    if (target < 1) return res.status(400).json({ success: false, message: '商品库存不足' })

    const [result] = await db.execute("UPDATE cart_item SET quantity = ?, updated_at = datetime('now') WHERE customer_id = ? AND product_id = ?", [target, req.customer.id, productId])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '购物车中没有该商品' })

    res.json({
      success: true,
      // 与 POST /（加购）截断文案保持同一口径，避免商品详情页/购物车页 toast 文案不一致
      message: target < quantity ? `库存仅剩 ${product.stock} 件，购物车数量已调整为 ${target}` : '数量已更新',
      truncated: target < quantity,
      data: { product_id: productId, quantity: target, stock: product.stock },
    })
  } catch (error) { next(error) }
})

// 删除某一项
router.delete('/:productId', async (req, res, next) => {
  try {
    const productId = parseProductId(req.params.productId)
    if (!productId) return res.status(404).json({ success: false, message: '购物车中没有该商品' })
    const [result] = await db.execute('DELETE FROM cart_item WHERE customer_id = ? AND product_id = ?', [req.customer.id, productId])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '购物车中没有该商品' })
    res.json({ success: true, message: '已从购物车移除' })
  } catch (error) { next(error) }
})

// 清空购物车（幂等：本来为空也返回成功）
router.delete('/', async (req, res, next) => {
  try {
    const [result] = await db.execute('DELETE FROM cart_item WHERE customer_id = ?', [req.customer.id])
    res.json({
      success: true,
      message: result.affectedRows ? `已清空购物车（${result.affectedRows} 件）` : '购物车已经是空的',
      data: { removed: result.affectedRows },
    })
  } catch (error) { next(error) }
})

export default router
