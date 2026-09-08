import './config/env.js'
import Database from 'better-sqlite3'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 提取 SQL 中的 ALTER TABLE xxx ADD [COLUMN] yyy 语句，用于幂等检测
function extractAddColumns(sql) {
  const result = []
  const pattern = /ALTER\s+TABLE\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/gi
  let match
  while ((match = pattern.exec(sql)) !== null) {
    result.push({ table: match[1].toLowerCase(), column: match[2].toLowerCase() })
  }
  return result
}

function columnExists(table, column) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return false
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  return columns.some(col => String(col.name).toLowerCase() === column)
}

try {
  const sqlDirectory = new URL('./sql/', import.meta.url)
  const migrations = (await readdir(sqlDirectory)).filter(file => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    const sql = await readFile(new URL(`./sql/${migration}`, import.meta.url), 'utf8')
    const addColumns = extractAddColumns(sql)
    // 目标列全部已存在 → 跳过本文件，保证幂等（PRAGMA table_info 检测）
    if (addColumns.length && addColumns.every(({ table, column }) => columnExists(table, column))) {
      console.log(`Skipped ${migration} (column already exists)`)
      continue
    }
    db.exec(sql)
    console.log(`Applied ${migration}`)
  }
  console.log(`Migration completed: ${dbPath}`)
} finally {
  db.close()
}
