import './config/env.js'
import mysql from 'mysql2/promise'
import { readdir, readFile } from 'node:fs/promises'

const connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  // 仅用于执行仓库内受控的迁移 SQL，运行时连接池不启用此选项。
  multipleStatements: true
}
const database = process.env.DB_NAME || 'shopping_admin'
const connection = await mysql.createConnection(connectionOptions)

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await connection.changeUser({ database })
  const sqlDirectory = new URL('./sql/', import.meta.url)
  const migrations = (await readdir(sqlDirectory)).filter(file => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    await connection.query(await readFile(new URL(`./sql/${migration}`, import.meta.url), 'utf8'))
    console.log(`Applied ${migration}`)
  }
  console.log(`Migration completed: ${database}`)
} finally {
  await connection.end()
}
