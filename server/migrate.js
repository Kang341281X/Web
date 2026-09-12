import './config/env.js'
import Database from 'better-sqlite3'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ---------------------------------------------------------------------------
// 启动前快照：记录「升级到迁移记录表机制之前」哪些表已经有数据。
//
// 历史背景：老版本 migrate.js 不做执行记录，只对 ALTER TABLE ADD COLUMN 做幂等判断，
// 其余语句（尤其是 006_seed_catalog.sql / 009_reseed_catalog.sql 里的
// 「DELETE 整表 + 重新插入演示数据」）每次启动都会重复执行，会把管理员在后台
// 维护的商品/分类清空，属于严重的数据丢失 bug。
//
// 升级后必须做一次性兼容：如果某个「清空整表」的脚本，其目标表在本次启动前
// 就已经有数据，说明它早就执行过（且数据可能已被管理员修改），此时只能把它
// 标记为「已执行」而不能重跑。因此要在创建 schema_migrations 之前先做这份快照。
// ---------------------------------------------------------------------------
function listUserTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map(row => row.name)
}

function isValidTableName(table) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table)
}

function tableExists(table) {
  if (!isValidTableName(table)) return false
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

function tableHasRows(table) {
  if (!tableExists(table)) return false
  return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c > 0
}

const tablesWithDataAtStartup = new Set(
  listUserTables()
    .filter(table => tableHasRows(table))
    .map(table => table.toLowerCase())
)

// ---------------------------------------------------------------------------
// 迁移记录表：每个 .sql 文件成功执行一次后就写入文件名，下次启动直接跳过。
// 这是迁移器自身的元数据表，需要先于所有业务迁移创建（业务迁移 001-031 的处理
// 都依赖它来判断「是否已执行过」）。同时 server/sql/031_schema_migrations.sql
// 保留同名建表语句，保证结构变更在 sql 目录里同样可追溯、可重复执行。
//
// isLegacyUpgrade：本次启动前还没有这张表，说明是从「无记录」的老机制第一次升级。
// 只有这一次升级需要做下面的历史兼容回填；升级完成后，新写的破坏性迁移仍会
// 按正常流程执行（由开发者自行保证其幂等性）。
// ---------------------------------------------------------------------------
const isLegacyUpgrade = !db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
  .get()

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)

const isMigrationApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE filename = ?')
const markMigrationApplied = db.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)')

// 去掉 SQL 注释后再做语句特征扫描，避免注释里出现的示例 SQL（如 024 说明中提到的
// DROP TABLE、008 说明中提到的 ALTER TABLE）被误判为真实语句。
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ')
}

// 提取 SQL 中的 ALTER TABLE xxx ADD [COLUMN] yyy 语句，用于幂等双保险检测
function extractAddColumns(sql) {
  const result = []
  const pattern = /ALTER\s+TABLE\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/gi
  let match
  while ((match = pattern.exec(stripSqlComments(sql))) !== null) {
    result.push({ table: match[1].toLowerCase(), column: match[2].toLowerCase() })
  }
  return result
}

function columnExists(table, column) {
  if (!isValidTableName(table)) return false
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  return columns.some(col => String(col.name).toLowerCase() === column)
}

// 提取「可能造成数据丢失」的语句所涉及的表：
//   - 不带 WHERE 的整表删除：DELETE FROM table;
//   - 删表：DROP TABLE [IF EXISTS] table;
// 带 WHERE 的 DELETE（如 011/012 清理个别设置项）不在此列，它们本身是幂等且安全的。
function extractDestructiveTargets(sql) {
  const stripped = stripSqlComments(sql)
  const tables = new Set()
  const deletePattern = /DELETE\s+FROM\s+["'`]?([A-Za-z0-9_]+)["'`]?\s*;/gi
  const dropPattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/gi
  let match
  while ((match = deletePattern.exec(stripped)) !== null) {
    tables.add(match[1].toLowerCase())
  }
  while ((match = dropPattern.exec(stripped)) !== null) {
    tables.add(match[1].toLowerCase())
  }
  return [...tables]
}

// 单个 .sql 文件的执行 + 记录写入放在同一事务里：要么都成功、要么都回滚，
// 避免出现「SQL 执行了但没记上」导致下次重复执行的情况。
const applyMigration = db.transaction((filename, sql) => {
  db.exec(sql)
  markMigrationApplied.run(filename)
})

try {
  const sqlDirectory = new URL('./sql/', import.meta.url)
  const migrations = (await readdir(sqlDirectory)).filter(file => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    // 主逻辑：已记录过执行成功的文件直接跳过
    if (isMigrationApplied.get(migration)) {
      console.log(`Skipped ${migration} (already applied)`)
      continue
    }

    const sql = await readFile(new URL(`./sql/${migration}`, import.meta.url), 'utf8')

    // 历史兼容（仅限第一次从老机制升级）：目标表在升级前就已有数据 →
    // 该「清空整表」脚本早已执行过，只补记标记，绝不重跑，
    // 避免历史环境一升级就清空现有商品/分类。
    if (isLegacyUpgrade) {
      const destructiveTargets = extractDestructiveTargets(sql)
      const dataWouldBeLost = destructiveTargets.some(table => tablesWithDataAtStartup.has(table))
      if (dataWouldBeLost) {
        markMigrationApplied.run(migration)
        console.log(`Marked ${migration} as applied (kept existing data in: ${destructiveTargets.join(', ')})`)
        continue
      }
    }

    // 双保险：目标列全部已存在 → 本文件结构变更已生效，补记后跳过
    const addColumns = extractAddColumns(sql)
    if (addColumns.length && addColumns.every(({ table, column }) => columnExists(table, column))) {
      markMigrationApplied.run(migration)
      console.log(`Skipped ${migration} (column already exists)`)
      continue
    }

    applyMigration(migration, sql)
    console.log(`Applied ${migration}`)
  }
  console.log(`Migration completed: ${dbPath}`)
} finally {
  db.close()
}
