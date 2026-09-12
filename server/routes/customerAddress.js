import { Router } from 'express'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import { requiredText, optionalText, requiredPhone } from '../utils/customer.js'

const router = Router()

// 地址相关接口全部要求已登录顾客
router.use(requireCustomerAuth)

const selectFields = 'id, customer_id, receiver_name, receiver_phone, province, city, district, detail_address, is_default, created_at, updated_at'

// 请求体校验：收货人 / 收货手机号 / 详细地址必填，省市区选填
function addressPayload(body) {
  return {
    receiver_name: requiredText(body.receiver_name, '收货人', { min: 1, max: 50 }),
    receiver_phone: requiredPhone(body.receiver_phone),
    province: optionalText(body.province, 50),
    city: optionalText(body.city, 50),
    district: optionalText(body.district, 50),
    detail_address: requiredText(body.detail_address, '详细地址', { min: 1, max: 200 }),
    isDefault: [1, '1', true, 'true'].includes(body.is_default) ? 1 : 0,
  }
}

function parseAddressId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 归属校验：地址必须属于当前登录顾客。
// 用 id + customer_id 一起查，命中不了统一按「不存在」处理（404），
// 避免通过逐一尝试 id 探测出他人地址是否存在。
async function findOwnAddress(connection, customerId, id) {
  const [rows] = await connection.execute(
    `SELECT ${selectFields} FROM customer_address WHERE id = ? AND customer_id = ?`,
    [id, customerId]
  )
  return rows[0] || null
}

// 事务内互斥设置默认地址：先清掉该顾客已有的默认，再把目标置为默认。
// SQLite 的 CHECK 只能校验单行，跨行「唯一默认」约束由这里在应用层事务中保证，
// 且必须先清 0 再置 1，避免事务中途出现两条 is_default = 1。
async function setDefaultAddress(connection, customerId, id) {
  await connection.execute(
    "UPDATE customer_address SET is_default = 0, updated_at = datetime('now') WHERE customer_id = ? AND is_default = 1",
    [customerId]
  )
  await connection.execute(
    "UPDATE customer_address SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND customer_id = ?",
    [id, customerId]
  )
}

// 地址列表：默认地址排最前
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT ${selectFields} FROM customer_address WHERE customer_id = ? ORDER BY is_default DESC, id DESC`,
      [req.customer.id]
    )
    res.json({ success: true, data: rows })
  } catch (error) { next(error) }
})

// 新增地址；显式 is_default=1（或首条地址）时在同一事务里互斥设默认
router.post('/', async (req, res, next) => {
  const connection = await db.getConnection()
  try {
    const item = addressPayload(req.body)
    await connection.beginTransaction()
    const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM customer_address WHERE customer_id = ?', [req.customer.id])
    // 先按非默认插入，再交给 setDefaultAddress 统一置默认，避免瞬时两条默认
    const [result] = await connection.execute(
      'INSERT INTO customer_address (customer_id, receiver_name, receiver_phone, province, city, district, detail_address, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [req.customer.id, item.receiver_name, item.receiver_phone, item.province, item.city, item.district, item.detail_address]
    )
    // 首条地址自动成为默认，保证「只要存在地址就有唯一默认」的不变量
    if (item.isDefault === 1 || total === 0) await setDefaultAddress(connection, req.customer.id, result.insertId)
    await connection.commit()
    const [rows] = await db.execute(`SELECT ${selectFields} FROM customer_address WHERE id = ?`, [result.insertId])
    res.status(201).json({ success: true, message: '地址已添加', data: rows[0] })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

// 编辑地址：先校验归属，再整条更新；传 is_default=1 时同事务内互斥设默认
router.put('/:id', async (req, res, next) => {
  const id = parseAddressId(req.params.id)
  if (!id) return res.status(404).json({ success: false, message: '地址不存在' })
  const connection = await db.getConnection()
  try {
    const item = addressPayload(req.body)
    await connection.beginTransaction()
    if (!await findOwnAddress(connection, req.customer.id, id)) throw Object.assign(new Error('地址不存在'), { status: 404 })
    await connection.execute(
      "UPDATE customer_address SET receiver_name = ?, receiver_phone = ?, province = ?, city = ?, district = ?, detail_address = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?",
      [item.receiver_name, item.receiver_phone, item.province, item.city, item.district, item.detail_address, id, req.customer.id]
    )
    if (item.isDefault === 1) await setDefaultAddress(connection, req.customer.id, id)
    await connection.commit()
    const [rows] = await db.execute(`SELECT ${selectFields} FROM customer_address WHERE id = ?`, [id])
    res.json({ success: true, message: '地址已更新', data: rows[0] })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

// 单独设为默认：复用互斥事务逻辑
router.put('/:id/set-default', async (req, res, next) => {
  const id = parseAddressId(req.params.id)
  if (!id) return res.status(404).json({ success: false, message: '地址不存在' })
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    if (!await findOwnAddress(connection, req.customer.id, id)) throw Object.assign(new Error('地址不存在'), { status: 404 })
    await setDefaultAddress(connection, req.customer.id, id)
    await connection.commit()
    const [rows] = await db.execute(`SELECT ${selectFields} FROM customer_address WHERE id = ?`, [id])
    res.json({ success: true, message: '已设为默认地址', data: rows[0] })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

// 删除地址：先校验归属；若删的是默认地址且仍有其它地址，自动把最新一条设为默认
router.delete('/:id', async (req, res, next) => {
  const id = parseAddressId(req.params.id)
  if (!id) return res.status(404).json({ success: false, message: '地址不存在' })
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const address = await findOwnAddress(connection, req.customer.id, id)
    if (!address) throw Object.assign(new Error('地址不存在'), { status: 404 })
    await connection.execute('DELETE FROM customer_address WHERE id = ? AND customer_id = ?', [id, req.customer.id])
    if (address.is_default) {
      const [rest] = await connection.execute('SELECT id FROM customer_address WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [req.customer.id])
      if (rest[0]) await setDefaultAddress(connection, req.customer.id, rest[0].id)
    }
    await connection.commit()
    res.json({ success: true, message: '地址已删除' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

export default router
