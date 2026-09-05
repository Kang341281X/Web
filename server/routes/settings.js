import { Router } from 'express'
import multer from 'multer'
import db from '../config/db.js'
import storageService from '../services/storageService.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

const VALID_KEYS = new Set(['contact_email', 'contact_phone', 'xiaohongshu', 'douyin', 'tiktok', 'telegram'])
const QR_KEYS = new Set(['xiaohongshu_qr', 'douyin_qr', 'tiktok_qr', 'telegram_qr'])

const qrUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT setting_key, setting_value, setting_label, updated_at FROM site_setting ORDER BY id')
    res.json({ success: true, data: rows })
  } catch (error) {
    next(error)
  }
})

router.put('/', async (req, res, next) => {
  try {
    const body = req.body?.settings || req.body
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, message: '请提供设置数据' })
    }
    const updates = Object.entries(body).filter(([key, value]) => {
      if (!VALID_KEYS.has(key)) return false
      const text = String(value ?? '').trim()
      return text.length <= 500
    })

    if (!updates.length) {
      return res.status(400).json({ success: false, message: '没有有效的设置项' })
    }

    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()
    for (const [key, value] of updates) {
      await connection.execute(
        'UPDATE site_setting SET setting_value = ? WHERE setting_key = ?',
        [String(value).trim(), key]
      )
    }
    await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }

    const [rows] = await db.execute('SELECT setting_key, setting_value, setting_label, updated_at FROM site_setting ORDER BY id')

    const changed = updates.map(([k]) => k).join(',')
    await writeOperationLog(req.admin.id, 'update_settings', `修改站点设置：${changed}`, req)

    res.json({ success: true, data: rows, message: '设置已保存' })
  } catch (error) {
    next(error)
  }
})

// 上传社交媒体二维码图片
router.post('/qr', qrUpload.single('image'), async (req, res, next) => {
  let newFile = null
  try {
    const key = String(req.body?.key || '').trim()
    if (!QR_KEYS.has(key)) {
      return res.status(400).json({ success: false, message: '无效的设置项' })
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' })
    }
    newFile = await storageService.save(req.file, 'settings')
    const [rows] = await db.execute('SELECT setting_value FROM site_setting WHERE setting_key = ?', [key])
    const oldPath = rows[0]?.setting_value || null
    await db.execute('UPDATE site_setting SET setting_value = ? WHERE setting_key = ?', [newFile, key])
    if (oldPath) await storageService.delete(oldPath)
    await writeOperationLog(req.admin.id, 'update_settings', `上传二维码：${key}`, req)
    res.json({ success: true, data: { key, url: storageService.getUrl(newFile) }, message: '二维码已上传' })
  } catch (error) {
    if (newFile) await storageService.delete(newFile)
    next(error)
  }
})

// 删除社交媒体二维码图片
router.delete('/qr/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim()
    if (!QR_KEYS.has(key)) {
      return res.status(400).json({ success: false, message: '无效的设置项' })
    }
    const [rows] = await db.execute('SELECT setting_value FROM site_setting WHERE setting_key = ?', [key])
    const oldPath = rows[0]?.setting_value || null
    if (oldPath) await storageService.delete(oldPath)
    await db.execute('UPDATE site_setting SET setting_value = ? WHERE setting_key = ?', ['', key])
    await writeOperationLog(req.admin.id, 'update_settings', `删除二维码：${key}`, req)
    res.json({ success: true, message: '二维码已删除' })
  } catch (error) {
    next(error)
  }
})

export default router
