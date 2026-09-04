import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import { requiredText } from '../utils/admin.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

function categoryBody(body) {
  const name = requiredText(body.name, '分类名称', { min: 1, max: 50 })
  const parentId = Math.max(Number.parseInt(body.parent_id, 10) || 0, 0)
  const sortOrder = Number.parseInt(body.sort_order, 10) || 0
  return { name, parentId, sortOrder, status: Number(body.status) === 0 ? 0 : 1 }
}
router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, created_at, updated_at FROM category ORDER BY parent_id, sort_order, id')
    res.json({ success: true, data: rows })
  } catch (error) { next(error) }
})
router.post('/', async (req, res, next) => {
  try {
    const category = categoryBody(req.body)
    if (category.parentId) {
      const [parents] = await db.execute('SELECT id FROM category WHERE id = ?', [category.parentId])
      if (!parents[0]) return res.status(400).json({ success: false, message: '父级分类不存在' })
    }
    const [result] = await db.execute('INSERT INTO category (name, parent_id, sort_order, status) VALUES (?, ?, ?, ?)', [category.name, category.parentId, category.sortOrder, category.status])
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, created_at, updated_at FROM category WHERE id = ?', [result.insertId])
    await writeOperationLog(req.admin.id, 'create_category', category.name)
    res.status(201).json({ success: true, data: rows[0] })
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: '同一父级下已存在该分类名称' }); next(error) }
})
router.put('/:id', async (req, res, next) => {
  try {
    const category = categoryBody(req.body); const id = Number(req.params.id)
    if (category.parentId === id) return res.status(400).json({ success: false, message: '分类不能将自己设为父级' })
    if (category.parentId) { const [parents] = await db.execute('SELECT id FROM category WHERE id = ?', [category.parentId]); if (!parents[0]) return res.status(400).json({ success: false, message: '父级分类不存在' }) }
    const [result] = await db.execute('UPDATE category SET name = ?, parent_id = ?, sort_order = ?, status = ? WHERE id = ?', [category.name, category.parentId, category.sortOrder, category.status, id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '分类不存在' })
    const [rows] = await db.execute('SELECT id, name, parent_id, sort_order, status, created_at, updated_at FROM category WHERE id = ?', [id])
    await writeOperationLog(req.admin.id, 'update_category', category.name)
    res.json({ success: true, data: rows[0] })
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: '同一父级下已存在该分类名称' }); next(error) }
})
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [[{ total: productCount }]] = await db.execute('SELECT COUNT(*) AS total FROM product WHERE category_id = ?', [id])
    const [[{ total: childCount }]] = await db.execute('SELECT COUNT(*) AS total FROM category WHERE parent_id = ?', [id])
    if (productCount || childCount) return res.status(409).json({ success: false, message: productCount ? '该分类下有关联商品，请先转移或删除商品' : '该分类下存在子分类，请先处理子分类' })
    const [result] = await db.execute('DELETE FROM category WHERE id = ?', [id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '分类不存在' })
    await writeOperationLog(req.admin.id, 'delete_category', String(id))
    res.json({ success: true, message: '分类已删除' })
  } catch (error) { next(error) }
})
export default router
