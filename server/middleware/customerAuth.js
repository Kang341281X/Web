import jwt from 'jsonwebtoken'
import db from '../config/db.js'

// 顾客端独立认证
//
// 与管理端（middleware/auth.js）刻意隔离，防止两类 token 混用：
//   1) 密钥不同：使用 CUSTOMER_JWT_SECRET，而非管理端的 JWT_SECRET；
//   2) payload 不同：顾客使用 { customerId }，管理端使用 { id, role }。
// 因此顾客 token 无法通过管理端校验，也无法用管理员 token 访问顾客接口。

// 校验 token 并读出顾客资料，失败返回 null（不区分「没带 token」和「token 失效」，由调用方决定怎么处理）
async function resolveCustomer(token) {
  const payload = jwt.verify(token, process.env.CUSTOMER_JWT_SECRET)
  if (!payload.customerId) return null
  const [rows] = await db.execute('SELECT id, phone, username, email, avatar, status FROM customer WHERE id = ?', [payload.customerId])
  const customer = rows[0]
  return customer && customer.status ? customer : null
}

export async function requireCustomerAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: '请先登录' })
  try {
    const customer = await resolveCustomer(token)
    if (!customer) return res.status(401).json({ success: false, message: '账号不存在或已被禁用' })
    req.customer = customer
    next()
  } catch {
    return res.status(401).json({ success: false, message: '登录已失效，请重新登录' })
  }
}

/**
 * 可选登录：带了有效顾客 token 就挂上 req.customer，否则按游客继续。
 *
 * 用途：前台商品详情页的评论列表是公开接口，但登录后需要标出「哪些评论是我写的」以便展示编辑/删除按钮。
 *
 * 注意：这里「绝不」返回 401。本地残留一个过期 token 是很常见的情况，
 * 公开接口不能因此打不开——那会让整个商品详情页白屏，属于把登录态问题放大成可用性问题。
 */
export async function optionalCustomerAuth(req, _res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (token) {
    try {
      const customer = await resolveCustomer(token)
      if (customer) req.customer = customer
    } catch { /* token 无效/过期：按游客处理 */ }
  }
  next()
}

export default { requireCustomerAuth, optionalCustomerAuth }
