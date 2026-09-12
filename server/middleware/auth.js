import jwt from 'jsonwebtoken'
import db from '../config/db.js'

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: '请先登录' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [rows] = await db.execute('SELECT id, username, role, real_name, status, must_change_password FROM admin WHERE id = ?', [payload.id])
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
    void writeOperationLog(req.admin?.id, 'unauthorized_admin_access', req.originalUrl, req)
    return res.status(403).json({ success: false, message: '仅超级管理员可访问' })
  }
  next()
}

export function requirePasswordChanged(req, res, next) {
  if (req.admin?.must_change_password) return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: '请先在个人中心修改初始密码' })
  next()
}

// 操作日志映射：action → { module, type }
const LOG_MAP = {
  login: { module: '登录', type: '登录' },
  create_product: { module: '商品管理', type: '新增商品' },
  update_product: { module: '商品管理', type: '编辑商品' },
  delete_products: { module: '商品管理', type: '删除商品' },
  import_products: { module: '商品管理', type: '导入确认' },
  import_products_online: { module: '商品管理', type: '在线表格批量新增' },
  export_products: { module: '商品管理', type: '导出' },
  create_category: { module: '分类管理', type: '新增分类' },
  update_category: { module: '分类管理', type: '编辑分类' },
  delete_category: { module: '分类管理', type: '删除分类' },
  update_settings: { module: '其他设置', type: '修改设置' },
  create_admin: { module: '管理员管理', type: '新增管理员' },
  update_admin: { module: '管理员管理', type: '编辑管理员' },
  delete_admin: { module: '管理员管理', type: '删除管理员' },
  reset_admin_password: { module: '管理员管理', type: '重置密码' },
  update_profile: { module: '其他设置', type: '修改个人信息' },
  unauthorized_admin_access: { module: '其他设置', type: '越权访问' },
  update_customer_status: { module: '顾客管理', type: '启用/禁用顾客' },
  update_order_status: { module: '订单管理', type: '更新订单状态' },
}

export async function writeOperationLog(adminId, action, detail, req) {
  try {
    const mapping = LOG_MAP[action] || { module: '其他', type: action }
    let username = null
    if (adminId) {
      const [rows] = await db.execute('SELECT username FROM admin WHERE id = ?', [adminId])
      username = rows[0]?.username || null
    }
    const ip = req?.ip || req?.socket?.remoteAddress || null
    await db.execute(
      'INSERT INTO operation_log (admin_id, admin_username, operation_type, operation_module, operation_desc, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [adminId || null, username, mapping.type, mapping.module, String(detail || '').slice(0, 500), ip]
    )
  } catch (error) {
    console.error('写入操作日志失败:', error)
  }
}
