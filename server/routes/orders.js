import { Router } from 'express'
import ExcelJS from 'exceljs'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import { ORDER_STATUSES, isValidOrderStatus, orderStatusLabel, findOrderDetail, changeOrderStatus } from '../utils/order.js'

// 后台「订单管理」：查询 + 推进状态 + 导出。
// 状态流转与「取消回补库存」都收敛在 utils/order.js，管理端与顾客端取消订单共用同一份实现。
const router = Router()
router.use(requireAuth, requirePasswordChanged)

const orderFields = `o.id, o.order_no, o.customer_id, o.customer_username, o.customer_email, o.receiver_name, o.receiver_phone, o.receiver_address, o.total_amount, o.shipping_fee, o.status, o.remark, o.handled_by, o.handled_by_name, o.created_at, o.updated_at, cu.phone AS customer_phone`
// 列表与导出共用同一张 from：customer 用 LEFT JOIN，兼容 customer_id 为空的历史订单
const orderFrom = 'FROM customer_order o LEFT JOIN customer cu ON cu.id = o.customer_id'

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function publicOrderRow(order) {
  return {
    ...order,
    total_amount: Number(order.total_amount),
    // 历史订单在 034 迁移前没有 shipping_fee 列，统一兜底 0 以便前后端拆分展示
    shipping_fee: order.shipping_fee == null ? 0 : Number(order.shipping_fee),
    status_label: orderStatusLabel(order.status),
  }
}

// 列表与导出共用的筛选条件：状态 / 订单号 / 顾客手机号 / 关键词（订单号或手机号的合并搜索）/ 勾选的订单 id。
// 返回 { sql, params }，sql 为空字符串时表示无任何筛选条件。
function buildOrderWhere({ status, orderNo, phone, keyword, ids }) {
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
  if (ids?.length) { clauses.push(`o.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids) }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
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

    const where = buildOrderWhere({ status, orderNo, phone, keyword })

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total ${orderFrom} ${where.sql}`, where.params)
    const [rows] = await db.execute(
      `SELECT ${orderFields} ${orderFrom} ${where.sql} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...where.params, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: rows.map(publicOrderRow), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})

// 仪表盘统计：聚合出订单总数 / 各状态数量 / 今日订单数 / 有效金额，供仪表盘直接展示。
// 必须注册在 '/:id' 之前，否则 stats 会被当成订单 id。
// 口径与其它接口保持一致：总金额排除已取消订单（取消不算消费）；
// 「今日」按 UTC 日期切分（created_at 由 SQLite CURRENT_TIMESTAMP 写入，与仪表盘商品的今日口径相同）。
router.get('/stats', async (req, res, next) => {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_orders,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_orders,
              COALESCE(SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END), 0) AS shipped_orders,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_orders,
              COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_orders,
              COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today_orders,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_amount
       FROM customer_order`
    )
    res.json({
      success: true,
      data: {
        total_orders: Number(row.total_orders),
        // 待处理 = 等待客服确认的订单（pending），已确认待发货单独返回，避免前端误解口径
        pending_orders: Number(row.pending_orders),
        confirmed_orders: Number(row.confirmed_orders),
        shipped_orders: Number(row.shipped_orders),
        completed_orders: Number(row.completed_orders),
        cancelled_orders: Number(row.cancelled_orders),
        today_orders: Number(row.today_orders),
        total_amount: Number(row.total_amount),
      },
    })
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

// 导出订单（exceljs 生成 xlsx，冻结首行）：支持「当前筛选结果」与「勾选订单」两种模式。
// - filter：按列表当前筛选条件（状态 / 订单号 / 手机号 / 关键词）导出全部命中订单；
// - selected：按勾选的订单 id 导出。
// 字段含订单主表信息 + 商品明细；一个订单有多个商品时，商品明细逐行展开，
// 订单级字段（订单号/顾客/收货信息/金额/状态/时间/备注）纵向合并，保持结构清晰、信息不丢失。
// 注意：customer_order 表未单独记录发货/完成时间，这里以 updated_at（最近更新时间）呈现，
// 该字段在订单状态被推进时随之刷新，可作为发货/完成时间的近似参考。
router.post('/export', async (req, res, next) => {
  try {
    const mode = req.body.mode
    const ids = mode === 'selected' ? (Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : []) : null
    if (mode === 'selected' && !ids.length) return res.status(400).json({ success: false, message: '请先勾选要导出的订单' })
    if (!['filter', 'selected'].includes(mode)) return res.status(400).json({ success: false, message: '导出模式不正确' })

    const status = String(req.body.status || '').trim()
    if (status && !isValidOrderStatus(status)) return res.status(400).json({ success: false, message: '订单状态不正确' })
    const orderNo = String(req.body.order_no || '').trim()
    const phone = String(req.body.phone || '').trim()
    const keyword = String(req.body.keyword || '').trim()
    const where = buildOrderWhere({ status, orderNo, phone, keyword, ids })

    // 主表 LEFT JOIN 明细：一个订单多个商品会展开成多行，导出时再按订单合并订单级单元格
    const [rows] = await db.execute(
      `SELECT o.id, o.order_no, o.customer_username, o.customer_email, o.receiver_name, o.receiver_phone, o.receiver_address, o.total_amount, o.shipping_fee, o.status, o.remark, o.created_at, o.updated_at,
              oi.product_name, oi.product_sku, oi.price, oi.quantity, oi.subtotal
       ${orderFrom} LEFT JOIN order_item oi ON oi.order_id = o.id
       ${where.sql} ORDER BY o.created_at DESC, o.id DESC, oi.id`,
      where.params
    )

    // 按订单分组（查询已按订单+明细排序，顺序扫描即可）：无明细的历史订单保留一行，避免整单丢失
    const orders = []
    for (const row of rows) {
      let order = orders[orders.length - 1]
      if (!order || order.id !== row.id) { order = { id: row.id, row, items: [] }; orders.push(order) }
      if (row.product_name !== null) order.items.push(row)
    }

    const headers = ['序号', '订单号', '顾客账号', '收货人', '联系电话', '收货地址', '商品名称', '商品SKU', '单价', '数量', '小计', '运费', '订单金额', '状态', '下单时间', '最近更新时间', '备注']
    // 订单级列（1 基）在同一个订单的多行明细间纵向合并，避免同一信息重复铺满多行
    const orderLevelColumns = [2, 3, 4, 5, 6, 12, 13, 14, 15, 16, 17]
    const workbook = new ExcelJS.Workbook()
    // ySplit: 1 → 冻结第一行表头
    const sheet = workbook.addWorksheet('订单数据', { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }] })
    sheet.addRow(headers)
    sheet.getRow(1).font = { bold: true }

    let addedRows = 0
    let sequence = 0
    for (const order of orders) {
      const { row } = order
      // 无明细时用一行占位，保证订单主表信息仍然出现在导出文件里
      const items = order.items.length ? order.items : [null]
      const startRow = addedRows + 2
      // 历史订单在 034 迁移前没有 shipping_fee 列，统一兜底 0
      const shippingFee = row.shipping_fee == null ? 0 : Number(row.shipping_fee)
      for (const item of items) {
        sequence++
        addedRows++
        sheet.addRow([
          sequence,
          row.order_no,
          row.customer_username || '未记录',
          row.receiver_name,
          row.receiver_phone,
          row.receiver_address,
          item ? item.product_name : '',
          item ? (item.product_sku || '') : '',
          item ? Number(item.price) : '',
          item ? item.quantity : '',
          item ? Number(item.subtotal) : '',
          shippingFee,
          Number(row.total_amount),
          orderStatusLabel(row.status),
          row.created_at || '',
          row.updated_at || '',
          row.remark || '',
        ])
      }
      const endRow = addedRows + 1
      if (endRow > startRow) {
        for (const column of orderLevelColumns) sheet.mergeCells(startRow, column, endRow, column)
      }
    }

    // 列宽与对齐：金额/数量等窄列收紧，地址与备注留宽，整表垂直居中便于阅读
    const widths = [6, 22, 14, 10, 14, 34, 22, 12, 10, 8, 10, 10, 12, 10, 20, 20, 20]
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      row.alignment = { vertical: 'middle', wrapText: false }
    })
    sheet.getColumn(6).alignment = { vertical: 'middle', wrapText: true }
    sheet.getColumn(17).alignment = { vertical: 'middle', wrapText: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('订单数据.xlsx')}`)
    res.send(Buffer.from(buffer))
    await writeOperationLog(req.admin.id, 'export_orders', `导出订单：${mode === 'selected' ? `${ids.length}条` : '筛选结果'}`, req)
  } catch (error) { next(error) }
})

export default router
