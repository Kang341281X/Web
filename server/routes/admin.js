import { Router } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../config/db.js'
import { requireAuth, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'
import { publicAdmin, requiredText } from '../utils/admin.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const fields = 'id, username, role, real_name, avatar, phone, email, status, must_change_password, last_login_time, created_at, updated_at'

router.post('/login', async (req, res, next) => {
  try {
    const username = requiredText(req.body.username, '账号', { min: 3, max: 50 })
    const password = requiredText(req.body.password, '密码', { min: 6, max: 128 })
    const [rows] = await db.execute(`SELECT ${fields}, password FROM admin WHERE username = ?`, [username])
    const admin = rows[0]
    if (!admin || !await bcrypt.compare(password, admin.password)) return res.status(401).json({ success: false, message: '账号或密码错误' })
    if (!admin.status) return res.status(403).json({ success: false, message: '该账号已被禁用' })
    await db.execute("UPDATE admin SET last_login_time = datetime('now') WHERE id = ?", [admin.id])
    await writeOperationLog(admin.id, 'login', `管理员登录：${admin.username}`, req)
    const token = jwt.sign({ id: admin.id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' })
    admin.last_login_time = new Date()
    res.json({ success: true, token, user: publicAdmin(admin) })
  } catch (error) { next(error) }
})

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [req.admin.id])
    res.json({ success: true, user: publicAdmin(rows[0]) })
  } catch (error) { next(error) }
})

router.put('/profile', requireAuth, upload.single('avatar'), async (req, res, next) => {
  let newAvatar = null
  try {
    const [rows] = await db.execute(`SELECT ${fields}, password FROM admin WHERE id = ?`, [req.admin.id])
    const current = rows[0]
    if (!current) return res.status(404).json({ success: false, message: '管理员不存在' })
    const updates = []; const values = []
    for (const field of ['phone', 'email']) {
      if (Object.hasOwn(req.body, field)) {
        const value = String(req.body[field] || '').trim()
        if (field === 'email' && value && !/^\S+@\S+\.\S+$/.test(value)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
        updates.push(`${field} = ?`); values.push(value || null)
      }
    }
    if (req.file) { newAvatar = await storageService.save(req.file, 'avatars'); updates.push('avatar = ?'); values.push(newAvatar) }
    if (req.body.new_password) {
      if (!req.body.current_password || !await bcrypt.compare(req.body.current_password, current.password)) return res.status(400).json({ success: false, message: '原密码不正确' })
      const password = requiredText(req.body.new_password, '新密码', { min: 6, max: 128 })
      updates.push('password = ?', 'must_change_password = 0'); values.push(await bcrypt.hash(password, 12))
    }
    if (!updates.length) return res.status(400).json({ success: false, message: '没有可保存的更改' })
    values.push(current.id)
    await db.execute(`UPDATE admin SET ${updates.join(', ')} WHERE id = ?`, values)
    const [updated] = await db.execute(`SELECT ${fields} FROM admin WHERE id = ?`, [current.id])
    if (newAvatar && current.avatar) await storageService.delete(current.avatar)
    await writeOperationLog(req.admin.id, 'update_profile', '修改个人信息', req)
    res.json({ success: true, message: '个人信息已更新', user: publicAdmin(updated[0]) })
  } catch (error) {
    if (newAvatar) await storageService.delete(newAvatar)
    next(error)
  }
})
export default router
