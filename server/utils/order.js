import db from '../config/db.js'
import storageService from '../services/storageService.js'
import { findProduct } from './customerShop.js'

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

// 对外输出：金额转数值 + 补状态中文名，前端可直接展示。
// shipping_fee 是下单时快照的运费（来自 shipping_rate.fee_cny），保留两位小数便于后台拆分展示。
export function publicOrder(order) {
  if (!order) return null
  return {
    ...order,
    total_amount: Number(order.total_amount),
    shipping_fee: order.shipping_fee == null ? 0 : Number(order.shipping_fee),
    status_label: orderStatusLabel(order.status),
  }
}

// 明细对外输出：金额转数值；product_image 取当前商品主图完整地址（商品被硬删除时
// product_id 已置 NULL，这里返回空串，由前端回退到占位图；名称/SKU/价格仍用下单快照）。
export function publicOrderItem(item) {
  return {
    ...item,
    price: Number(item.price),
    subtotal: Number(item.subtotal),
    product_image: item.main_image ? storageService.getUrl(item.main_image) : '',
  }
}

// 订单详情（主表 + 明细），customer 用 LEFT JOIN 以兼容 customer_id 为空的历史订单。
// 可传入事务连接复用，管理端 /api/admin-orders 与顾客端订单接口共用同一份输出结构。
// customer_username / customer_email 是下单时的账号快照（见 026 迁移），不随账号资料变更。
export async function findOrderDetail(orderId, connection = db) {
  const [rows] = await connection.execute(
    `SELECT o.id, o.order_no, o.customer_id, o.customer_username, o.customer_email, o.receiver_name, o.receiver_phone, o.receiver_address, o.total_amount, o.shipping_fee, o.status, o.remark, o.handled_by, o.handled_by_name, o.created_at, o.updated_at, cu.phone AS customer_phone FROM customer_order o LEFT JOIN customer cu ON cu.id = o.customer_id WHERE o.id = ?`,
    [orderId]
  )
  const order = rows[0]
  if (!order) return null
  // LEFT JOIN product 取当前主图（仅用于展示；商品被删除后 product_id 为 NULL，不影响快照字段）
  const [items] = await connection.execute(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.product_sku, oi.price, oi.quantity, oi.subtotal, p.main_image
     FROM order_item oi LEFT JOIN product p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`,
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

// 订单号：CO + 年月日时分秒 + 4 位随机数。
// 种子脚本生成的假订单号以 SD 开头（见 server/scripts/seed-dev-data.js），真实下单固定用 CO 前缀，
// 两者在库里一眼可区分，也便于排查「某条订单是真实下单还是造的数据」。
function generateOrderNo() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `CO${stamp}${Math.floor(1000 + Math.random() * 9000)}`
}

// 顾客下单（事务）：校验并扣减库存 → 写入订单主表 + 明细 → 清空已下单商品对应的购物车项。
//
// items 既可来自购物车，也可由前端传入的选中商品（[{ product_id, quantity }]）。
// 并发安全：库存扣减用「UPDATE ... WHERE stock >= ?」条件更新，只有成功影响 1 行才算扣减成功，
// 与 changeOrderStatus 里取消回补库存（stock = stock + ?）共用同一张表的行级更新，
// 任何并发下库存都不会被扣成负数。
//
// 不修改 product.sales：与 restoreOrderStock 的口径保持一致（销量按历史累计售出统计，取消不回滚），
// 故下单/取消都只操作 stock，取消时能精确回补下单扣掉的数量。
//
// shippingFee：来自前端按当前语言对应的 shipping_rate.fee_cny，作为订单级费用快照进 customer_order。
// 后端不二次查询 shipping_rate，避免被后台调价后的视图与下单快照错位；传入值必须 >= 0 否则直接拒绝。
// 取消订单不退回运费（运费是物流服务费用而非商品款项），故 restoreOrderStock 不触碰该列。
export async function createCustomerOrder({ customer, address, items, remark = null, shippingFee = 0 }) {
  if (!address) throw Object.assign(new Error('请先选择收货地址'), { status: 400 })

  const shipping = Number(shippingFee)
  if (!Number.isFinite(shipping) || shipping < 0) {
    throw Object.assign(new Error('运费不正确'), { status: 400 })
  }
  // 与金额一致保留两位小数，避免前端展示出现 25.00000000003 等浮点尾数
  const shippingFeeNormalized = Math.round(shipping * 100) / 100

  // 归并重复商品，并按商品 id 升序处理，保证同一事务内扣减顺序稳定、减少并发写同表时的冲突几率
  const merged = new Map()
  for (const item of items || []) {
    const productId = Number(item?.product_id)
    if (!Number.isInteger(productId) || productId <= 0) continue
    const quantity = Math.trunc(Number(item?.quantity))
    if (!Number.isInteger(quantity) || quantity < 1) throw Object.assign(new Error('商品数量不正确'), { status: 400 })
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  if (!merged.size) throw Object.assign(new Error('请先选择要购买的商品'), { status: 400 })

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const lines = []
    let goodsAmount = 0

    for (const [productId, quantity] of [...merged].sort((a, b) => a[0] - b[0])) {
      const product = await findProduct(productId, connection)
      if (!product) throw Object.assign(new Error('商品不存在或已下架'), { status: 400 })
      if (!product.status) throw Object.assign(new Error(`「${product.name}」已下架`), { status: 400 })

      const [result] = await connection.execute(
        "UPDATE product SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?",
        [quantity, productId, quantity]
      )
      if (!result.affectedRows) throw Object.assign(new Error(`「${product.name}」库存不足`), { status: 400 })

      const price = Number(product.price)
      const subtotal = Math.round(price * quantity * 100) / 100
      goodsAmount = Math.round((goodsAmount + subtotal) * 100) / 100
      lines.push({ product_id: productId, product_name: product.name, product_sku: product.sku, price, quantity, subtotal })
    }

    // total_amount = 商品小计 + 运费，便于后台「订单金额」一眼看到最终应付；明细拆分靠 shipping_fee 拆分
    const totalAmount = Math.round((goodsAmount + shippingFeeNormalized) * 100) / 100
    const receiverAddress = [address.province, address.city, address.district, address.detail_address].filter(Boolean).join(' ')
    // customer_username 为登录用户名快照（030 起 username 必填且唯一），后台按「顾客用户名」语义展示；
    // 不再退化为昵称/手机号，避免与后台展示口径不一致。
    const [orderResult] = await connection.execute(
      `INSERT INTO customer_order (order_no, customer_id, customer_username, customer_email, receiver_name, receiver_phone, receiver_address, total_amount, shipping_fee, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        generateOrderNo(),
        customer.id,
        customer.username,
        customer.email || null,
        address.receiver_name,
        address.receiver_phone,
        receiverAddress,
        totalAmount,
        shippingFeeNormalized,
        remark,
      ]
    )
    const orderId = orderResult.insertId

    for (const line of lines) {
      await connection.execute(
        'INSERT INTO order_item (order_id, product_id, product_name, product_sku, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, line.product_id, line.product_name, line.product_sku, line.price, line.quantity, line.subtotal]
      )
    }

    // 只清掉本次下单的商品，购物车中未下单的其它商品保留
    for (const productId of merged.keys()) {
      await connection.execute('DELETE FROM cart_item WHERE customer_id = ? AND product_id = ?', [customer.id, productId])
    }

    await connection.commit()
    return findOrderDetail(orderId)
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
