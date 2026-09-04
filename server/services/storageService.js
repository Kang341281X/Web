import { randomUUID } from 'node:crypto'
import { unlink, mkdir, writeFile, rm } from 'node:fs/promises'
import { extname, resolve, relative, sep } from 'node:path'

const TYPES = { jpeg: '.jpg', png: '.png', webp: '.webp' }
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
function typeFromBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp'
  return null
}
export function validateImage(file) {
  if (!file?.buffer) throw Object.assign(new Error('请选择图片文件'), { status: 400 })
  if (file.size > 5 * 1024 * 1024) throw Object.assign(new Error('图片大小不能超过 5MB'), { status: 400 })
  const type = typeFromBuffer(file.buffer)
  if (!type || !EXTENSIONS.has(extname(file.originalname || '').toLowerCase())) throw Object.assign(new Error('仅支持有效的 JPG、PNG、WebP 图片'), { status: 400 })
  return type
}
function root() { return resolve(process.env.UPLOAD_DIR || './uploads') }
export async function save(file, folder = 'avatars') {
  const type = validateImage(file)
  const base = root(); const directory = resolve(base, folder)
  if (relative(base, directory).startsWith('..')) throw new Error('非法存储目录')
  await mkdir(directory, { recursive: true })
  const name = `${randomUUID()}${TYPES[type]}`
  await writeFile(resolve(directory, name), file.buffer, { flag: 'wx' })
  return `/uploads/${folder.split(sep).join('/')}/${name}`
}
export async function remove(path) {
  if (!path || !path.startsWith('/uploads/')) return
  const base = root(); const target = resolve(base, path.slice('/uploads/'.length))
  if (relative(base, target).startsWith('..')) return
  try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
export async function removeDirectory(folder) {
  const base = root(); const target = resolve(base, folder)
  if (relative(base, target).startsWith('..') || target === base) return
  try { await rm(target, { recursive: true, force: true }) } catch (error) { console.error(`无法清理上传目录 ${folder}`, error) }
}
export function getUrl(path) { return path ? `${String(process.env.PUBLIC_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')}${path}` : null }
export default { save, delete: remove, deleteDirectory: removeDirectory, getUrl, validateImage }
