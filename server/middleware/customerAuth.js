import jwt from 'jsonwebtoken'
import db from '../config/db.js'

// 顾客端独立认证
//
// 与管理端（middleware/auth.js）刻意隔离，防止两类 token 混用：
//   1) 密钥不同：使用 CUSTOMER_JWT_SECRET，而非管理端的 JWT_SECRET；
//   2) payload 不同：顾客使用 { customerId }，管理端使用 { id, role }。
// 因此顾客 token 无法通过管理端校验，也无法用管理员 token 访问顾客接口。
export async function requireCustomerAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: '请先登录' })
  try {
    const payload = jwt.verify(token, process.env.CUSTOMER_JWT_SECRET)
    if (!payload.customerId) return res.status(401).json({ success: false, message: '登录已失效，请重新登录' })
    const [rows] = await db.execute('SELECT id, phone, email, nickname, avatar, status FROM customer WHERE id = ?', [payload.customerId])
    const customer = rows[0]
    if (!customer || !customer.status) return res.status(401).json({ success: false, message: '账号不存在或已被禁用' })
    req.customer = customer
    next()
  } catch {
    return res.status(401).json({ success: false, message: '登录已失效，请重新登录' })
  }
}

export default { requireCustomerAuth }
