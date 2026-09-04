import './config/env.js'
import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'

const connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
}
const database = process.env.DB_NAME || 'shopping_admin'
const connection = await mysql.createConnection(connectionOptions)

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await connection.changeUser({ database })
  await connection.query(await readFile(new URL('./sql/001_admin.sql', import.meta.url), 'utf8'))
  console.log(`Migration completed: ${database}.admin`)
} finally {
  await connection.end()
}
