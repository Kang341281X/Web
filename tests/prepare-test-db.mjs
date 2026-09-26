/**
 * 测试数据库准备脚本（playwright webServer 启动后端前执行，见 playwright.config.js）。
 *
 * 做三件事：
 *  1. 删除上一轮的 server/test.db*，把 server/data.db 复制成新副本（连同 WAL/SHM），
 *     保证每轮测试都从同一份基线数据（商品 / 分类 / 运费 / 演示账号）出发；
 *  2. 在副本上准备两个已知口令的测试管理员：
 *       superadmin / Test123456（super_admin 角色）
 *       admin      / Test123456（普通 admin 角色）
 *     并把 must_change_password 置 0，跳过「首次登录必须改密」拦截；
 *  3. 做基线完整性检查：至少有一个有库存的上架商品、一条运费记录，否则明确报错。
 *
 * 后端进程随后以 DB_PATH=server/test.db 启动，测试产生的所有数据只落在这份副本上。
 */
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const sourceDb = resolve(root, 'server/data.db')
const testDb = resolve(root, 'server/test.db')

if (!existsSync(sourceDb)) {
  throw new Error(`基线数据库不存在：${sourceDb}。请先 npm run db:migrate（或启动一次后端）后再运行测试。`)
}

for (const file of [testDb, `${testDb}-wal`, `${testDb}-shm`]) {
  rmSync(file, { force: true })
}
copyFileSync(sourceDb, testDb)
if (existsSync(`${sourceDb}-wal`)) copyFileSync(`${sourceDb}-wal`, `${testDb}-wal`)
if (existsSync(`${sourceDb}-shm`)) copyFileSync(`${sourceDb}-shm`, `${testDb}-shm`)

const db = new Database(testDb)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 10000')

// 测试管理员：不存在则创建，存在则重置为已知口令/角色/状态
const passwordHash = bcrypt.hashSync('Test123456', 12)
const upsertAdmin = db.prepare(`
  INSERT INTO admin (username, password, role, real_name, must_change_password, status)
  VALUES (?, ?, ?, ?, 0, 1)
  ON CONFLICT(username) DO UPDATE SET
    password = excluded.password, role = excluded.role,
    must_change_password = 0, status = 1
`)
upsertAdmin.run('superadmin', passwordHash, 'super_admin', '测试超管')
upsertAdmin.run('admin', passwordHash, 'admin', '测试管理员')

// 基线检查：测试依赖「有库存的上架商品」与「运费记录」
const productCount = db.prepare('SELECT COUNT(*) AS c FROM product WHERE status = 1 AND stock > 0').get().c
if (!productCount) throw new Error('基线数据库中没有有库存的上架商品，无法运行下单类测试')
const rateCount = db.prepare('SELECT COUNT(*) AS c FROM shipping_rate').get().c
if (!rateCount) throw new Error('基线数据库中没有运费记录，无法运行下单类测试')

db.close()
console.log(`[prepare-test-db] 已从 data.db 准备测试数据库 ${testDb}（管理员: superadmin/admin，口令 Test123456）`)
