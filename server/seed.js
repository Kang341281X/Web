import './config/env.js'
import bcrypt from 'bcryptjs'
import db from './config/db.js'

const accounts = [
  ['superadmin', 'super_admin', '超级管理员'],
  ['admin', 'admin', '管理员'],
  ['admin01', 'admin', '管理员01'],
  ['admin02', 'admin', '管理员02']
]
for (const [username, role, realName] of accounts) {
  const [existing] = await db.execute('SELECT id FROM admin WHERE username = ?', [username])
  if (!existing.length) {
    await db.execute('INSERT INTO admin (username, password, role, real_name, must_change_password) VALUES (?, ?, ?, ?, 1)', [username, await bcrypt.hash('123456', 12), role, realName])
    console.log(`Created ${username}`)
  }
}
await db.end()
