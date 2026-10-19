import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import { getCountryConfig, isIsoCountryCode, SHIPPING_COUNTRIES } from '../../src/data/address-countries.js'

const router = Router()
router.use(requireCustomerAuth)
router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }))
const fields = 'id, customer_id, country_code, recipient_name, phone_e164, address_line1, address_line2, city, state_code, postal_code, district, street, region_codes, label, delivery_instructions, validated_status, last_used_at, receiver_name, receiver_phone, province, detail_address, is_default, created_at, updated_at'
const text = (value, max = 100) => {
  const result=String(value ?? '').trim()
  if(Array.from(result).length>max)throw Object.assign(new Error(`输入长度不能超过 ${max} 个字符`),{status:400})
  return result
}
const optional = (value, max = 100) => text(value, max) || null
const countryPattern = /^[A-Z]{2}$/
const addressLimit = () => Math.min(Math.max(Number.parseInt(process.env.MAX_USER_ADDRESSES, 10) || 10, 1), 50)

function addressPayload(body = {}) {
  const code = text(body.country_code || 'CN', 2).toUpperCase()
  if (!countryPattern.test(code) || !isIsoCountryCode(code)) throw Object.assign(new Error('国家/地区代码无效'), { status: 400 })
  const config = getCountryConfig(code)
  const values = {
    recipient_name: text(body.recipient_name || body.receiver_name, 60),
    address_line1: text(body.address_line1 || body.detail_address, 100),
    detail_address: text(body.address_line1 || body.detail_address, 100),
    address_line2: text(body.address_line2, 100),
    city: text(body.city, 50), state_code: text(body.state_code || body.province, 50),
    postal_code: text(body.postal_code, 16),
  }
  for (const item of config.fields) {
    if (item.key === 'phone' || item.key === 'region' || item.key === 'label') continue
    const value = values[item.key]
    if (item.required && !value) throw Object.assign(new Error(`${item.label.zh}为必填项`), { status: 400 })
    if (value && item.pattern && !new RegExp(item.pattern, 'i').test(value)) throw Object.assign(new Error(`${item.label.zh}格式不正确`), { status: 400 })
    if (value && item.options && !item.options.some(option => option.code === value)) throw Object.assign(new Error(`${item.label.zh}选项无效`), { status: 400 })
  }
  if (code === 'CN' && !values.address_line1) throw Object.assign(new Error('详细地址为必填项'), { status: 400 })
  if (code === 'CN' && values.address_line1.length > 100) throw Object.assign(new Error('详细地址不能超过 100 个字符'), { status: 400 })
  const rawPhone = text(body.phone_e164 || body.receiver_phone || body.phone, 32)
  const parsed = parsePhoneNumberFromString(rawPhone, code)
  if (!parsed?.isValid()) throw Object.assign(new Error('电话号码格式不正确'), { status: 400 })
  if (code === 'CN' && parsed.country === 'CN' && !/^1[3-9]\d{9}$/.test(parsed.nationalNumber)) throw Object.assign(new Error('请输入有效的 11 位手机号'), { status: 400 })
  const codes = body.region_codes && typeof body.region_codes === 'object' ? body.region_codes : {}
  if (code === 'CN' && codes.province && !/^\d{6}$/.test(String(codes.province))) throw Object.assign(new Error('省级区划代码无效'), { status: 400 })
  if (code === 'CN' && codes.city && !/^\d{6}$/.test(String(codes.city))) throw Object.assign(new Error('市级区划代码无效'), { status: 400 })
  if (code === 'CN' && codes.district && !/^\d{6}$/.test(String(codes.district))) throw Object.assign(new Error('区县区划代码无效'), { status: 400 })
  const province = code === 'CN' ? text(body.province, 50) : ''
  const district = text(body.district, 50)
  const cityValue = values.city
  if (code === 'CN' && (!province || !cityValue)) throw Object.assign(new Error('请选择省份和城市'), { status: 400 })
  const line = values.address_line1
  return {
    country_code: code, recipient_name: values.recipient_name, phone_e164: parsed.number,
    address_line1: line, address_line2: values.address_line2, city: cityValue,
    state_code: values.state_code || province, postal_code: values.postal_code,
    district, street: text(body.street || (code === 'CN' ? line : ''), 100),
    region_codes: code === 'CN' ? JSON.stringify(codes) : null,
    label: optional(body.label, 10), delivery_instructions: optional(body.delivery_instructions, 200),
    is_default: [1, '1', true, 'true'].includes(body.is_default) ? 1 : 0,
    // Maintain old snapshots and screens until all readers use the country-aware fields.
    receiver_name: values.recipient_name, receiver_phone: code === 'CN' && parsed.country === 'CN' ? parsed.nationalNumber : parsed.number,
    province, detail_address: line,
  }
}
const parseId = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
async function setDefault(connection, customerId, id) {
  await connection.execute("UPDATE customer_address SET is_default = 0, updated_at = datetime('now') WHERE customer_id = ? AND is_default = 1", [customerId])
  await connection.execute("UPDATE customer_address SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND customer_id = ?", [id, customerId])
}
async function own(connection, customerId, id) {
  const [rows] = await connection.execute(`SELECT ${fields} FROM customer_address WHERE id = ? AND customer_id = ?`, [id, customerId])
  return rows[0]
}
const valuesSql = `INSERT INTO customer_address (customer_id,country_code,recipient_name,phone_e164,address_line1,address_line2,city,state_code,postal_code,district,street,region_codes,label,delivery_instructions,validated_status,receiver_name,receiver_phone,province,detail_address,is_default) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
const valuesFor = (customerId, item) => [customerId,item.country_code,item.recipient_name,item.phone_e164,item.address_line1,item.address_line2,item.city,item.state_code,item.postal_code,item.district,item.street,item.region_codes,item.label,item.delivery_instructions,'unverified',item.receiver_name,item.receiver_phone,item.province,item.detail_address]

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM customer_address WHERE customer_id = ? ORDER BY is_default DESC, id DESC`, [req.customer.id])
    res.json({ success: true, data: rows, shipping_countries: SHIPPING_COUNTRIES, max_addresses: addressLimit() })
  } catch (error) { next(error) }
})
router.post('/', async (req, res, next) => {
  const connection = await db.getConnection()
  try {
    const item = addressPayload(req.body)
    await connection.beginTransaction()
    const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM customer_address WHERE customer_id = ?', [req.customer.id])
    const limit = addressLimit()
    if (total >= limit) throw Object.assign(new Error(`每位顾客最多保存 ${limit} 个地址`), { status: 400 })
    const [result] = await connection.execute(valuesSql, valuesFor(req.customer.id, item))
    if (item.is_default || total === 0) await setDefault(connection, req.customer.id, result.insertId)
    await connection.commit()
    res.status(201).json({ success: true, message: '地址已添加', data: await own(db, req.customer.id, result.insertId) })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})
router.put('/:id', async (req, res, next) => {
  const id = parseId(req.params.id); if (!id) return res.status(404).json({ success:false,message:'地址不存在' })
  const connection = await db.getConnection()
  try {
    const item = addressPayload(req.body); await connection.beginTransaction()
    if (!await own(connection, req.customer.id, id)) throw Object.assign(new Error('地址不存在'), { status:404 })
    const [result] = await connection.execute(`UPDATE customer_address SET country_code=?,recipient_name=?,phone_e164=?,address_line1=?,address_line2=?,city=?,state_code=?,postal_code=?,district=?,street=?,region_codes=?,label=?,delivery_instructions=?,receiver_name=?,receiver_phone=?,province=?,detail_address=?,updated_at=datetime('now') WHERE id=? AND customer_id=?`, [...valuesFor(req.customer.id,item).slice(1,14),item.receiver_name,item.receiver_phone,item.province,item.detail_address,id,req.customer.id])
    if (item.is_default) await setDefault(connection, req.customer.id, id)
    await connection.commit()
    res.json({ success:true,message:'地址已更新',data:await own(db,req.customer.id,id) })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})
async function defaultAction(req,res,next) {
  const id=parseId(req.params.id);if(!id)return res.status(404).json({success:false,message:'地址不存在'})
  const connection=await db.getConnection();try{await connection.beginTransaction();if(!await own(connection,req.customer.id,id))throw Object.assign(new Error('地址不存在'),{status:404});await setDefault(connection,req.customer.id,id);await connection.commit();res.json({success:true,data:await own(db,req.customer.id,id)})}catch(error){await connection.rollback();next(error)}finally{connection.release()}
}
router.patch('/:id/default', defaultAction)
router.patch('/:id/used', async (req,res,next)=>{
  const id=parseId(req.params.id);if(!id)return res.status(404).json({success:false,message:'地址不存在'})
  try{const [result]=await db.execute("UPDATE customer_address SET last_used_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND customer_id=?",[id,req.customer.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'地址不存在'});res.json({success:true})}catch(error){next(error)}
})
// Legacy alias retained for clients deployed before the PATCH endpoint.
router.put('/:id/set-default', defaultAction)
router.delete('/:id',async(req,res,next)=>{
  const id=parseId(req.params.id);if(!id)return res.status(404).json({success:false,message:'地址不存在'})
  const connection=await db.getConnection();try{await connection.beginTransaction();const address=await own(connection,req.customer.id,id);if(!address)throw Object.assign(new Error('地址不存在'),{status:404});await connection.execute('DELETE FROM customer_address WHERE id=? AND customer_id=?',[id,req.customer.id]);if(address.is_default){const [rows]=await connection.execute('SELECT id FROM customer_address WHERE customer_id=? ORDER BY COALESCE(last_used_at,updated_at) DESC,id DESC LIMIT 1',[req.customer.id]);if(rows[0])await setDefault(connection,req.customer.id,rows[0].id)}await connection.commit();res.json({success:true,message:'地址已删除'})}catch(error){await connection.rollback();next(error)}finally{connection.release()}
})
export default router
