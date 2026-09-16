import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, requireSuperAdmin, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'

// 后台「顾客管理」：查看、启用/禁用，以及由超级管理员把顾客登录密码一键重置为手机号。
// 编辑顾客资料仍只能由顾客本人操作（见 routes/customer.js 的 PUT /profile）。
const router = Router()
router.use(requireAuth, requirePasswordChanged)

const fields = 'id, phone, username, email, avatar, status, last_login_time, created_at, updated_at'
const addressFields = 'id, customer_id, receiver_name, receiver_phone, province, city, district, detail_address, is_default, created_at, updated_at'

// 管理端不复用顾客端的 publicCustomer：那边会把手机号脱敏成 138****1234，
// 而管理端需要完整手机号（客服联络、和对账），故这里只补全头像地址。
function publicCustomerRow(customer) {
  if (!customer) return null
  return { ...customer, avatar_url: storageService.getUrl(customer.avatar) }
}

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 顾客列表：分页 + 关键词（用户名 / 手机号 / 邮箱模糊匹配）
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const status = req.query.status

    const clauses = []
    const params = []
    if (keyword) {
      const like = `%${keyword}%`
      clauses.push('(username LIKE ? OR phone LIKE ? OR email LIKE ?)')
      params.push(like, like, like)
    }
    // 可选的状态筛选，仅接受 0/1，便于后台单独查看被禁用的账号
    if (status === '0' || status === '1') { clauses.push('status = ?'); params.push(Number(status)) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM customer ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${fields} FROM customer ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: rows.map(publicCustomerRow), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})

// 仪表盘统计：顾客总数 / 启用数 / 禁用数 / 今日新增。
// 必须注册在 '/:id' 之前，否则 stats 会被当成顾客 id。
// 「今日」按 UTC 日期切分（created_at 由 SQLite CURRENT_TIMESTAMP 写入）。
router.get('/stats', async (req, res, next) => {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total_customers,
              COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_customers,
              COALESCE(SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END), 0) AS disabled_customers,
              COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today_new
       FROM customer`
    )
    res.json({
      success: true,
      data: {
        total_customers: Number(row.total_customers),
        active_customers: Number(row.active_customers),
        disabled_customers: Number(row.disabled_customers),
        today_new: Number(row.today_new),
      },
    })
  } catch (error) { next(error) }
})

// 顾客详情：附带地址列表 + 订单数量 / 总消费金额
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '顾客不存在' })
    const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [id])
    const customer = rows[0]
    if (!customer) return res.status(404).json({ success: false, message: '顾客不存在' })

    const [addresses] = await db.execute(
      `SELECT ${addressFields} FROM customer_address WHERE customer_id = ? ORDER BY is_default DESC, id DESC`,
      [id]
    )
    // 总消费金额排除已取消订单（取消不算消费），订单数量按字面统计全部历史订单，
    // 两者口径不同，故再单独返回 cancelled_count 供前端解释差异。
    const [[stats]] = await db.execute(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_amount END), 0) AS total_amount, COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count FROM customer_order WHERE customer_id = ?`,
      [id]
    )

    res.json({
      success: true,
      data: {
        ...publicCustomerRow(customer),
        addresses,
        order_count: Number(stats.order_count),
        cancelled_count: Number(stats.cancelled_count),
        total_amount: Number(stats.total_amount),
      },
    })
  } catch (error) { next(error) }
})

// 启用 / 禁用顾客账号。
// 禁用只需把 customer.status 置 0：middleware/customerAuth.js 每次请求都会回查该字段，
// 被禁用后旧 token 立即失效（返回 401「账号不存在或已被禁用」），无需额外维护黑名单。
router.put('/:id/status', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '顾客不存在' })
    const status = [1, '1', true, 'true'].includes(req.body.status) ? 1
      : [0, '0', false, 'false'].includes(req.body.status) ? 0 : null
    if (status === null) return res.status(400).json({ success: false, message: '状态参数不正确' })

    const [rows] = await db.execute('SELECT id, phone, username, status FROM customer WHERE id = ?', [id])
    const customer = rows[0]
    if (!customer) return res.status(404).json({ success: false, message: '顾客不存在' })

    // 状态未变化时直接返回，既保持幂等，也避免向操作日志写入无意义的记录
    if (customer.status === status) {
      const [current] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [id])
      return res.json({
        success: true,
        changed: false,
        message: status ? '该顾客已是启用状态' : '该顾客已是禁用状态',
        data: publicCustomerRow(current[0]),
      })
    }

    await db.execute("UPDATE customer SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id])
    await writeOperationLog(req.admin.id, 'update_customer_status', `${customer.phone} → ${status ? '启用' : '禁用'}`, req)

    const [updated] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [id])
    res.json({
      success: true,
      changed: true,
      message: status ? '已启用该顾客账号' : '已禁用该顾客账号，其登录状态将立即失效',
      data: publicCustomerRow(updated[0]),
    })
  } catch (error) { next(error) }
})

// 删除顾客账号（不可恢复）。
// 外键行为（见 019/020/021/022/025 迁移）已保证数据安全：
//   - 收货地址 / 收藏 / 购物车随账号级联删除；
//   - 历史订单、商品评论保留（customer_id 置 NULL，展示靠下单快照 / 评论昵称快照）。
// 因此删除前先查一次订单数，写进操作日志便于事后追溯。
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '顾客不存在' })
    const [rows] = await db.execute('SELECT id, phone, username FROM customer WHERE id = ?', [id])
    const customer = rows[0]
    if (!customer) return res.status(404).json({ success: false, message: '顾客不存在' })

    const [[{ order_count }]] = await db.execute('SELECT COUNT(*) AS order_count FROM customer_order WHERE customer_id = ?', [id])
    await db.execute('DELETE FROM customer WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'delete_customer', `${customer.phone}（用户名：${customer.username || '未记录'}，历史订单 ${order_count} 笔）`, req)

    res.json({ success: true, message: `已删除顾客「${customer.username || customer.phone}」` })
  } catch (error) { next(error) }
})

// 一键重置顾客登录密码：仅超级管理员可用，新密码固定为该顾客的手机号。
// 顾客登录用的是 username + password（见 routes/customer.js 的 POST /login），
// 这里只覆盖 password，不改动账号本身；顾客端没有强制改密流程，故不设 must_change_password。
router.post('/:id/reset-password', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '顾客不存在' })

    const [rows] = await db.execute('SELECT id, phone, username FROM customer WHERE id = ?', [id])
    const customer = rows[0]
    if (!customer) return res.status(404).json({ success: false, message: '顾客不存在' })

    const phone = String(customer.phone || '').trim()
    if (!phone) return res.status(400).json({ success: false, message: '该顾客未登记手机号，无法重置为手机号' })

    await db.execute("UPDATE customer SET password = ?, updated_at = datetime('now') WHERE id = ?", [
      await bcrypt.hash(phone, 12),
      id,
    ])
    await writeOperationLog(req.admin.id, 'reset_customer_password', `${phone} → 重置为手机号`, req)

    const [updated] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [id])
    res.json({
      success: true,
      message: `已将「${customer.username || phone}」的登录密码重置为手机号`,
      data: publicCustomerRow(updated[0]),
    })
  } catch (error) { next(error) }
})

export default router
