import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import { ORDER_STATUSES, isValidOrderStatus, orderStatusLabel, findOrderDetail, changeOrderStatus } from '../utils/order.js'

// 后台「订单管理」：查询 + 推进状态。
// 状态流转与「取消回补库存」都收敛在 utils/order.js，管理端与顾客端取消订单共用同一份实现。
const router = Router()
router.use(requireAuth, requirePasswordChanged)

const orderFields = `o.id, o.order_no, o.customer_id, o.receiver_name, o.receiver_phone, o.receiver_address, o.total_amount, o.status, o.remark, o.handled_by, o.handled_by_name, o.created_at, o.updated_at, cu.phone AS customer_phone, cu.nickname AS customer_nickname`

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function publicOrderRow(order) {
  return { ...order, total_amount: Number(order.total_amount), status_label: orderStatusLabel(order.status) }
}

// 订单列表：分页 + 按状态 / 订单号 / 顾客手机号筛选。
// customer 用 LEFT JOIN，兼容 customer_id 为空的历史订单。
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const status = String(req.query.status || '').trim()
    const orderNo = String(req.query.order_no || '').trim()
    const phone = String(req.query.phone || '').trim()
    // keyword 为「订单号或手机号」的合并搜索，方便后台只用一个搜索框
    const keyword = String(req.query.keyword || '').trim()

    if (status && !isValidOrderStatus(status)) return res.status(400).json({ success: false, message: '订单状态不正确' })

    const clauses = []
    const params = []
    if (status) { clauses.push('o.status = ?'); params.push(status) }
    if (orderNo) { clauses.push('o.order_no LIKE ?'); params.push(`%${orderNo}%`) }
    if (phone) { clauses.push('cu.phone LIKE ?'); params.push(`%${phone}%`) }
    if (keyword) {
      const like = `%${keyword}%`
      clauses.push('(o.order_no LIKE ? OR cu.phone LIKE ?)')
      params.push(like, like)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const from = `FROM customer_order o LEFT JOIN customer cu ON cu.id = o.customer_id`

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${orderFields} ${from} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: rows.map(publicOrderRow), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})

// 订单详情：主表 + 明细（商品名称/SKU/单价为下单时快照，商品被删也能还原）
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '订单不存在' })
    const order = await findOrderDetail(id)
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' })
    res.json({ success: true, data: order })
  } catch (error) { next(error) }
})

// 更新订单状态：pending → confirmed → shipped → completed，或 → cancelled。
// 取消时把明细里的商品库存加回去（见 utils/order.js 的 changeOrderStatus，事务内完成）。
router.put('/:id/status', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '订单不存在' })
    const status = String(req.body.status || '').trim()
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ success: false, message: '订单状态不正确' })

    const { order, changed, restored } = await changeOrderStatus(id, status, {
      handledBy: req.admin.id,
      handledByName: req.admin.real_name || req.admin.username,
    })

    // 目标状态与当前一致：不回补库存、不写日志，仅告知前端无需重复操作
    if (!changed) {
      return res.json({
        success: true,
        changed: false,
        message: `订单已是「${orderStatusLabel(status)}」状态`,
        data: await findOrderDetail(id),
      })
    }

    await writeOperationLog(
      req.admin.id,
      'update_order_status',
      `${order.order_no}：${orderStatusLabel(order.status)} → ${orderStatusLabel(status)}${restored ? `（回补 ${restored} 项商品库存）` : ''}`,
      req
    )

    res.json({
      success: true,
      changed: true,
      restored,
      message: status === 'cancelled' ? `订单已取消，已回补 ${restored} 项商品库存` : `订单状态已更新为「${orderStatusLabel(status)}」`,
      data: await findOrderDetail(id),
    })
  } catch (error) { next(error) }
})

export default router
