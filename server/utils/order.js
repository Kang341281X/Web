import db from '../config/db.js'

// 订单状态机：取值与 022_customer_order.sql 的 CHECK 约束保持一致。
//
// 只允许「待确认 → 已确认 → 已发货 → 已完成」单向推进，或在其被发货之前取消：
//   pending → confirmed | cancelled
//   confirmed → shipped  | cancelled
//   shipped   → completed（货已寄出，不再允许取消，售后另走流程）
//   completed / cancelled 为终态
export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'completed', 'cancelled']
export const ORDER_STATUS_LABELS = {
  pending: '待确认', confirmed: '已确认', shipped: '已发货', completed: '已完成', cancelled: '已取消',
}
const STATUS_FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
}

export function isValidOrderStatus(status) {
  return ORDER_STATUSES.includes(status)
}

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status
}

// 是否允许从 from 流转到 to
export function canTransitOrderStatus(from, to) {
  return Boolean(STATUS_FLOW[from]?.includes(to))
}

// 对外输出：金额转数值 + 补状态中文名，前端可直接展示
export function publicOrder(order) {
  if (!order) return null
  return { ...order, total_amount: Number(order.total_amount), status_label: orderStatusLabel(order.status) }
}

export function publicOrderItem(item) {
  return { ...item, price: Number(item.price), subtotal: Number(item.subtotal) }
}

// 订单详情（主表 + 明细），customer 用 LEFT JOIN 以兼容 customer_id 为空的历史订单。
// 可传入事务连接复用，管理端 /api/admin-orders 与顾客端订单接口共用同一份输出结构。
export async function findOrderDetail(orderId, connection = db) {
  const [rows] = await connection.execute(
    `SELECT o.id, o.order_no, o.customer_id, o.receiver_name, o.receiver_phone, o.receiver_address, o.total_amount, o.status, o.remark, o.handled_by, o.handled_by_name, o.created_at, o.updated_at, cu.phone AS customer_phone, cu.nickname AS customer_nickname FROM customer_order o LEFT JOIN customer cu ON cu.id = o.customer_id WHERE o.id = ?`,
    [orderId]
  )
  const order = rows[0]
  if (!order) return null
  const [items] = await connection.execute(
    'SELECT id, order_id, product_id, product_name, product_sku, price, quantity, subtotal FROM order_item WHERE order_id = ? ORDER BY id',
    [orderId]
  )
  return { ...publicOrder(order), items: items.map(publicOrderItem) }
}

// 取消订单回补库存：按明细逐条把数量加回 product.stock。
// order_item.product_id 允许为空（商品被硬删除后 ON DELETE SET NULL），空值跳过。
// 只回补库存、不回滚 sales：销量按「历史累计售出」口径统计，取消不冲减（如需冲减请另行确认）。
export async function restoreOrderStock(orderId, connection) {
  const [items] = await connection.execute(
    'SELECT product_id, quantity FROM order_item WHERE order_id = ? AND product_id IS NOT NULL',
    [orderId]
  )
  for (const item of items) {
    await connection.execute("UPDATE product SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?", [item.quantity, item.product_id])
  }
  return items.length
}

// 变更订单状态（事务）：校验状态流转 → 取消时回补库存 → 写回状态。
//
// 返回值 changed = false 表示订单本就处于目标状态：此时不回补库存、不写日志，
// 保证「已取消的订单再取消一次」不会重复回补库存（幂等）。
// handedBy 仅在管理端操作时传入，用于记录处理人快照；顾客自行取消时不传。
export async function changeOrderStatus(orderId, status, { handledBy = null, handledByName = null } = {}) {
  if (!isValidOrderStatus(status)) throw Object.assign(new Error('订单状态不正确'), { status: 400 })
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute('SELECT id, order_no, status FROM customer_order WHERE id = ?', [orderId])
    const order = rows[0]
    if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 })
    if (order.status === status) {
      await connection.rollback()
      return { order, changed: false, restored: 0 }
    }
    if (!canTransitOrderStatus(order.status, status)) {
      throw Object.assign(new Error(`订单不能从「${orderStatusLabel(order.status)}」变更为「${orderStatusLabel(status)}」`), { status: 400 })
    }
    // cancelled 是终态，且「同一状态」已在上面短路，所以库存只会在首次取消时回补一次
    const restored = status === 'cancelled' ? await restoreOrderStock(orderId, connection) : 0
    if (handledBy !== null) {
      await connection.execute(
        "UPDATE customer_order SET status = ?, handled_by = ?, handled_by_name = ?, updated_at = datetime('now') WHERE id = ?",
        [status, handledBy, handledByName, orderId]
      )
    } else {
      await connection.execute("UPDATE customer_order SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, orderId])
    }
    await connection.commit()
    return { order, changed: true, restored }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
