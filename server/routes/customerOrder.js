import { Router } from 'express'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import { optionalText } from '../utils/customer.js'
import { publicOrder, findOrderDetail, changeOrderStatus, orderStatusLabel, isValidOrderStatus, createCustomerOrder } from '../utils/order.js'

// 顾客端「我的订单」：下单 + 列表 + 详情 + 取消。
// 下单/取消的库存处理都收敛在 utils/order.js，与管理端订单接口共用同一份实现。
const router = Router()

// 全部接口都要求已登录顾客，customer_id 一律取自 token，不接受前端传入
router.use(requireCustomerAuth)

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 归属校验：只按 id + customer_id 查询，命中不了统一按「订单不存在」处理，
// 避免通过逐一尝试 id 探测出他人订单是否存在。
async function findOwnOrder(connection, customerId, id) {
  const [rows] = await connection.execute(
    'SELECT id, order_no, status FROM customer_order WHERE id = ? AND customer_id = ?',
    [id, customerId]
  )
  return rows[0] || null
}

// 读取一条收货地址快照（下单用）：必须属于当前顾客
async function findOwnAddress(connection, customerId, id) {
  const [rows] = await connection.execute(
    'SELECT id, receiver_name, receiver_phone, province, city, district, detail_address FROM customer_address WHERE id = ? AND customer_id = ?',
    [id, customerId]
  )
  return rows[0] || null
}

// 下单：收货信息从 customer_address 选一条快照进订单，商品来源优先取前端传入的 items，
// 未传时回退到购物车全部商品；库存校验与扣减、写订单、清购物车都在事务内完成。
router.post('/', async (req, res, next) => {
  try {
    // Express 5 在没带 body 时 req.body 为 undefined，统一兜底为空对象
    const body = req.body || {}
    // 收货地址：显式传 address_id 时校验归属；未传时取默认地址（列表按默认优先，取第一条）
    const addressId = parseId(body.address_id)
    let address = null
    if (addressId) {
      address = await findOwnAddress(db, req.customer.id, addressId)
      if (!address) return res.status(404).json({ success: false, message: '收货地址不存在' })
    } else {
      const [rows] = await db.execute(
        'SELECT id, receiver_name, receiver_phone, province, city, district, detail_address FROM customer_address WHERE customer_id = ? ORDER BY is_default DESC, id DESC LIMIT 1',
        [req.customer.id]
      )
      address = rows[0] || null
    }
    if (!address) return res.status(400).json({ success: false, message: '请先添加收货地址' })

    // 商品来源：前端传入的选中商品优先，否则用购物车全部商品
    let items = Array.isArray(body.items) ? body.items : null
    if (!items || !items.length) {
      const [cartRows] = await db.execute('SELECT product_id, quantity FROM cart_item WHERE customer_id = ?', [req.customer.id])
      items = cartRows
    }
    if (!items.length) return res.status(400).json({ success: false, message: '请先选择要购买的商品' })

    const remark = optionalText(body.remark, 200)
    // 运费由前端按当前语言对应的 shipping_rate.fee_cny 计算后传入；
    // 不二次查 shipping_rate，避免后台调价后视图与下单快照错位；空值兜底为 0。
    const shippingFee = Number(body.shipping_fee)
    const order = await createCustomerOrder({ customer: req.customer, address, items, remark, shippingFee: Number.isFinite(shippingFee) ? shippingFee : 0 })
    res.status(201).json({ success: true, message: '订单已提交，我们会尽快与您确认', data: order })
  } catch (error) { next(error) }
})

// 我的订单列表：分页 + 可选状态筛选，附商品种类数与商品总件数，列表页无需再拉详情
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 10, 1), 50)
    const status = String(req.query.status || '').trim()
    if (status && !isValidOrderStatus(status)) return res.status(400).json({ success: false, message: '订单状态不正确' })

    const clauses = ['o.customer_id = ?']
    const params = [req.customer.id]
    if (status) { clauses.push('o.status = ?'); params.push(status) }
    const where = `WHERE ${clauses.join(' AND ')}`

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM customer_order o ${where}`, params)
    const [rows] = await db.execute(
      `SELECT o.id, o.order_no, o.customer_username, o.customer_email, o.receiver_name, o.receiver_phone, o.receiver_address,
              o.total_amount, o.status, o.remark, o.created_at, o.updated_at,
              (SELECT COUNT(*) FROM order_item oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_item oi WHERE oi.order_id = o.id) AS item_quantity
       FROM customer_order o ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({
      success: true,
      data: rows.map(row => publicOrder({ ...row, item_count: Number(row.item_count), item_quantity: Number(row.item_quantity) })),
      pagination: { page, page_size: pageSize, total },
    })
  } catch (error) { next(error) }
})

// 订单详情：仅本人订单可见
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '订单不存在' })
    if (!await findOwnOrder(db, req.customer.id, id)) return res.status(404).json({ success: false, message: '订单不存在' })
    res.json({ success: true, data: await findOrderDetail(id) })
  } catch (error) { next(error) }
})

// 取消订单：复用 utils/order.js 的状态机与「取消回补库存」逻辑。
// 已发货/已完成的订单不可取消，能否流转由 changeOrderStatus 校验；重复取消幂等（不再回补库存）。
router.put('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '订单不存在' })
    const own = await findOwnOrder(db, req.customer.id, id)
    if (!own) return res.status(404).json({ success: false, message: '订单不存在' })

    // 顾客自行取消不记录处理人（handled_by 仅管理端操作时写入）
    const { changed, restored } = await changeOrderStatus(id, 'cancelled')
    const data = await findOrderDetail(id)
    if (!changed) return res.json({ success: true, changed: false, message: `订单已是「${orderStatusLabel(data.status)}」状态`, data })
    res.json({ success: true, changed: true, restored, message: '订单已取消，商品库存已回补', data })
  } catch (error) { next(error) }
})

export default router
