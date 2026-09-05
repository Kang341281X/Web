import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, requireSuperAdmin, writeOperationLog } from '../middleware/auth.js'
import { publicAdmin, requiredText } from '../utils/admin.js'

const router = Router()
const fields = 'id, username, role, real_name, avatar, phone, email, status, must_change_password, last_login_time, created_at, updated_at'
router.use(requireAuth, requirePasswordChanged, requireSuperAdmin)

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(req.query.page_size) || 10, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const where = keyword ? 'WHERE username LIKE ? OR real_name LIKE ? OR phone LIKE ? OR email LIKE ?' : ''
    const params = keyword ? Array(4).fill(`%${keyword}%`) : []
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM admin ${where}`, params)
    const [rows] = await db.execute(`SELECT ${fields} FROM admin ${where} ORDER BY id ASC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
    res.json({ success: true, data: rows.map(publicAdmin), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ success: false, message: '管理员不存在' })
    res.json({ success: true, data: publicAdmin(rows[0]) })
  } catch (error) { next(error) }
})
router.post('/', async (req, res, next) => {
  try {
    const username = requiredText(req.body.username, '账号', { min: 3, max: 50 }); const password = requiredText(req.body.password, '初始密码', { min: 6, max: 128 }); const realName = requiredText(req.body.real_name, '姓名', { min: 1, max: 50 })
    const email = String(req.body.email || '').trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
    const [result] = await db.execute("INSERT INTO admin (username, password, role, real_name, phone, email, status, must_change_password) VALUES (?, ?, 'admin', ?, ?, ?, ?, 1)", [username, await bcrypt.hash(password, 12), realName, String(req.body.phone || '').trim() || null, email || null, Number(req.body.status) === 0 ? 0 : 1])
    const [rows] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [result.insertId])
    await writeOperationLog(req.admin.id, 'create_admin', username, req)
    res.status(201).json({ success: true, message: '管理员已创建', data: publicAdmin(rows[0]) })
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: '账号已存在' }); next(error) }
})
router.put('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [req.params.id]); const target = rows[0]
    if (!target) return res.status(404).json({ success: false, message: '管理员不存在' })
    if (target.role === 'super_admin') return res.status(403).json({ success: false, message: '超级管理员账号不可修改或降级' })
    const realName = requiredText(req.body.real_name, '姓名', { min: 1, max: 50 }); const email = String(req.body.email || '').trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
    await db.execute('UPDATE admin SET real_name = ?, phone = ?, email = ?, status = ? WHERE id = ?', [realName, String(req.body.phone || '').trim() || null, email || null, Number(req.body.status) === 0 ? 0 : 1, target.id])
    const [updated] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [target.id]); await writeOperationLog(req.admin.id, 'update_admin', target.username, req)
    res.json({ success: true, message: '管理员已更新', data: publicAdmin(updated[0]) })
  } catch (error) { next(error) }
})
router.put('/:id/reset-password', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, username, role FROM admin WHERE id = ?', [req.params.id]); const target = rows[0]
    if (!target) return res.status(404).json({ success: false, message: '管理员不存在' })
    if (target.role === 'super_admin') return res.status(403).json({ success: false, message: '超级管理员账号不可重置' })
    const password = requiredText(req.body.password, '新密码', { min: 6, max: 128 })
    await db.execute('UPDATE admin SET password = ?, must_change_password = 1 WHERE id = ?', [await bcrypt.hash(password, 12), target.id]); await writeOperationLog(req.admin.id, 'reset_admin_password', target.username, req)
    res.json({ success: true, message: '密码已重置' })
  } catch (error) { next(error) }
})
router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, username, role FROM admin WHERE id = ?', [req.params.id]); const target = rows[0]
    if (!target) return res.status(404).json({ success: false, message: '管理员不存在' })
    if (target.role === 'super_admin') return res.status(403).json({ success: false, message: '唯一超级管理员账号不可删除' })
    if (target.id === req.admin.id) return res.status(403).json({ success: false, message: '不能删除当前登录账号' })
    await db.execute('DELETE FROM admin WHERE id = ?', [target.id]); await writeOperationLog(req.admin.id, 'delete_admin', target.username, req)
    res.json({ success: true, message: '管理员已删除' })
  } catch (error) { next(error) }
})
export default router
