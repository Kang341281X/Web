/**
 * 接口级测试的公共辅助。
 *
 * 设计要点：
 *  - 全部通过 HTTP 调用后端（playwright webServer 拉起的实例），不 import 服务端代码，
 *    保证测的是「真实进程 + 真实数据库副本」的行为；
 *  - 每个请求带随机 X-Forwarded-For（后端 trust proxy=1，限流按 req.ip 计数），
 *    用例互不消耗登录/注册限流额度，可无限次重复运行；
 *  - 每个用例注册独立顾客（用户名/手机号全局唯一），数据互不干扰；
 *  - openTestDb() 提供对 server/test.db 的直连能力，仅用于无法通过 API 表达的
 *    前置条件（如把评论 created_at 回拨 25 小时）。
 */
import Database from 'better-sqlite3'
import { resolve } from 'node:path'

export const API_BASE = `http://localhost:${process.env.TEST_BACKEND_PORT || 3999}`

let ipCounter = 0
let nameCounter = 0

/** 每次调用生成一个不重复的「虚拟客户端 IP」，用于绕开按 IP 的登录/注册限流计数 */
export function nextIp() {
  ipCounter += 1
  const n = (Date.now() + ipCounter) % 65536
  return `10.${(n >> 8) & 0xff}.${n & 0xff}.${(ipCounter % 250) + 1}`
}

function uniqueId() {
  nameCounter += 1
  return `${Date.now().toString(36)}${nameCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** 基础请求封装：返回 { status, data }，data 为解析后的 JSON（解析失败为 null） */
export async function api(path, { method = 'GET', body, token, ip = nextIp(), headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try { data = await response.json() } catch { /* 非 JSON 响应 */ }
  return { status: response.status, data }
}

/** 注册一个全新顾客（注册即登录，返回 token）；用户名/手机号每次唯一，撞车自动重试 */
export async function registerCustomer() {
  const password = 'Pass123456'
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = uniqueId()
    const username = `t${id}`.slice(0, 20)
    const phone = `13${String((Date.now() % 800000000) + 100000000 + nameCounter).slice(0, 9)}`
    const { status, data } = await api('/api/customer/register', { method: 'POST', body: { username, phone, password } })
    if (status === 201) return { token: data.token, id: data.user.id, username, phone, password }
    // 与基线数据里的既有手机号/用户名撞车：换一组重来
    if (status !== 409) throw new Error(`测试顾客注册失败: HTTP ${status} ${JSON.stringify(data)}`)
  }
  throw new Error('测试顾客注册失败：连续 5 次用户名/手机号冲突')
}

/** 取一张验证码。测试环境（CAPTCHA_TEST_ECHO=1）响应里带明文 text */
export async function fetchCaptcha() {
  const { status, data } = await api('/api/customer/captcha')
  if (status !== 200 || !data?.captchaId) throw new Error(`获取验证码失败: HTTP ${status} ${JSON.stringify(data)}`)
  return { captchaId: data.captchaId, text: data.text }
}

/** 顾客登录（username + 密码 + 验证码） */
export async function loginCustomer({ username, password, captchaId, captchaText }) {
  return api('/api/customer/login', { method: 'POST', body: { username, password, captchaId, captchaText } })
}

/** 管理员登录（/api/captcha + /api/admin/login），默认用 prepare-test-db 准备的账号 */
export async function adminLogin(username = 'admin', password = 'Test123456') {
  const captcha = await fetchCaptcha()
  const { status, data } = await api('/api/admin/login', {
    method: 'POST',
    body: { username, password, captchaId: captcha.captchaId, captchaText: captcha.text },
  })
  if (status !== 200 || !data?.token) throw new Error(`管理员 ${username} 登录失败: HTTP ${status} ${JSON.stringify(data)}`)
  return data.token
}

/** 添加收货地址（新顾客首条地址自动成为默认地址），返回地址 id */
export async function addAddress(token, receiverName = '测试收货人') {
  const { status, data } = await api('/api/customer/addresses', {
    method: 'POST',
    token,
    body: {
      receiver_name: receiverName,
      receiver_phone: '13800001111',
      province: '测试省', city: '测试市', district: '测试区',
      detail_address: '测试路 1 号',
      is_default: 1,
    },
  })
  if (status !== 201) throw new Error(`添加地址失败: HTTP ${status} ${JSON.stringify(data)}`)
  return data.data.id
}

/** 挑一个有库存的上架商品（走公开商品列表，避免依赖具体种子数据） */
export async function pickProduct() {
  const { status, data } = await api('/api/public/products?page=1&page_size=60')
  if (status !== 200) throw new Error(`获取商品列表失败: HTTP ${status}`)
  const product = (data.data || []).find(item => item.stock > 0)
  if (!product) throw new Error('没有有库存的上架商品')
  return product
}

/** 取一条运费记录（locale + fee_cny），下单时按它声明运费 */
export async function pickShippingRate() {
  const { status, data } = await api('/api/public/shipping-rates')
  if (status !== 200 || !data.data?.length) throw new Error(`获取运费失败: HTTP ${status}`)
  return data.data[0]
}

/** 查询商品详情（公开接口，含 stock） */
export async function getProduct(productId) {
  const { status, data } = await api(`/api/public/products/${productId}`)
  if (status !== 200) throw new Error(`获取商品详情失败: HTTP ${status}`)
  return data.data
}

/** 下单：传 items 直传；传 productId/quantity 组装单项；都不传则走购物车全部商品；运费由调用方声明（可故意传错以测 409） */
export async function placeOrder(token, { productId, quantity = 1, addressId, shippingFee, locale, items }) {
  const body = { address_id: addressId, locale, shipping_fee: shippingFee }
  if (items !== undefined) body.items = items
  else if (productId !== undefined) body.items = [{ product_id: productId, quantity }]
  return api('/api/customer/orders', { method: 'POST', token, body })
}

/** 用管理员 token 把订单推进到目标状态（可传数组逐级推进） */
export async function advanceOrder(orderId, statuses, adminToken) {
  const token = adminToken || await adminLogin()
  const steps = Array.isArray(statuses) ? statuses : [statuses]
  const results = []
  for (const status of steps) {
    results.push(await api(`/api/admin-orders/${orderId}/status`, { method: 'PUT', token, body: { status } }))
  }
  return results
}

/** 直连测试数据库（只应做 API 无法表达的前置/断言，例如回拨评论时间） */
export function openTestDb() {
  const db = new Database(resolve(process.cwd(), 'server/test.db'))
  db.pragma('busy_timeout = 10000')
  return db
}
