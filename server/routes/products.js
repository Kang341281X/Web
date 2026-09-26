import { Router } from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'
import { requiredText } from '../utils/admin.js'
import { generateSkuCode, normalizeRating } from '../utils/productRules.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } })
router.use(requireAuth, requirePasswordChanged)
const selectFields = `p.id, p.name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, p.description, p.detail, p.main_image, p.sku, p.is_customizable, p.rating, p.review_count, p.status, p.created_by, p.created_by_name, p.created_at, p.updated_at`

function numberValue(value, label, { min = 0, integer = false, nullable = false } = {}) {
  if ((value === '' || value === null || value === undefined) && nullable) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < min || (integer && !Number.isInteger(numeric))) throw Object.assign(new Error(`${label}格式不正确`), { status: 400 })
  return numeric
}
function optionalText(value, max) { const text = String(value || '').trim(); if (text.length > max) throw Object.assign(new Error(`内容不能超过 ${max} 个字符`), { status: 400 }); return text || null }
// 商品编号由 server/utils/productRules.js 的算法统一生成，且「所见即所存」
async function validateProduct(body, excludeId = null, adminUsername = '') {
  // SKU 规则：
  //  - 创建（excludeId === null）：直接采用请求体携带的编号——前端新增弹窗/在线表格已按同一算法
  //    （前 3 位用户名映射字母 + 后 7 位时间戳映射数字）生成并展示，做到「预览即落库」，不再查重或更换。
  //    仅在编号为空时用同一算法补一个兜底；不处理碰撞（管理员人数少，实际不会碰撞），
  //    极端并发下由 product.sku 唯一索引兜底，返回 409。
  //  - 编辑（excludeId !== null）：编号一经生成即与商品永久绑定，忽略请求体，
  //    强制沿用数据库原值，确保任何更新入口都无法篡改商品编号。
  let sku
  if (excludeId === null) {
    sku = String(body.sku || '').trim().slice(0, 64) || generateSkuCode(adminUsername)
  } else {
    const [rows] = await db.execute('SELECT sku FROM product WHERE id = ?', [excludeId])
    if (!rows[0]) throw Object.assign(new Error('商品不存在'), { status: 404 })
    // 兜底：极少数历史数据 sku 仍为空时，编辑时顺带补齐编号；补齐后同样不可再被修改
    sku = rows[0].sku || generateSkuCode(adminUsername)
  }
  // is_customizable：0/1
  const isCustomizable = [1, '1', true, 'true'].includes(body.is_customizable) ? 1 : 0
  // rating：0~5，非数字或越界才判失败，其余就近取整到 0.5 的倍数；未填默认 5
  const ratingResult = normalizeRating(body.rating)
  if (!ratingResult.valid) throw Object.assign(new Error('商品评分格式不正确，应为0-5之间的数字'), { status: 400 })
  const rating = ratingResult.rating
  const values = {
    name: requiredText(body.name, '商品名称', { min: 1, max: 200 }),
    categoryId: numberValue(body.category_id, '商品分类', { min: 1, integer: true }),
    price: numberValue(body.price, '售价'), originalPrice: numberValue(body.original_price, '原价', { nullable: true }),
    unit: optionalText(body.unit, 20), manufacturer: optionalText(body.manufacturer, 100), brand: optionalText(body.brand, 100),
    description: optionalText(body.description, 5000), detail: optionalText(body.detail, 1000000), status: Number(body.status) === 0 ? 0 : 1,
    sku, isCustomizable, rating
  }
  // 库存 / 销量只在「新增商品」时随表单写入（设定初始值）；
  // 编辑（excludeId !== null）时不再接受这两个字段，改走 PATCH /:id/stock（库存增量调整）
  // 与顾客下单的原子扣减，避免「编辑表单里的过期快照整行覆盖」造成丢失更新（销量被静默回滚）。
  if (excludeId === null) {
    values.stock = numberValue(body.stock, '库存', { integer: true })
    values.sales = numberValue(body.sales ?? 0, '销量', { integer: true })
  }
  if (values.originalPrice !== null && values.originalPrice < values.price) throw Object.assign(new Error('原价不能低于售价'), { status: 400 })
  const [categories] = await db.execute('SELECT id FROM category WHERE id = ?', [values.categoryId])
  if (!categories[0]) throw Object.assign(new Error('商品分类不存在'), { status: 400 })
  return values
}
function whereClause({ keyword, categoryId, ids, stockLevel }) {
  const clauses = []; const params = []
  if (keyword) { const like = `%${keyword}%`; clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.manufacturer LIKE ? OR p.brand LIKE ?)'); params.push(like, like, like, like) }
  if (categoryId) { clauses.push('p.category_id = ?'); params.push(categoryId) }
  // 库存等级过滤：与仪表盘「低库存预警」卡片共用同一阈值 LOW_STOCK_THRESHOLD（见下方 stats 接口），
  // 保证卡片数字与列表筛出来的数量口径完全一致。
  if (stockLevel === 'low') { clauses.push('p.stock < ?'); params.push(LOW_STOCK_THRESHOLD) }
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
    // 支持 ?stock=low 过滤低库存商品，与仪表盘 /stats 接口共用 LOW_STOCK_THRESHOLD，统计口径一致
    const stockLevel = String(req.query.stock || '').trim().toLowerCase() === 'low' ? 'low' : null
    const where = whereClause({ keyword, categoryId, stockLevel }); const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM product p ${where.sql}`, where.params)
    const [rows] = await db.execute(`SELECT ${selectFields} FROM product p JOIN category c ON c.id = p.category_id ${where.sql} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`, [...where.params, pageSize, (page - 1) * pageSize])
    res.json({ success: true, data: rows.map(publicProduct), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})
// 仪表盘统计：一次聚合出概览指标 + 各分类占比 + 近 7 天新增趋势。
// 注册在 '/:id' 之前，避免 stats 被当作商品 id。
// 此前仪表盘是「拉前 100 条商品在前端过滤统计」，商品超过 100 条后数字会失真，
// 且每次打开仪表盘都要传输全量商品；改为数据库聚合后与数据量无关。
const LOW_STOCK_THRESHOLD = 10
router.get('/stats', async (req, res, next) => {
  try {
    const [[overview]] = await db.execute(
      `SELECT COUNT(*) AS total_products,
              COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today_new,
              COALESCE(SUM(CASE WHEN date(created_at) >= date('now', 'start of month') THEN 1 ELSE 0 END), 0) AS month_new,
              COALESCE(SUM(CASE WHEN stock < ? THEN 1 ELSE 0 END), 0) AS low_stock
       FROM product`,
      [LOW_STOCK_THRESHOLD]
    )
    // 分类数与「商品分类」页口径一致：只统计启用中的分类
    const [[categories]] = await db.execute('SELECT COUNT(*) AS total FROM category WHERE status = 1')
    const [distribution] = await db.execute('SELECT c.name AS name, COUNT(p.id) AS value FROM product p JOIN category c ON c.id = p.category_id GROUP BY c.id ORDER BY value DESC, c.id')
    const [dailyRows] = await db.execute("SELECT date(created_at) AS date, COUNT(*) AS count FROM product WHERE date(created_at) >= date('now', '-6 days') GROUP BY date(created_at)")
    // 没有新增商品的日期由后端补 0，前端不再自己拼日期轴
    const dailyCounts = new Map(dailyRows.map(row => [row.date, Number(row.count)]))
    const dailyNew = []
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
      dailyNew.push({ date: day, count: dailyCounts.get(day) || 0 })
    }
    res.json({
      success: true,
      data: {
        total_products: Number(overview.total_products),
        today_new: Number(overview.today_new),
        month_new: Number(overview.month_new),
        low_stock: Number(overview.low_stock),
        low_stock_threshold: LOW_STOCK_THRESHOLD,
        total_categories: Number(categories.total),
        category_distribution: distribution.map(item => ({ name: item.name, value: Number(item.value) })),
        daily_new: dailyNew,
      },
    })
  } catch (error) { next(error) }
})
router.get('/:id', async (req, res, next) => { try { const product = await getProduct(Number(req.params.id)); if (!product) return res.status(404).json({ success: false, message: '商品不存在' }); res.json({ success: true, data: product }) } catch (error) { next(error) } })
router.post('/', async (req, res, next) => {
  try {
    const item = await validateProduct(req.body, null, req.admin.username)
    const [result] = await db.execute('INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status, sku, is_customizable, rating, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.name, item.categoryId, item.price, item.originalPrice, item.stock, item.sales, item.unit, item.manufacturer, item.brand, item.description, item.detail, item.status, item.sku, item.isCustomizable, item.rating, req.admin.id, req.admin.real_name || req.admin.username])
    await writeOperationLog(req.admin.id, 'create_product', item.name, req)
    res.status(201).json({ success: true, data: await getProduct(result.insertId) })
  } catch (error) {
    // 唯一索引兜底：并发下 check-then-write 仍可能冲突，统一返回友好提示
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) return res.status(409).json({ success: false, message: '商品编号已存在' })
    next(error)
  }
})
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id); const item = await validateProduct(req.body, id, req.admin.username)
    // 库存 / 销量不在编辑商品时更新（见 validateProduct 注释），只能通过
    // PATCH /:id/stock 做增量调整，或由顾客下单的原子扣减推进，杜绝丢失更新
    const [result] = await db.execute('UPDATE product SET name = ?, category_id = ?, price = ?, original_price = ?, unit = ?, manufacturer = ?, brand = ?, description = ?, detail = ?, status = ?, sku = ?, is_customizable = ?, rating = ? WHERE id = ?', [item.name, item.categoryId, item.price, item.originalPrice, item.unit, item.manufacturer, item.brand, item.description, item.detail, item.status, item.sku, item.isCustomizable, item.rating, id])
    if (!result.affectedRows) return res.status(404).json({ success: false, message: '商品不存在' })
    await writeOperationLog(req.admin.id, 'update_product', String(id), req); res.json({ success: true, data: await getProduct(id) })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) return res.status(409).json({ success: false, message: '商品编号已存在' })
    next(error)
  }
})
// 库存调整（增量更新）：stock = stock + delta，与顾客下单的 stock = stock - ? 一样是原子行级更新，
// 不依赖调用方读到的旧值，天然规避「编辑商品表单的过期库存快照覆盖真实库存」的丢失更新问题。
//   body: { delta: ±N }（兼容 quantity 字段名），可选 { reason } 说明调整原因（补货 / 盘点等）
//   stock + delta < 0 时整条不生效并返回 400；调整后返回最新库存便于前端即时刷新展示。
router.patch('/:id/stock', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ success: false, message: '商品不存在' })
    const body = req.body || {}
    const delta = Number(body.delta ?? body.quantity)
    const reason = optionalText(body.reason, 200)
    if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ success: false, message: '调整数量必须是非零整数' })

    const [rows] = await db.execute('SELECT id, name, stock FROM product WHERE id = ?', [id])
    if (!rows[0]) return res.status(404).json({ success: false, message: '商品不存在' })

    // 条件更新：WHERE stock + ? >= 0 保证库存不会被调负；affectedRows = 0 即当前库存不足以下调
    const [result] = await db.execute("UPDATE product SET stock = stock + ?, updated_at = datetime('now') WHERE id = ? AND stock + ? >= 0", [delta, id, delta])
    if (!result.affectedRows) return res.status(400).json({ success: false, message: `调整后库存不能为负数（当前库存 ${rows[0].stock}）` })

    await writeOperationLog(req.admin.id, 'adjust_stock', `${rows[0].name}：库存 ${delta > 0 ? '+' : ''}${delta}（${rows[0].stock} → ${rows[0].stock + delta}）${reason ? `，原因：${reason}` : ''}`, req)
    res.json({ success: true, message: '库存已调整', data: { id, delta, stock: rows[0].stock + delta } })
  } catch (error) { next(error) }
})
async function deleteProducts(ids, adminId, req) {
  const uniqueIds = [...new Set(ids.map(Number).filter(Number.isInteger))]
  if (!uniqueIds.length) throw Object.assign(new Error('请选择商品'), { status: 400 })
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction(); const [rows] = await connection.execute(`SELECT id, name FROM product WHERE id IN (${uniqueIds.map(() => '?').join(',')})`, uniqueIds)
    if (!rows.length) throw Object.assign(new Error('商品不存在'), { status: 404 })
    await connection.execute(`DELETE FROM product WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map(row => row.id)); await connection.commit()
    await Promise.all(rows.map(row => storageService.deleteDirectory(`products/${row.id}`))); await writeOperationLog(adminId, 'delete_products', rows.map(row => row.id).join(','), req); return rows.length
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
router.delete('/:id', async (req, res, next) => { try { await deleteProducts([req.params.id], req.admin.id, req); res.json({ success: true, message: '商品已删除' }) } catch (error) { next(error) } })
router.post('/batch-delete', async (req, res, next) => { try { const count = await deleteProducts(Array.isArray(req.body.ids) ? req.body.ids : [], req.admin.id, req); res.json({ success: true, message: `已删除 ${count} 个商品` }) } catch (error) { next(error) } })
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
      if (total === 0) await connection.execute('UPDATE product SET main_image = ? WHERE id = ?', [saved[0], id]); else await connection.execute("UPDATE product SET updated_at = datetime('now') WHERE id = ?", [id])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    res.status(201).json({ success: true, data: await getProduct(id) })
  } catch (error) { await Promise.all(saved.map(path => storageService.delete(path))); next(error) }
})
// 替换图片文件（裁剪后）
const replaceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
router.post('/images/:imageId/replace', replaceUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择图片' })
    const [rows] = await db.execute('SELECT id, product_id, image_url, is_main FROM product_image WHERE id = ?', [req.params.imageId])
    const image = rows[0]
    if (!image) return res.status(404).json({ success: false, message: '图片不存在' })
    const newPath = await storageService.save(req.file, `products/${image.product_id}`)
    await db.execute('UPDATE product_image SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?', [newPath, image.id])
    if (image.is_main) await db.execute("UPDATE product SET main_image = ?, updated_at = datetime('now') WHERE id = ?", [newPath, image.product_id])
    // 删除旧文件
    if (image.image_url && image.image_url !== newPath) await storageService.delete(image.image_url)
    res.json({ success: true, data: await getProduct(image.product_id) })
  } catch (error) { next(error) }
})
router.delete('/images/:imageId', async (req, res, next) => {
  try {
    const connection = await db.getConnection(); let image
    try {
      await connection.beginTransaction(); const [rows] = await connection.execute('SELECT id, product_id, image_url, is_main FROM product_image WHERE id = ?', [req.params.imageId]); image = rows[0]
      if (!image) throw Object.assign(new Error('图片不存在'), { status: 404 })
      await connection.execute('DELETE FROM product_image WHERE id = ?', [image.id]); const [rest] = await connection.execute('SELECT id, image_url FROM product_image WHERE product_id = ? ORDER BY sort_order, id LIMIT 1', [image.product_id])
      const nextImage = rest[0]; if (image.is_main && nextImage) await connection.execute('UPDATE product_image SET is_main = 1 WHERE id = ?', [nextImage.id]); await connection.execute("UPDATE product SET main_image = ?, updated_at = datetime('now') WHERE id = ?", [nextImage?.image_url || null, image.product_id]); await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await storageService.delete(image.image_url); res.json({ success: true, message: '图片已删除' })
  } catch (error) { next(error) }
})
router.put('/images/:imageId/set-main', async (req, res, next) => {
  try {
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute('SELECT id, product_id, image_url FROM product_image WHERE id = ?', [req.params.imageId])
      const image = rows[0]
      if (!image) throw Object.assign(new Error('图片不存在'), { status: 404 })
      await connection.execute('UPDATE product_image SET is_main = 0 WHERE product_id = ?', [image.product_id])
      await connection.execute('UPDATE product_image SET is_main = 1 WHERE id = ?', [image.id])
      await connection.execute("UPDATE product SET main_image = ?, updated_at = datetime('now') WHERE id = ?", [image.image_url, image.product_id])
      // 将新主图 sort_order 设为 0，其余按原顺序递增
      const [allImages] = await connection.execute('SELECT id, sort_order FROM product_image WHERE product_id = ? ORDER BY sort_order, id', [image.product_id])
      let order = 0
      // 新主图排第一位
      await connection.execute('UPDATE product_image SET sort_order = 0 WHERE id = ?', [image.id])
      order = 1
      for (const img of allImages) {
        if (img.id === image.id) continue
        await connection.execute('UPDATE product_image SET sort_order = ? WHERE id = ?', [order, img.id])
        order++
      }
      await connection.commit()
      res.json({ success: true, data: await getProduct(image.product_id) })
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
      await connection.execute("UPDATE product SET updated_at = datetime('now') WHERE id = ?", [id]); await connection.commit(); res.json({ success: true, data: await getProduct(id) })
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
    // 使用 exceljs 生成导出文件，便于设置冻结首行（xlsx/SheetJS 社区版不支持写出 !freeze）
    const headers = ['序号', '商品名称', '商品编号(SKU)', '是否支持定制', '商品评分', '添加人', '分类', '售价', '原价', '库存', '销量', '单位', '生产厂家', '品牌', '状态', '描述']
    const workbook = new ExcelJS.Workbook()
    // ySplit: 1 → 冻结第一行表头（不冻结列）
    const sheet = workbook.addWorksheet('商品数据', { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }] })
    sheet.addRow(headers)
    sheet.getRow(1).font = { bold: true }
    for (const [index, row] of rows.entries()) {
      sheet.addRow([index + 1, row.name, row.sku || '', row.is_customizable ? '是' : '否', row.rating, row.created_by_name || '未知', row.category_name, Number(row.price), row.original_price === null ? '' : Number(row.original_price), row.stock, row.sales, row.unit || '', row.manufacturer || '', row.brand || '', row.status ? '上架' : '下架', row.description || ''])
    }
    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('商品数据.xlsx')}`); res.send(Buffer.from(buffer))
    await writeOperationLog(req.admin.id, 'export_products', `导出商品：${mode === 'selected' ? `${ids.length}条` : '筛选结果'}`, req)
  } catch (error) { next(error) }
})
export default router
