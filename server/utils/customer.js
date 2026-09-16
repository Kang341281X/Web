import storageService from '../services/storageService.js'

// 中国大陆手机号：1 开头、第二位 3-9、共 11 位
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/
// 登录用户名：4-20 位，只允许字母 / 数字 / 下划线（大小写敏感，不做隐式转换）
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/

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

export function requiredUsername(value) {
  const username = String(value || '').trim()
  if (!USERNAME_PATTERN.test(username)) {
    throw Object.assign(new Error('用户名需为 4-20 位字母、数字或下划线'), { status: 400 })
  }
  return username
}

// SQLite 唯一索引冲突（better-sqlite3 抛出的错误形如「UNIQUE constraint failed: customer.username」）
export function isUniqueViolation(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(error?.message || '')
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

// 对外输出顾客信息：剔除密码、返回完整手机号、补全头像完整地址
export function publicCustomer(customer) {
  if (!customer) return null
  const { password, ...safe } = customer
  return {
    ...safe,
    avatar_url: storageService.getUrl(customer.avatar),
  }
}
