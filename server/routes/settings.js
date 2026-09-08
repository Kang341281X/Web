import { Router } from 'express'
import multer from 'multer'
import db from '../config/db.js'
import storageService from '../services/storageService.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

const VALID_KEYS = new Set(['contact_email', 'contact_email2', 'contact_phone', 'contact_phone2'])

const socialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

function toSocial(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
    image_url: storageService.getUrl(row.image),
  }
}

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 站点基础设置（联系方式等文本）
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

// 社交媒体列表
router.get('/socials', async (_req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, name, image, sort_order, updated_at FROM social_media ORDER BY sort_order, id')
    res.json({ success: true, data: rows.map(toSocial) })
  } catch (error) {
    next(error)
  }
})

// 新增社交媒体
router.post('/socials', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ success: false, message: '请输入平台名称' })
    if ([...name].length > 30) return res.status(400).json({ success: false, message: '平台名称不能超过30个字符' })

    const [[{ max }]] = await db.execute('SELECT COALESCE(MAX(sort_order), -1) AS max FROM social_media')
    const [result] = await db.execute('INSERT INTO social_media (name, image, sort_order) VALUES (?, ?, ?)', [name, '', Number(max) + 1])
    const [rows] = await db.execute('SELECT id, name, image, sort_order, updated_at FROM social_media WHERE id = ?', [result.insertId])
    await writeOperationLog(req.admin.id, 'update_settings', `新增社交媒体：${name}`, req)
    res.json({ success: true, data: toSocial(rows[0]) })
  } catch (error) {
    next(error)
  }
})

// 修改社交媒体名称
router.put('/socials/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ success: false, message: '参数错误' })
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ success: false, message: '请输入平台名称' })
    if ([...name].length > 30) return res.status(400).json({ success: false, message: '平台名称不能超过30个字符' })

    const [result] = await db.execute('UPDATE social_media SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '平台不存在' })
    const [rows] = await db.execute('SELECT id, name, image, sort_order, updated_at FROM social_media WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'update_settings', `修改社交媒体名称：${name}`, req)
    res.json({ success: true, data: toSocial(rows[0]) })
  } catch (error) {
    next(error)
  }
})

// 上传社交媒体二维码图片
router.post('/socials/:id/image', socialUpload.single('image'), async (req, res, next) => {
  let newFile = null
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ success: false, message: '参数错误' })
    if (!req.file) return res.status(400).json({ success: false, message: '请选择图片文件' })

    const [rows] = await db.execute('SELECT id, name, image FROM social_media WHERE id = ?', [id])
    if (!rows[0]) return res.status(404).json({ success: false, message: '平台不存在' })

    newFile = await storageService.save(req.file, 'settings')
    const oldPath = rows[0].image
    await db.execute('UPDATE social_media SET image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newFile, id])
    if (oldPath) await storageService.delete(oldPath)
    await writeOperationLog(req.admin.id, 'update_settings', `上传二维码：${rows[0].name}`, req)
    res.json({ success: true, data: { id, url: storageService.getUrl(newFile) }, message: '二维码已上传' })
  } catch (error) {
    if (newFile) await storageService.delete(newFile)
    next(error)
  }
})

// 删除社交媒体（连同二维码图片）
router.delete('/socials/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ success: false, message: '参数错误' })
    const [rows] = await db.execute('SELECT id, name, image FROM social_media WHERE id = ?', [id])
    if (!rows[0]) return res.status(404).json({ success: false, message: '平台不存在' })
    await db.execute('DELETE FROM social_media WHERE id = ?', [id])
    if (rows[0].image) await storageService.delete(rows[0].image)
    await writeOperationLog(req.admin.id, 'update_settings', `删除社交媒体：${rows[0].name}`, req)
    res.json({ success: true, message: '已删除' })
  } catch (error) {
    next(error)
  }
})

export default router
