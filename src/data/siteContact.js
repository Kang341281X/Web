/**
 * 站点联系方式（邮箱 / 电话）的唯一配置出口。
 *
 * 取值优先级：
 *   1. 后端 /api/public/settings 返回的 contact_email / contact_phone（site_setting 表，
 *      管理后台「设置」页可改，见 server/routes/settings.js 与 server/seed.js）；
 *   2. 都没有时回退到下面的 DEFAULT_CONTACT。
 *
 * ⚠️ 需要替换成真实联系方式时：改这里即可（全局生效），
 *    或者直接在管理后台「设置」里填写——后台值优先于这里的默认值。
 *    当前值与 seed 数据一致，均为占位值，上线前务必替换。
 */
export const DEFAULT_CONTACT = {
  email: 'contact@example-shop.com',
  phone: '400-800-1234',
}

// tel: 只保留数字与开头的 +，去掉空格 / 括号 / 连字符，避免部分手机浏览器无法识别拨号
export function telHref(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '')
  return normalized ? `tel:${normalized}` : ''
}

export function mailtoHref(email) {
  const value = String(email || '').trim()
  return value ? `mailto:${value}` : ''
}

/**
 * 把设置接口返回值整理成联系卡片可直接使用的结构。
 * @param {object} settings /api/public/settings 返回的对象
 * @returns {{ email: string, phone: string, emailHref: string, phoneHref: string }}
 */
export function resolveContact(settings = {}) {
  const email = String(settings?.contact_email || '').trim() || DEFAULT_CONTACT.email
  const phone = String(settings?.contact_phone || '').trim() || DEFAULT_CONTACT.phone
  return { email, phone, emailHref: mailtoHref(email), phoneHref: telHref(phone) }
}
