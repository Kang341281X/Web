import { Router } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import storageService from '../services/storageService.js'
import { publicCustomer, requiredPhone, requiredPassword, normalizeEmail } from '../utils/customer.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const fields = 'id, phone, email, nickname, avatar, status, last_login_time, created_at, updated_at'

// 注册：手机号 + 密码（+ 可选昵称/邮箱）
router.post('/register', async (req, res, next) => {
  try {
    const phone = requiredPhone(req.body.phone)
    const password = requiredPassword(req.body.password)
    const email = normalizeEmail(req.body.email)
    const nickname = String(req.body.nickname || '').trim()
    if (nickname.length > 50) throw Object.assign(new Error('昵称长度不能超过 50 个字符'), { status: 400 })

    const [existing] = await db.execute('SELECT id FROM customer WHERE phone = ?', [phone])
    if (existing[0]) return res.status(409).json({ success: false, message: '该手机号已注册' })

    const hashed = await bcrypt.hash(password, 12)
    try {
      const [result] = await db.execute(
        'INSERT INTO customer (phone, email, password, nickname) VALUES (?, ?, ?, ?)',
        [phone, email, hashed, nickname || null]
      )
      const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [result.insertId])
      res.status(201).json({ success: true, message: '注册成功', user: publicCustomer(rows[0]) })
    } catch (error) {
      // 并发注册时可能同时通过上面的存在性检查，最终由唯一索引兜底
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(error.message || '')) {
        return res.status(409).json({ success: false, message: '该手机号已注册' })
      }
      throw error
    }
  } catch (error) { next(error) }
})

// 登录：签发顾客专用 token（payload 为 { customerId }）
router.post('/login', async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').trim()
    const password = String(req.body.password || '')
    const [rows] = await db.execute(`SELECT ${fields}, password FROM customer WHERE phone = ?`, [phone])
    const customer = rows[0]
    if (!customer || !await bcrypt.compare(password, customer.password)) {
      return res.status(401).json({ success: false, message: '手机号或密码错误' })
    }
    if (!customer.status) return res.status(403).json({ success: false, message: '该账号已被禁用' })
    await db.execute("UPDATE customer SET last_login_time = datetime('now') WHERE id = ?", [customer.id])
    const token = jwt.sign({ customerId: customer.id }, process.env.CUSTOMER_JWT_SECRET, {
      expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '7d',
    })
    customer.last_login_time = new Date()
    res.json({ success: true, token, user: publicCustomer(customer) })
  } catch (error) { next(error) }
})

// 个人信息：昵称、头像、脱敏手机号、邮箱
router.get('/profile', requireCustomerAuth, async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [req.customer.id])
    res.json({ success: true, user: publicCustomer(rows[0]) })
  } catch (error) { next(error) }
})

// 修改个人信息：昵称 / 邮箱 / 头像（multipart）
router.put('/profile', requireCustomerAuth, upload.single('avatar'), async (req, res, next) => {
  let newAvatar = null
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [req.customer.id])
    const current = rows[0]
    if (!current) return res.status(404).json({ success: false, message: '账号不存在' })

    const updates = []
    const values = []
    if (Object.hasOwn(req.body, 'nickname')) {
      const nickname = String(req.body.nickname || '').trim()
      if (nickname.length > 50) throw Object.assign(new Error('昵称长度不能超过 50 个字符'), { status: 400 })
      updates.push('nickname = ?'); values.push(nickname || null)
    }
    if (Object.hasOwn(req.body, 'email')) {
      updates.push('email = ?'); values.push(normalizeEmail(req.body.email))
    }
    if (req.file) {
      newAvatar = await storageService.save(req.file, 'avatars')
      updates.push('avatar = ?'); values.push(newAvatar)
    }
    if (!updates.length) return res.status(400).json({ success: false, message: '没有可保存的更改' })

    updates.push("updated_at = datetime('now')")
    values.push(current.id)
    await db.execute(`UPDATE customer SET ${updates.join(', ')} WHERE id = ?`, values)

    const [updated] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [current.id])
    if (newAvatar && current.avatar) await storageService.delete(current.avatar)
    res.json({ success: true, message: '个人信息已更新', user: publicCustomer(updated[0]) })
  } catch (error) {
    if (newAvatar) await storageService.delete(newAvatar)
    next(error)
  }
})

// 修改密码：校验原密码后设置新密码
router.put('/password', requireCustomerAuth, async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, password FROM customer WHERE id = ?', [req.customer.id])
    const current = rows[0]
    if (!current) return res.status(404).json({ success: false, message: '账号不存在' })
    if (!req.body.current_password || !await bcrypt.compare(String(req.body.current_password), current.password)) {
      return res.status(400).json({ success: false, message: '原密码不正确' })
    }
    const newPassword = requiredPassword(req.body.new_password, '新密码')
    await db.execute("UPDATE customer SET password = ?, updated_at = datetime('now') WHERE id = ?", [
      await bcrypt.hash(newPassword, 12),
      current.id,
    ])
    res.json({ success: true, message: '密码已更新' })
  } catch (error) { next(error) }
})

export default router
