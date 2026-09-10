import { Router } from 'express'
import multer from 'multer'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import { requiredText } from '../utils/admin.js'
import storageService from '../services/storageService.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

function categoryBody(body) {
  const name = requiredText(body.name, '分类名称', { min: 1, max: 50 })
  const parentId = Math.max(Number.parseInt(body.parent_id, 10) || 0, 0)
  const sortOrder = Number.parseInt(body.sort_order, 10) || 0
  return { name, parentId, sortOrder, status: Number(body.status) === 0 ? 0 : 1 }
}
router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, image, created_by, created_by_name, created_at, updated_at FROM category ORDER BY parent_id, sort_order, id')
    res.json({ success: true, data: rows.map(row => ({ ...row, image_url: row.image ? storageService.getUrl(row.image) : null })) })
  } catch (error) { next(error) }
})
router.post('/', async (req, res, next) => {
  try {
    const category = categoryBody(req.body)
    if (category.parentId) {
      const [parents] = await db.execute('SELECT id FROM category WHERE id = ?', [category.parentId])
      if (!parents[0]) return res.status(400).json({ success: false, message: '父级分类不存在' })
    }
    if (!category.sortOrder) {
      const [[{ maxSort }]] = await db.execute('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM category')
      category.sortOrder = maxSort + 1
    }
    const [result] = await db.execute('INSERT INTO category (name, parent_id, sort_order, status, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)', [category.name, category.parentId, category.sortOrder, category.status, req.admin.id, req.admin.real_name || req.admin.username])
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, image, created_by, created_by_name, created_at, updated_at FROM category WHERE id = ?', [result.insertId])
    await writeOperationLog(req.admin.id, 'create_category', category.name, req)
    res.status(201).json({ success: true, data: { ...rows[0], image_url: rows[0].image ? storageService.getUrl(rows[0].image) : null } })
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: '同一父级下已存在该分类名称' }); next(error) }
})
router.put('/:id', async (req, res, next) => {
  try {
    const category = categoryBody(req.body); const id = Number(req.params.id)
    if (category.parentId === id) return res.status(400).json({ success: false, message: '分类不能将自己设为父级' })
    if (category.parentId) { const [parents] = await db.execute('SELECT id FROM category WHERE id = ?', [category.parentId]); if (!parents[0]) return res.status(400).json({ success: false, message: '父级分类不存在' }) }
    const [result] = await db.execute('UPDATE category SET name = ?, parent_id = ?, sort_order = ?, status = ? WHERE id = ?', [category.name, category.parentId, category.sortOrder, category.status, id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '分类不存在' })
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, image, created_by, created_by_name, created_at, updated_at FROM category WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'update_category', category.name, req)
    res.json({ success: true, data: { ...rows[0], image_url: rows[0].image ? storageService.getUrl(rows[0].image) : null } })
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: '同一父级下已存在该分类名称' }); next(error) }
})
// 分类图片上传（每个分类仅限一张）
router.post('/:id/image', imageUpload.single('image'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.execute('SELECT image FROM category WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ success: false, message: '分类不存在' })
    const imagePath = await storageService.save(req.file, 'categories')
    await db.execute('UPDATE category SET image = ? WHERE id = ?', [imagePath, id])
    if (existing.image) await storageService.delete(existing.image)
    await writeOperationLog(req.admin.id, 'upload_category_image', `分类ID:${id}`, req)
    res.json({ success: true, data: { image: imagePath, image_url: storageService.getUrl(imagePath) } })
  } catch (error) { next(error) }
})
// 分类图片删除
router.delete('/:id/image', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.execute('SELECT image FROM category WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ success: false, message: '分类不存在' })
    if (existing.image) await storageService.delete(existing.image)
    await db.execute('UPDATE category SET image = NULL WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'delete_category_image', `分类ID:${id}`, req)
    res.json({ success: true, message: '分类图片已删除' })
  } catch (error) { next(error) }
})
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [[{ total: productCount }]] = await db.execute('SELECT COUNT(*) AS total FROM product WHERE category_id = ?', [id])
    const [[{ total: childCount }]] = await db.execute('SELECT COUNT(*) AS total FROM category WHERE parent_id = ?', [id])
    if (productCount || childCount) return res.status(409).json({ success: false, message: productCount ? '该分类下有关联商品，请先转移或删除商品' : '该分类下存在子分类，请先处理子分类' })
    const [result] = await db.execute('DELETE FROM category WHERE id = ?', [id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '分类不存在' })
    await writeOperationLog(req.admin.id, 'delete_category', String(id), req)
    res.json({ success: true, message: '分类已删除' })
  } catch (error) { next(error) }
})
export default router
