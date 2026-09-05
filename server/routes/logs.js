import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const module = String(req.query.module || '').trim()
    const startDate = String(req.query.start_date || '').trim()
    const endDate = String(req.query.end_date || '').trim()

    const clauses = []
    const params = []

    if (keyword) {
      clauses.push('(admin_username LIKE ? OR operation_desc LIKE ? OR operation_type LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (module) {
      clauses.push('operation_module = ?')
      params.push(module)
    }
    if (startDate) {
      clauses.push('created_at >= ?')
      params.push(startDate)
    }
    if (endDate) {
      clauses.push('created_at <= ?')
      params.push(endDate + ' 23:59:59')
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM operation_log ${where}`, params)
    const [rows] = await db.execute(
      `SELECT id, admin_id, admin_username, operation_type, operation_module, operation_desc, ip_address, created_at FROM operation_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: rows, pagination: { page, page_size: pageSize, total } })
  } catch (error) {
    next(error)
  }
})

export default router
