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

// ── 事务互斥队列 ──────────────────────────────────────────
// better-sqlite3 全进程只有一个真实连接：并发请求各自 getConnection() 后，
// 第二个 beginTransaction() 会因"已在事务中"失败，它 catch 里的 rollback()
// 还会把第一个请求尚未提交的事务一并回滚（"下单报错但库存已扣"的脏数据来源）。
// 用 Promise 链实现进程内互斥：beginTransaction() 先排队等锁、拿到锁后才真正
// 执行 BEGIN；commit()/rollback()/release() 任一收尾动作放行下一个等待者。
// asyncDb.execute() 的非事务调用不经过此锁，仍可随时并发执行。
let txQueueTail = Promise.resolve()

function acquireTxLock() {
  // 把新的等待者挂到队尾；返回的 Promise 在前面所有持锁者收尾后 resolve 出
  // 「释放函数」，调用它即放行后续等待者
  const prevTail = txQueueTail
  let releaseLock
  txQueueTail = new Promise(resolve => { releaseLock = resolve })
  return prevTail.then(() => releaseLock)
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

  /** 兼容 mysql2 的 db.getConnection()，提供事务接口。
   *  事务在进程内互斥：同一时刻只有一组 beginTransaction()...commit()/rollback()
   *  在执行，其余调用方在 beginTransaction() 处排队等锁。 */
  getConnection() {
    // 每个「连接」是独立的锁持有凭证（底层仍共享同一个 better-sqlite3 连接）
    let releaseTxLock = null
    const settleTxLock = () => {
      if (releaseTxLock) {
        const release = releaseTxLock
        releaseTxLock = null
        release()
      }
    }
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
        if (releaseTxLock) throw new Error('当前连接已在事务中，请先 commit()/rollback()')
        // 排队等前一个事务收尾、拿到锁后才真正 BEGIN，
        // 避免第二个 BEGIN 报"已在事务中"、其 rollback 误伤第一个事务
        releaseTxLock = await acquireTxLock()
        try {
          db.exec('BEGIN')
        } catch (error) {
          // BEGIN 失败必须立即放行队列，否则会永久阻塞后续事务
          settleTxLock()
          throw error
        }
      },
      async commit() {
        // 提交失败时事务多半仍处于打开状态，此时不放锁（否则下一个排队者的
        // BEGIN 会撞上未关闭的事务），交给 catch 里的 rollback()/release() 收尾
        db.exec('COMMIT')
        settleTxLock()
      },
      async rollback() {
        try { db.exec('ROLLBACK') } catch { /* 事务可能已关闭 */ } finally { settleTxLock() }
      },
      release() {
        // better-sqlite3 是单连接，无需真正归还；这里只负责放行事务互斥队列
        settleTxLock()
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
