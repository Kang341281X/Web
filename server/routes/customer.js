import { Router } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import storageService from '../services/storageService.js'
import { consumeCaptcha } from '../services/captchaService.js'
import { publicCustomer, requiredPhone, requiredUsername, requiredPassword, normalizeEmail, isUniqueViolation } from '../utils/customer.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const fields = 'id, phone, username, email, avatar, status, last_login_time, created_at, updated_at'

// 注册：用户名 + 手机号 + 密码（+ 可选邮箱）
// 用户名是登录凭证（唯一）兼展示名（昵称），手机号仍是内部唯一标识 —— 两者各自校验、各自报错，互不混用。
// 注册不需要验证码（人机校验只用于登录）；注册成功直接签发 token，注册完即是登录态。
router.post('/register', async (req, res, next) => {
  try {
    const username = requiredUsername(req.body.username)
    const phone = requiredPhone(req.body.phone)
    const password = requiredPassword(req.body.password)
    const email = normalizeEmail(req.body.email)

    const [sameUsername] = await db.execute('SELECT id FROM customer WHERE username = ?', [username])
    if (sameUsername[0]) return res.status(409).json({ success: false, message: '用户名已被占用' })

    const [samePhone] = await db.execute('SELECT id FROM customer WHERE phone = ?', [phone])
    if (samePhone[0]) return res.status(409).json({ success: false, message: '该手机号已注册' })

    const hashed = await bcrypt.hash(password, 12)
    try {
      const [result] = await db.execute(
        'INSERT INTO customer (phone, username, email, password) VALUES (?, ?, ?, ?)',
        [phone, username, email, hashed]
      )
      const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [result.insertId])
      // 注册即登录：与登录接口同口径记录登录时间并签发 token，前端无需再走一次带验证码的登录
      await db.execute("UPDATE customer SET last_login_time = datetime('now') WHERE id = ?", [result.insertId])
      const token = jwt.sign({ customerId: result.insertId }, process.env.CUSTOMER_JWT_SECRET, {
        expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '7d',
      })
      res.status(201).json({ success: true, message: '注册成功', token, user: publicCustomer(rows[0]) })
    } catch (error) {
      // 并发注册时可能同时通过上面的存在性检查，最终由唯一索引兜底。
      // username 与 phone 各有一个唯一索引，按报错信息区分到底撞的是哪一个。
      if (isUniqueViolation(error)) {
        return res.status(409).json({ success: false, message: /username/i.test(error.message || '') ? '用户名已被占用' : '该手机号已注册' })
      }
      throw error
    }
  } catch (error) { next(error) }
})

// 登录：用户名 + 密码（先过人机校验，再验账号密码），通过后签发顾客专用 token（payload 为 { customerId }）
router.post('/login', async (req, res, next) => {
  try {
    // 1) 验证码：不通过就直接结束，绝不碰数据库。
    //    这样既省掉一次昂贵的 bcrypt 比对，也不会通过「响应快慢」泄漏用户名是否已注册。
    //    字段名以 captchaId / captchaText 为准，同时兼容库内其他接口的 snake_case 风格。
    const captchaId = req.body.captchaId ?? req.body.captcha_id
    const captchaText = req.body.captchaText ?? req.body.captcha_text
    if (consumeCaptcha(captchaId, captchaText) !== 'ok') {
      // 400 而非 401：401 在本项目语义固定为「用户名或密码错误」。
      // 带 code 是为了让前端能可靠地区分「该刷新验证码」和其他失败，不必去匹配中文提示。
      return res.status(400).json({ success: false, code: 'CAPTCHA_INVALID', message: '验证码错误或已过期' })
    }

    // 2) 账号密码：登录账号是 username；phone 只作为内部唯一标识保留，不再参与登录
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    const [rows] = await db.execute(`SELECT ${fields}, password FROM customer WHERE username = ?`, [username])
    const customer = rows[0]
    if (!customer || !await bcrypt.compare(password, customer.password)) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' })
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

// 个人信息：用户名、头像、完整手机号、邮箱
router.get('/profile', requireCustomerAuth, async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [req.customer.id])
    res.json({ success: true, user: publicCustomer(rows[0]) })
  } catch (error) { next(error) }
})

// 修改个人信息：手机号 / 邮箱 / 头像（multipart）。用户名是登录凭证，注册后不可再改
router.put('/profile', requireCustomerAuth, upload.single('avatar'), async (req, res, next) => {
  let newAvatar = null
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM customer WHERE id = ?`, [req.customer.id])
    const current = rows[0]
    if (!current) return res.status(404).json({ success: false, message: '账号不存在' })

    const updates = []
    const values = []
    if (Object.hasOwn(req.body, 'email')) {
      updates.push('email = ?'); values.push(normalizeEmail(req.body.email))
    }
    if (Object.hasOwn(req.body, 'phone')) {
      const phone = requiredPhone(req.body.phone)
      // 只有真的改了才查重，否则「原样提交」会被自己占用而误报「已被使用」
      if (phone !== current.phone) {
        const [others] = await db.execute('SELECT id FROM customer WHERE phone = ? AND id <> ?', [phone, current.id])
        if (others[0]) return res.status(409).json({ success: false, message: '该手机号已被其他账号使用' })
      }
      updates.push('phone = ?'); values.push(phone)
    }
    if (req.file) {
      newAvatar = await storageService.save(req.file, 'avatars')
      updates.push('avatar = ?'); values.push(newAvatar)
    }
    if (!updates.length) return res.status(400).json({ success: false, message: '没有可保存的更改' })

    updates.push("updated_at = datetime('now')")
    values.push(current.id)
    try {
      await db.execute(`UPDATE customer SET ${updates.join(', ')} WHERE id = ?`, values)
    } catch (error) {
      // 并发修改时上面的查重可能失效，最终由唯一索引兜底（手机号/用户名各自有唯一索引）
      if (isUniqueViolation(error)) {
        if (newAvatar) await storageService.delete(newAvatar)
        return res.status(409).json({ success: false, message: /phone/i.test(error.message || '') ? '该手机号已被其他账号使用' : '用户名已被占用' })
      }
      throw error
    }

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
