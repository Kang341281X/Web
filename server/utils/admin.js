import storageService from '../services/storageService.js'

export function publicAdmin(admin) {
  if (!admin) return null
  const { password, ...safe } = admin
  return { ...safe, avatar_url: storageService.getUrl(admin.avatar) }
}
export function requiredText(value, label, { min = 1, max = 255 } = {}) {
  const normalized = String(value || '').trim()
  if (normalized.length < min || normalized.length > max) throw Object.assign(new Error(`${label}长度应为 ${min}-${max} 个字符`), { status: 400 })
  return normalized
}
