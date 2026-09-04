import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'
import { requiredText } from '../utils/admin.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } })
router.use(requireAuth, requirePasswordChanged)
const selectFields = `p.id, p.name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, p.description, p.detail, p.main_image, p.status, p.created_at, p.updated_at`

function numberValue(value, label, { min = 0, integer = false, nullable = false } = {}) {
  if ((value === '' || value === null || value === undefined) && nullable) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < min || (integer && !Number.isInteger(numeric))) throw Object.assign(new Error(`${label}格式不正确`), { status: 400 })
  return numeric
}
function optionalText(value, max) { const text = String(value || '').trim(); if (text.length > max) throw Object.assign(new Error(`内容不能超过 ${max} 个字符`), { status: 400 }); return text || null }
async function validateProduct(body) {
  const values = {
    name: requiredText(body.name, '商品名称', { min: 1, max: 200 }),
    categoryId: numberValue(body.category_id, '商品分类', { min: 1, integer: true }),
    price: numberValue(body.price, '售价'), originalPrice: numberValue(body.original_price, '原价', { nullable: true }),
    stock: numberValue(body.stock, '库存', { integer: true }), sales: numberValue(body.sales ?? 0, '销量', { integer: true }),
    unit: optionalText(body.unit, 20), manufacturer: optionalText(body.manufacturer, 100), brand: optionalText(body.brand, 100),
    description: optionalText(body.description, 5000), detail: optionalText(body.detail, 1000000), status: Number(body.status) === 0 ? 0 : 1
  }
  if (values.originalPrice !== null && values.originalPrice < values.price) throw Object.assign(new Error('原价不能低于售价'), { status: 400 })
  const [categories] = await db.execute('SELECT id FROM category WHERE id = ?', [values.categoryId])
  if (!categories[0]) throw Object.assign(new Error('商品分类不存在'), { status: 400 })
  return values
}
function whereClause({ keyword, categoryId, ids }) {
  const clauses = []; const params = []
  if (keyword) { const like = `%${keyword}%`; clauses.push('(p.name LIKE ? OR p.manufacturer LIKE ? OR p.brand LIKE ?)'); params.push(like, like, like) }
  if (categoryId) { clauses.push('p.category_id = ?'); params.push(categoryId) }
  if (ids?.length) { clauses.push(`p.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids) }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}
function publicProduct(product) {
  const frontendBase = String(process.env.FRONTEND_PRODUCT_DETAIL_URL || 'http://localhost:5173/product/').replace(/\/$/, '')
  return { ...product, price: Number(product.price), original_price: product.original_price === null ? null : Number(product.original_price), main_image_url: storageService.getUrl(product.main_image), frontend_detail_url: `${frontendBase}/${product.id}` }
}
async function getProduct(id) {
  const [rows] = await db.execute(`SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id WHERE p.id = ?`, [id])
  if (!rows[0]) return null
  const [images] = await db.execute('SELECT id, product_id, image_url, is_main, sort_order, created_at, updated_at FROM product_image WHERE product_id = ? ORDER BY sort_order, id', [id])
  return { ...publicProduct(rows[0]), images: images.map(image => ({ ...image, image_url_full: storageService.getUrl(image.image_url) })) }
}

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1); const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim(); const categoryId = req.query.category_id ? numberValue(req.query.category_id, '分类', { min: 1, integer: true }) : null
    const where = whereClause({ keyword, categoryId }); const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM product p ${where.sql}`, where.params)
    const [rows] = await db.execute(`SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id ${where.sql} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`, [...where.params, pageSize, (page - 1) * pageSize])
    res.json({ success: true, data: rows.map(publicProduct), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})
router.get('/:id', async (req, res, next) => { try { const product = await getProduct(Number(req.params.id)); if (!product) return res.status(404).json({ success: false, message: '商品不存在' }); res.json({ success: true, data: product }) } catch (error) { next(error) } })
router.post('/', async (req, res, next) => {
  try {
    const item = await validateProduct(req.body)
    const [result] = await db.execute('INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.name, item.categoryId, item.price, item.originalPrice, item.stock, item.sales, item.unit, item.manufacturer, item.brand, item.description, item.detail, item.status])
    await writeOperationLog(req.admin.id, 'create_product', item.name)
    res.status(201).json({ success: true, data: await getProduct(result.insertId) })
  } catch (error) { next(error) }
})
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id); const item = await validateProduct(req.body)
    const [result] = await db.execute('UPDATE product SET name = ?, category_id = ?, price = ?, original_price = ?, stock = ?, sales = ?, unit = ?, manufacturer = ?, brand = ?, description = ?, detail = ?, status = ? WHERE id = ?', [item.name, item.categoryId, item.price, item.originalPrice, item.stock, item.sales, item.unit, item.manufacturer, item.brand, item.description, item.detail, item.status, id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '商品不存在' })
    await writeOperationLog(req.admin.id, 'update_product', String(id)); res.json({ success: true, data: await getProduct(id) })
  } catch (error) { next(error) }
})
async function deleteProducts(ids, adminId) {
  const uniqueIds = [...new Set(ids.map(Number).filter(Number.isInteger))]
  if (!uniqueIds.length) throw Object.assign(new Error('请选择商品'), { status: 400 })
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction(); const [rows] = await connection.execute(`SELECT id, name FROM product WHERE id IN (${uniqueIds.map(() => '?').join(',')}) FOR UPDATE`, uniqueIds)
    if (!rows.length) throw Object.assign(new Error('商品不存在'), { status: 404 })
    await connection.execute(`DELETE FROM product WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map(row => row.id)); await connection.commit()
    await Promise.all(rows.map(row => storageService.deleteDirectory(`products/${row.id}`))); await writeOperationLog(adminId, 'delete_products', rows.map(row => row.id).join(',')); return rows.length
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
router.delete('/:id', async (req, res, next) => { try { await deleteProducts([req.params.id], req.admin.id); res.json({ success: true, message: '商品已删除' }) } catch (error) { next(error) } })
router.post('/batch-delete', async (req, res, next) => { try { const count = await deleteProducts(Array.isArray(req.body.ids) ? req.body.ids : [], req.admin.id); res.json({ success: true, message: `已删除 ${count} 个商品` }) } catch (error) { next(error) } })
router.post('/:id/images', upload.array('images', 10), async (req, res, next) => {
  const id = Number(req.params.id); const saved = []
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: '请至少选择一张图片' })
    const [products] = await db.execute('SELECT id FROM product WHERE id = ?', [id]); if (!products[0]) return res.status(404).json({ success: false, message: '商品不存在' })
    for (const file of req.files) saved.push(await storageService.save(file, `products/${id}`))
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction(); const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM product_image WHERE product_id = ?', [id])
      for (let index = 0; index < saved.length; index++) await connection.execute('INSERT INTO product_image (product_id, image_url, is_main, sort_order) VALUES (?, ?, ?, ?)', [id, saved[index], total === 0 && index === 0 ? 1 : 0, total + index])
      if (total === 0) await connection.execute('UPDATE product SET main_image = ? WHERE id = ?', [saved[0], id]); else await connection.execute('UPDATE product SET updated_at = NOW() WHERE id = ?', [id])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    res.status(201).json({ success: true, data: await getProduct(id) })
  } catch (error) { await Promise.all(saved.map(path => storageService.delete(path))); next(error) }
})
router.delete('/images/:imageId', async (req, res, next) => {
  try {
    const connection = await db.getConnection(); let image
    try {
      await connection.beginTransaction(); const [rows] = await connection.execute('SELECT id, product_id, image_url, is_main FROM product_image WHERE id = ? FOR UPDATE', [req.params.imageId]); image = rows[0]
      if (!image) throw Object.assign(new Error('图片不存在'), { status: 404 })
      await connection.execute('DELETE FROM product_image WHERE id = ?', [image.id]); const [rest] = await connection.execute('SELECT id, image_url FROM product_image WHERE product_id = ? ORDER BY sort_order, id LIMIT 1', [image.product_id])
      const nextImage = rest[0]; if (image.is_main && nextImage) await connection.execute('UPDATE product_image SET is_main = 1 WHERE id = ?', [nextImage.id]); await connection.execute('UPDATE product SET main_image = ?, updated_at = NOW() WHERE id = ?', [nextImage?.image_url || null, image.product_id]); await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await storageService.delete(image.image_url); res.json({ success: true, message: '图片已删除' })
  } catch (error) { next(error) }
})
router.put('/images/:imageId/set-main', async (req, res, next) => {
  try {
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction(); const [rows] = await connection.execute('SELECT id, product_id, image_url FROM product_image WHERE id = ? FOR UPDATE', [req.params.imageId]); const image = rows[0]; if (!image) throw Object.assign(new Error('图片不存在'), { status: 404 })
      await connection.execute('UPDATE product_image SET is_main = 0 WHERE product_id = ?', [image.product_id]); await connection.execute('UPDATE product_image SET is_main = 1 WHERE id = ?', [image.id]); await connection.execute('UPDATE product SET main_image = ?, updated_at = NOW() WHERE id = ?', [image.image_url, image.product_id]); await connection.commit(); res.json({ success: true, data: await getProduct(image.product_id) })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  } catch (error) { next(error) }
})
router.put('/:id/images/sort', async (req, res, next) => {
  try {
    const id = Number(req.params.id); const images = Array.isArray(req.body.images) ? req.body.images : []
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction(); const [existing] = await connection.execute('SELECT id FROM product_image WHERE product_id = ?', [id]); const known = new Set(existing.map(image => image.id))
      if (!existing.length || images.length !== existing.length || images.some(image => !known.has(Number(image.id)))) throw Object.assign(new Error('图片排序数据不完整'), { status: 400 })
      for (let index = 0; index < images.length; index++) await connection.execute('UPDATE product_image SET sort_order = ? WHERE id = ? AND product_id = ?', [index, images[index].id, id])
      await connection.execute('UPDATE product SET updated_at = NOW() WHERE id = ?', [id]); await connection.commit(); res.json({ success: true, data: await getProduct(id) })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  } catch (error) { next(error) }
})
router.post('/export', async (req, res, next) => {
  try {
    const mode = req.body.mode; const ids = mode === 'selected' ? (Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : []) : null
    if (mode === 'selected' && !ids.length) return res.status(400).json({ success: false, message: '请先勾选要导出的商品' })
    if (!['filter', 'selected'].includes(mode)) return res.status(400).json({ success: false, message: '导出模式不正确' })
    const keyword = String(req.body.keyword || '').trim(); const categoryId = req.body.category_id ? numberValue(req.body.category_id, '分类', { min: 1, integer: true }) : null; const where = whereClause({ keyword, categoryId, ids })
    const [rows] = await db.execute(`SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id ${where.sql} ORDER BY p.id`, where.params)
    const sheet = XLSX.utils.json_to_sheet(rows.map((row, index) => ({ '序号': index + 1, '商品名称': row.name, '分类': row.category_name, '售价': Number(row.price), '原价': row.original_price === null ? '' : Number(row.original_price), '库存': row.stock, '销量': row.sales, '单位': row.unit || '', '生产厂家': row.manufacturer || '', '品牌': row.brand || '', '状态': row.status ? '上架' : '下架', '描述': row.description || '' })))
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '商品数据'); const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('商品数据.xlsx')}`); res.send(buffer)
  } catch (error) { next(error) }
})
export default router
