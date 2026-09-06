import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 将 better-sqlite3 的同步 API 包装为兼容 mysql2 的异步接口
// mysql2: db.execute(sql, params) => Promise<[rows, fields]>
// 本包装: 返回 [rows]，其中 SELECT 返回行数组，INSERT/UPDATE/DELETE 返回 { insertId, affectedRows, changedRows }

function adaptResult(result) {
  if (result && typeof result === 'object' && 'lastInsertRowid' in result) {
    return { insertId: Number(result.lastInsertRowid), affectedRows: result.changes, changedRows: result.changes }
  }
  return result
}

// better-sqlite3 的 prepare().all() 返回行数组，prepare().run() 返回运行结果
// 需要根据 SQL 类型自动判断
function isSelectLike(sql) {
  const trimmed = sql.trimStart().replace(/^\(/, '').trimStart()
  const keyword = trimmed.slice(0, 7).toUpperCase()
  return keyword.startsWith('SELECT') || keyword.startsWith('PRAGMA') || keyword.startsWith('WITH')
}

const asyncDb = {
  /** 兼容 mysql2 的 db.execute(sql, params) => [rows] */
  async execute(sql, params = []) {
    const safeParams = params.map(p => {
      if (p === undefined) return null
      if (p instanceof Date) return p.toISOString()
      if (typeof p === 'boolean') return p ? 1 : 0
      return p
    })
    const stmt = db.prepare(sql)
    if (isSelectLike(sql)) {
      const rows = stmt.all(...safeParams)
      return [rows]
    }
    // 非 SELECT：返回 result 对象
    const info = stmt.run(...safeParams)
    return [adaptResult(info)]
  },

  /** 兼容 mysql2 的 db.getConnection()，提供事务接口 */
  getConnection() {
    return Promise.resolve({
      async execute(sql, params = []) {
        const safeParams = params.map(p => {
          if (p === undefined) return null
          if (p instanceof Date) return p.toISOString()
          if (typeof p === 'boolean') return p ? 1 : 0
          return p
        })
        const stmt = db.prepare(sql)
        if (isSelectLike(sql)) {
          return [stmt.all(...safeParams)]
        }
        return [adaptResult(stmt.run(...safeParams))]
      },
      async beginTransaction() {
        db.exec('BEGIN')
      },
      async commit() {
        db.exec('COMMIT')
      },
      async rollback() {
        try { db.exec('ROLLBACK') } catch { /* 事务可能已关闭 */ }
      },
      release() {
        // better-sqlite3 是单连接，无需释放
      },
    })
  },

  /** 直接暴露底层 Database 供高级用法使用 */
  raw: db,

  /** 关闭数据库连接 */
  async end() {
    db.close()
  },
}

export default asyncDb
