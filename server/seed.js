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
    await db.execute('INSERT INTO admin (username, password, role, real_name, must_change_password) VALUES (?, ?, ?, ?, 0)', [username, await bcrypt.hash('123456', 12), role, realName])
    console.log(`Created ${username}`)
  } else {
    // 确保密码和 must_change_password 为已知值
    await db.execute('UPDATE admin SET password = ?, must_change_password = 0 WHERE username = ?', [await bcrypt.hash('123456', 12), username])
    console.log(`Reset ${username}`)
  }
}

const settings = [
  ['contact_email', 'contact@example-shop.com', '联系邮箱'],
  ['contact_phone', '400-800-1234', '联系电话'],
]
for (const [key, value, label] of settings) {
  const [existing] = await db.execute('SELECT id FROM site_setting WHERE setting_key = ?', [key])
  if (!existing.length) {
    await db.execute('INSERT INTO site_setting (setting_key, setting_value, setting_label) VALUES (?, ?, ?)', [key, value, label])
    console.log(`Created setting ${key}`)
  }
}

await db.end()
