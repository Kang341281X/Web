import express from 'express'
import Database from 'better-sqlite3'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = 3001

// 中间件
app.use(cors())
app.use(express.json())

// ===== 初始化 SQLite 数据库 =====
const db = new Database(join(__dirname, 'data.db'))
db.pragma('journal_mode = WAL')

// 创建 admin_users 表
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    email       TEXT,
    role        TEXT DEFAULT 'admin',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login  DATETIME
  )
`)

// 插入默认管理员账号（如果不存在）
const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin')
if (!existing) {
  const hashedPassword = bcrypt.hashSync('admin123', 10)
  db.prepare(`
    INSERT INTO admin_users (username, password, email, role)
    VALUES (?, ?, ?, ?)
  `).run('admin', hashedPassword, 'admin@craftora.com', 'admin')
  console.log('[DB] 默认管理员账号已创建: admin / admin123')
}

// ===== 登录接口 =====
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' })
  }

  // SQL 查询用户
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username)

  if (!user) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' })
  }

  // 验证密码
  const isMatch = bcrypt.compareSync(password, user.password)
  if (!isMatch) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' })
  }

  // 更新最后登录时间
  db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)

  // 生成简单 token（base64 编码 userId + 时间戳）
  const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64')

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    }
  })
})

// ===== 获取当前用户信息 =====
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录' })
  }
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8')
    const [userId] = decoded.split(':')
    const user = db.prepare('SELECT id, username, email, role, created_at, last_login FROM admin_users WHERE id = ?').get(userId)
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }
    res.json({ success: true, user })
  } catch {
    return res.status(401).json({ success: false, message: 'Token 无效' })
  }
})

// ===== 退出登录 =====
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: '已退出登录' })
})

// ===== 启动服务器 =====
app.listen(PORT, () => {
  console.log(`\n[Server] 后端服务已启动: http://localhost:${PORT}`)
  console.log(`[Server] API 端点:`)
  console.log(`  POST /api/auth/login  - 管理员登录`)
  console.log(`  GET  /api/auth/me     - 获取当前用户`)
  console.log(`  POST /api/auth/logout - 退出登录\n`)
})
