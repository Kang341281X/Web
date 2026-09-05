import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

const VALID_KEYS = new Set(['contact_email', 'contact_phone', 'xiaohongshu', 'douyin', 'tiktok', 'telegram'])

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

export default router
