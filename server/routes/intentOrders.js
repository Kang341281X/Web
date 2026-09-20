import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged } from '../middleware/auth.js'

/**
 * 后台「访客下载记录」（intent_order 只读列表）。
 * 数据来源：前台未登录访客下载结算清单（Excel）时由 POST /api/public/intent-orders 写入。
 * 注意：intent_order 只存商品快照与金额，没有访客姓名/电话等联系方式，
 * 这里仅作使用情况统计展示，不提供状态（pending/contacted/completed）展示与修改入口。
 */
const router = Router()
router.use(requireAuth, requirePasswordChanged)

/**
 * items 字段是 JSON 文本，历史上存在两种格式，必须都兼容：
 *  - 早期（运费快照加入前）：商品数组本身，如 [{ product_id, name, price, quantity, subtotal }]
 *  - 后来：带外层包装 { shipping_fee, items: [...] }
 * 解析失败（脏数据）时返回空明细兜底，不让单条坏记录拖垮整个列表。
 */
function parseItemsSnapshot(raw) {
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (Array.isArray(parsed)) return { items: parsed, shippingFee: 0 }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
    const fee = Number(parsed.shipping_fee)
    return {
      items: parsed.items,
      shippingFee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
    }
  }
  return { items: [], shippingFee: 0 }
}

// 列表行 → 前端展示结构：把 total_amount 拆成「商品金额 + 运费」
function publicIntentOrderRow(row) {
  const { items, shippingFee } = parseItemsSnapshot(row.items)
  const totalAmount = Number(row.total_amount) || 0
  return {
    id: row.id,
    order_no: row.order_no,
    item_count: items.length,
    // 商品金额 = 总金额 - 运费；早期记录（数组格式）运费按 0 处理，商品金额即总金额
    goods_amount: Math.max(totalAmount - shippingFee, 0),
    shipping_fee: shippingFee,
    total_amount: totalAmount,
    created_at: row.created_at,
  }
}

// 列表：分页 + 订单号 / 时间范围筛选，按生成时间倒序
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const orderNo = String(req.query.order_no || '').trim()
    // 时间范围：created_at 为 SQLite CURRENT_TIMESTAMP（UTC），按日期字符串比较
    const startDate = String(req.query.start_date || '').trim()
    const endDate = String(req.query.end_date || '').trim()

    const clauses = []
    const params = []
    if (orderNo) { clauses.push('order_no LIKE ?'); params.push(`%${orderNo}%`) }
    if (startDate) { clauses.push('date(created_at) >= date(?)'); params.push(startDate) }
    if (endDate) { clauses.push('date(created_at) <= date(?)'); params.push(endDate) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM intent_order ${where}`, params)
    const [rows] = await db.execute(
      `SELECT id, order_no, items, total_amount, created_at FROM intent_order ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({
      success: true,
      data: rows.map(publicIntentOrderRow),
      pagination: { page, page_size: pageSize, total },
    })
  } catch (error) { next(error) }
})

// 详情：含完整商品明细（名称/单价/数量/小计为下载时的快照，商品被删也能还原）
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ success: false, message: '记录不存在' })
    const [rows] = await db.execute(
      'SELECT id, order_no, items, total_amount, created_at FROM intent_order WHERE id = ?',
      [id]
    )
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' })
    const { items, shippingFee } = parseItemsSnapshot(rows[0].items)
    res.json({
      success: true,
      data: {
        ...publicIntentOrderRow(rows[0]),
        items: items.map(item => ({
          product_id: item.product_id ?? null,
          name: String(item.name || ''),
          price: Number(item.price) || 0,
          quantity: Number(item.quantity) || 0,
          subtotal: Number(item.subtotal) || 0,
        })),
      },
    })
  } catch (error) { next(error) }
})

export default router
