import './config/env.js'
import Database from 'better-sqlite3'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

try {
  const sqlDirectory = new URL('./sql/', import.meta.url)
  const migrations = (await readdir(sqlDirectory)).filter(file => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    const sql = await readFile(new URL(`./sql/${migration}`, import.meta.url), 'utf8')
    db.exec(sql)
    console.log(`Applied ${migration}`)
  }
  console.log(`Migration completed: ${dbPath}`)
} finally {
  db.close()
}
