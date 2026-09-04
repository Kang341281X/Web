import jwt from 'jsonwebtoken'
import db from '../config/db.js'

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: '请先登录' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [rows] = await db.execute('SELECT id, username, role, status, must_change_password FROM admin WHERE id = ?', [payload.id])
    const admin = rows[0]
    if (!admin || !admin.status) return res.status(401).json({ success: false, message: '账号不存在或已被禁用' })
    req.admin = admin
    next()
  } catch {
    return res.status(401).json({ success: false, message: '登录已失效，请重新登录' })
  }
}

export function requireSuperAdmin(req, res, next) {
  if (req.admin?.role !== 'super_admin') {
    void writeOperationLog(req.admin?.id, 'unauthorized_admin_access', req.originalUrl)
    return res.status(403).json({ success: false, message: '仅超级管理员可访问' })
  }
  next()
}

export function requirePasswordChanged(req, res, next) {
  if (req.admin?.must_change_password) return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: '请先在个人中心修改初始密码' })
  next()
}

// 操作日志表将在后续模块创建；此处保留稳定调用点。
export async function writeOperationLog(adminId, action, detail) {
  console.warn(`[Audit placeholder] admin=${adminId ?? 'anonymous'} action=${action} detail=${detail}`)
}
