import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, requireSuperAdmin, writeOperationLog } from '../middleware/auth.js'
import { requiredText } from '../utils/admin.js'
import { orderStatusLabel } from '../utils/order.js'

/**
 * 后台「收支明细」（仅超级管理员）：
 *  - 收入：不落表，由 customer_order 实时聚合。口径与 GET /api/admin-orders/stats 的
 *    total_amount 完全一致（status <> 'cancelled'，其余状态都计入），保证与仪表盘数字一致。
 *  - 支出：来自管理员在 finance_expense 表手工登记的记录（见 sql/033_finance_expense.sql）。
 *
 * 权限：路由级整体挂载 requireAuth → requirePasswordChanged → requireSuperAdmin，
 * 与 routes/admins.js 写法一致。非超级管理员访问任一接口都会在 requireSuperAdmin 处
 * 返回 403（并记一条越权日志），前端隐藏菜单只是体验层，真正的拦截在后端。
 */
const router = Router()
router.use(requireAuth, requirePasswordChanged, requireSuperAdmin)

// 收入口径：排除已取消订单（取消不算消费），与 /api/admin-orders/stats 一致
const INCOME_WHERE = "o.status <> 'cancelled'"
// 每页最多 100 条，避免一次拉爆；趋势最多画 400 个点（日粒度约 13 个月）
const MAX_PAGE_SIZE = 100
const MAX_PERIODS = 400

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 'YYYY-MM-DD'；非严格日期串一律视为无效，交给调用方用默认区间兜底
function parseDateOnly(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const date = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text
}

const toDayString = (time) => new Date(time).toISOString().slice(0, 10)

// 时间范围：未传或非法时默认「最近 30 天」。
// 说明：customer_order.created_at 由 SQLite CURRENT_TIMESTAMP 写入（UTC、'YYYY-MM-DD HH:MM:SS'），
// 这里按「UTC 日期字符串」比较（与仪表盘的 date('now') 口径一致），与操作日志的筛选方式相同。
function resolveRange(query) {
  const today = toDayString(Date.now())
  const defaultStart = toDayString(Date.now() - 29 * 86400000)
  let start = parseDateOnly(query.start_date) || defaultStart
  let end = parseDateOnly(query.end_date) || today
  if (start > end) [start, end] = [end, start]
  return { start, end }
}

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100
const money = (value) => `¥${Number(value || 0).toFixed(2)}`

// 金额：必须为正数，保留 2 位小数（与 REAL 存储、展示口径一致）
function parseAmount(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) {
    throw Object.assign(new Error('金额应为大于 0 且不超过 99999999.99 的数字'), { status: 400 })
  }
  return Math.round(amount * 100) / 100
}

function parsePage(query) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1)
  const pageSize = Math.min(Math.max(Number.parseInt(query.page_size, 10) || 20, 1), MAX_PAGE_SIZE)
  return { page, pageSize }
}

// 依据「时间范围 + 粒度」生成本该出现的完整周期序列，用于补齐没有数据的日期（值为 0）
function enumeratePeriods(start, end, granularity) {
  const periods = []
  if (granularity === 'month') {
    let [year, month] = start.split('-').map(Number)
    const [endYear, endMonth] = end.split('-').map(Number)
    while ((year < endYear || (year === endYear && month <= endMonth)) && periods.length < MAX_PERIODS) {
      periods.push(`${year}-${String(month).padStart(2, '0')}`)
      month += 1
      if (month > 12) { month = 1; year += 1 }
    }
  } else {
    const cursor = new Date(`${start}T00:00:00Z`)
    const last = new Date(`${end}T00:00:00Z`)
    while (cursor <= last && periods.length < MAX_PERIODS) {
      periods.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return periods
}

/**
 * GET /summary?start_date=&end_date=&granularity=day|month
 * 返回筛选范围内的总收入 / 总支出 / 净利润 + 收支趋势（按天或按月，缺失周期补 0）。
 */
router.get('/summary', async (req, res, next) => {
  try {
    const { start, end } = resolveRange(req.query)
    const granularity = req.query.granularity === 'month' ? 'month' : 'day'
    // created_at 是 'YYYY-MM-DD HH:MM:SS'，用 start / 'end 23:59:59' 做闭区间比较
    const orderRange = [start, `${end} 23:59:59`]

    const [[income]] = await db.execute(
      `SELECT COALESCE(SUM(o.total_amount), 0) AS total, COUNT(*) AS count
         FROM customer_order o
        WHERE ${INCOME_WHERE} AND o.created_at >= ? AND o.created_at <= ?`,
      orderRange
    )
    const [[expense]] = await db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM finance_expense
        WHERE expense_date >= ? AND expense_date <= ?`,
      [start, end]
    )

    const periodExpr = granularity === 'month'
      ? "strftime('%Y-%m', o.created_at)"
      : 'date(o.created_at)'
    const [incomeRows] = await db.execute(
      `SELECT ${periodExpr} AS period, COALESCE(SUM(o.total_amount), 0) AS amount
         FROM customer_order o
        WHERE ${INCOME_WHERE} AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY period`,
      orderRange
    )
    const expensePeriodExpr = granularity === 'month'
      ? "strftime('%Y-%m', expense_date)"
      : 'expense_date'
    const [expenseRows] = await db.execute(
      `SELECT ${expensePeriodExpr} AS period, COALESCE(SUM(amount), 0) AS amount
         FROM finance_expense
        WHERE expense_date >= ? AND expense_date <= ?
        GROUP BY period`,
      [start, end]
    )

    const incomeMap = new Map(incomeRows.map(row => [row.period, Number(row.amount)]))
    const expenseMap = new Map(expenseRows.map(row => [row.period, Number(row.amount)]))
    const trend = enumeratePeriods(start, end, granularity).map(period => {
      const periodIncome = roundMoney(incomeMap.get(period) || 0)
      const periodExpense = roundMoney(expenseMap.get(period) || 0)
      return { period, income: periodIncome, expense: periodExpense, net_profit: roundMoney(periodIncome - periodExpense) }
    })

    const incomeTotal = roundMoney(income.total)
    const expenseTotal = roundMoney(expense.total)
    res.json({
      success: true,
      data: {
        range: { start_date: start, end_date: end },
        granularity,
        income_total: incomeTotal,
        expense_total: expenseTotal,
        net_profit: roundMoney(incomeTotal - expenseTotal),
        order_count: Number(income.count),
        expense_count: Number(expense.count),
        trend,
      },
    })
  } catch (error) { next(error) }
})

/**
 * GET /income?start_date=&end_date=&keyword=&page=&page_size=
 * 收入明细：来自订单列表（排除已取消），字段与订单管理一致，便于核对。
 */
router.get('/income', async (req, res, next) => {
  try {
    const { start, end } = resolveRange(req.query)
    const { page, pageSize } = parsePage(req.query)
    const keyword = String(req.query.keyword || '').trim()

    const clauses = [INCOME_WHERE, 'o.created_at >= ?', 'o.created_at <= ?']
    const params = [start, `${end} 23:59:59`]
    if (keyword) {
      clauses.push('(o.order_no LIKE ? OR cu.phone LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    // customer 用 LEFT JOIN，兼容 customer_id 为空的历史 / 游客订单
    const from = 'FROM customer_order o LEFT JOIN customer cu ON cu.id = o.customer_id'

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params)
    const [rows] = await db.execute(
      `SELECT o.id, o.order_no, o.total_amount, o.status, o.created_at,
              o.customer_username, o.customer_email,
              cu.nickname AS customer_nickname, cu.phone AS customer_phone
         ${from} ${where}
        ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )

    res.json({
      success: true,
      data: rows.map(row => ({ ...row, total_amount: Number(row.total_amount), status_label: orderStatusLabel(row.status) })),
      pagination: { page, page_size: pageSize, total: Number(total) },
    })
  } catch (error) { next(error) }
})

/**
 * GET /expenses?start_date=&end_date=&category=&page=&page_size=
 * 支出明细：来自手工登记的 finance_expense。
 */
router.get('/expenses', async (req, res, next) => {
  try {
    const { start, end } = resolveRange(req.query)
    const { page, pageSize } = parsePage(req.query)
    const category = String(req.query.category || '').trim()

    const clauses = ['expense_date >= ?', 'expense_date <= ?']
    const params = [start, end]
    if (category) { clauses.push('category = ?'); params.push(category) }
    const where = `WHERE ${clauses.join(' AND ')}`

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM finance_expense ${where}`, params)
    const [rows] = await db.execute(
      `SELECT id, amount, category, note, expense_date, created_by, created_by_name, created_at, updated_at
         FROM finance_expense ${where}
        ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )

    res.json({
      success: true,
      data: rows.map(row => ({ ...row, amount: Number(row.amount) })),
      pagination: { page, page_size: pageSize, total: Number(total) },
    })
  } catch (error) { next(error) }
})

// 校验并归一化支出表单，POST / PUT 共用
function parseExpensePayload(body) {
  const amount = parseAmount(body.amount)
  const category = requiredText(body.category, '支出类别', { min: 1, max: 50 })
  const expenseDate = parseDateOnly(body.expense_date)
  if (!expenseDate) throw Object.assign(new Error('请选择有效的支出发生日期'), { status: 400 })
  const note = String(body.note || '').trim().slice(0, 500) || null
  return { amount, category, expenseDate, note }
}

// 新增支出（手工登记，如物流成本、平台推广费用）
router.post('/expenses', async (req, res, next) => {
  try {
    const { amount, category, expenseDate, note } = parseExpensePayload(req.body)
    const operator = req.admin.real_name || req.admin.username
    const [result] = await db.execute(
      `INSERT INTO finance_expense (amount, category, note, expense_date, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [amount, category, note, expenseDate, req.admin.id, operator]
    )
    const [rows] = await db.execute('SELECT * FROM finance_expense WHERE id = ?', [result.insertId])
    await writeOperationLog(req.admin.id, 'create_expense', `${category} ${money(amount)}（${expenseDate}）`, req)
    res.status(201).json({ success: true, message: '支出已登记', data: { ...rows[0], amount: Number(rows[0].amount) } })
  } catch (error) { next(error) }
})

// 编辑支出：只能改金额 / 类别 / 备注 / 发生日期，登记人与创建时间保持不变
router.put('/expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '支出记录不存在' })
    const [existing] = await db.execute('SELECT id FROM finance_expense WHERE id = ?', [id])
    if (!existing[0]) return res.status(404).json({ success: false, message: '支出记录不存在' })

    const { amount, category, expenseDate, note } = parseExpensePayload(req.body)
    await db.execute(
      `UPDATE finance_expense SET amount = ?, category = ?, note = ?, expense_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, category, note, expenseDate, id]
    )
    const [rows] = await db.execute('SELECT * FROM finance_expense WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'update_expense', `${category} ${money(amount)}（${expenseDate}）`, req)
    res.json({ success: true, message: '支出已更新', data: { ...rows[0], amount: Number(rows[0].amount) } })
  } catch (error) { next(error) }
})

// 删除支出
router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '支出记录不存在' })
    const [rows] = await db.execute('SELECT id, amount, category, expense_date FROM finance_expense WHERE id = ?', [id])
    const target = rows[0]
    if (!target) return res.status(404).json({ success: false, message: '支出记录不存在' })

    await db.execute('DELETE FROM finance_expense WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'delete_expense', `${target.category} ${money(target.amount)}（${target.expense_date}）`, req)
    res.json({ success: true, message: '支出已删除' })
  } catch (error) { next(error) }
})

export default router
