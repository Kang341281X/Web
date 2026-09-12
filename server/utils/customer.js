import storageService from '../services/storageService.js'

// 中国大陆手机号：1 开头、第二位 3-9、共 11 位
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

export function requiredPhone(value) {
  const phone = String(value || '').trim()
  if (!PHONE_PATTERN.test(phone)) throw Object.assign(new Error('手机号格式不正确'), { status: 400 })
  return phone
}

export function requiredPassword(value, label = '密码') {
  const password = String(value || '')
  if (password.length < 6 || password.length > 128) {
    throw Object.assign(new Error(`${label}长度应为 6-128 个字符`), { status: 400 })
  }
  return password
}

export function normalizeEmail(value) {
  const email = String(value || '').trim()
  if (email && !EMAIL_PATTERN.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
  return email || null
}

// 必填文本：去空格后校验长度
export function requiredText(value, label, { min = 1, max = 255 } = {}) {
  const text = String(value || '').trim()
  if (text.length < min || text.length > max) {
    throw Object.assign(new Error(`${label}长度应为 ${min}-${max} 个字符`), { status: 400 })
  }
  return text
}

// 选填文本：空值归一为 null，超长报错
export function optionalText(value, max) {
  const text = String(value || '').trim()
  if (text.length > max) throw Object.assign(new Error(`内容不能超过 ${max} 个字符`), { status: 400 })
  return text || null
}

// 手机号脱敏：保留前 3 位与后 4 位，中间 4 位用 * 代替
export function maskPhone(phone) {
  const value = String(phone || '')
  return value.length === 11 ? `${value.slice(0, 3)}****${value.slice(7)}` : value
}

// 对外输出顾客信息：剔除密码、脱敏手机号、补全头像完整地址
export function publicCustomer(customer) {
  if (!customer) return null
  const { password, ...safe } = customer
  return {
    ...safe,
    phone: maskPhone(safe.phone),
    avatar_url: storageService.getUrl(customer.avatar),
  }
}
