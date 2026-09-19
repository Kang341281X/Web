import { Router } from 'express'
import multer from 'multer'
import db from '../config/db.js'
import { requireCustomerAuth } from '../middleware/customerAuth.js'
import storageService from '../services/storageService.js'
import { maskPhone, requiredText } from '../utils/customer.js'
import {
  REVIEW_MAX_IMAGES,
  parseImages,
  publicReview,
  recalcProductRating,
  removeReviewImages,
  reviewEditExpiredSql,
  toId,
} from '../utils/review.js'

/**
 * 顾客端商品评论（/api/customer）。
 *
 *   POST   /products/:productId/reviews  发布评价（评分 + 文字 + 可选配图）
 *   PUT    /reviews/:id                  修改自己发布的评价，发布超过 24 小时拒绝
 *   DELETE /reviews/:id                  删除自己发布的评价，不限时
 *
 * 与后台「商品管理 → 商品评论」（routes/reviews.js）的关系：
 *   - 评分重算、图片解析、24 小时窗口判断共用 utils/review.js，不重复实现；
 *   - 后台改 status 或删除都会重算评分，本文件的增/改/删同样重算，因此前台评分始终一致。
 *
 * 只有「已完成（status = completed）」订单中包含该商品的顾客才能评价（见下方 POST 的资格校验）；
 * 发布时把命中的订单 id 写入 order_id，评论列表的 is_purchased（已购买标识）由此生效。
 */

const router = Router()
router.use(requireCustomerAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: REVIEW_MAX_IMAGES },
})

const reviewFields = 'r.id, r.product_id, r.customer_id, r.customer_name, r.rating, r.content, r.images, r.order_id, r.status, r.is_edited, r.created_at, r.updated_at'

// 读取单条评论，并带上「是否本人」「是否超出可修改窗口」：接口要据此告诉前端按钮该不该显示
async function loadReview(id, customerId) {
  const [rows] = await db.execute(
    `SELECT ${reviewFields}, (r.customer_id = ?) AS is_mine, ${reviewEditExpiredSql('r.')} AS edit_expired
     FROM product_review r WHERE r.id = ?`,
    [customerId, id]
  )
  return rows[0] || null
}

// 评分：1-5 的整数
function requiredRating(value) {
  const rating = Number.parseInt(value, 10)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw Object.assign(new Error('评分应为 1-5 分'), { status: 400 })
  }
  return rating
}

// 保存上传的配图，返回库里的相对路径数组（类型与大小由 storageService.validateImage 二次校验）
async function saveImages(files) {
  const list = (Array.isArray(files) ? files : []).filter(Boolean)
  const saved = []
  try {
    for (const file of list) saved.push(await storageService.save(file, 'reviews'))
    return saved
  } catch (error) {
    // 中途失败时把已经落盘的图片删掉，避免留下无人引用的孤儿文件
    await removeReviewImages(saved)
    throw error
  }
}

/**
 * 抹掉 PUBLIC_BASE_URL 前缀，还原成库里保存的相对路径。
 * 前端拿到的是完整地址（storageService.getUrl 会拼上 PUBLIC_BASE_URL 或站点域名），
 * 而这些地址会被原样回传；直接和库里的 '/uploads/...' 比对会全部对不上，
 * 结果是「编辑时原有配图被当成已移除」，所以两边都先归一化再比。
 */
function toStoredPath(value) {
  const text = String(value || '').trim()
  const index = text.indexOf('/uploads/')
  return index >= 0 ? text.slice(index) : text
}

/**
 * 归一「编辑时要保留哪些旧图」。
 * 只接受本来就属于这条评论的路径——否则可以借编辑接口把别人的图片路径写进自己的评论
 * （虽然只是展示层引用，但没有任何理由允许）。
 */
function pickKeptImages(rawValue, currentImages) {
  let parsed = rawValue
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue) } catch { throw Object.assign(new Error('图片参数格式不正确'), { status: 400 }) }
  }
  if (!Array.isArray(parsed)) throw Object.assign(new Error('图片参数格式不正确'), { status: 400 })
  const owned = new Set(currentImages.map(toStoredPath))
  return parsed.map(toStoredPath).filter(path => owned.has(path))
}

// 发布评价
router.post('/products/:productId/reviews', upload.array('images', REVIEW_MAX_IMAGES), async (req, res, next) => {
  try {
    const body = req.body || {}
    const productId = toId(req.params.productId)
    if (!productId) return res.status(404).json({ success: false, message: '商品不存在' })

    const [products] = await db.execute('SELECT id, name, status FROM product WHERE id = ?', [productId])
    const product = products[0]
    if (!product || !product.status) return res.status(404).json({ success: false, message: '商品不存在或已下架' })

    // 购买资格：只允许评价自己「已完成」订单中出现过的商品（取消的不算，order_item.product_id
    // 在商品被硬删除后会置 NULL，也不会误命中）。取最近一笔命中的订单绑定到评论，
    // order_id 非空即 is_purchased = true，前台与后台的「已购买」标识由此生效。
    const [orders] = await db.execute(
      `SELECT o.id FROM customer_order o
         JOIN order_item oi ON oi.order_id = o.id
        WHERE o.customer_id = ? AND o.status = 'completed' AND oi.product_id = ?
        ORDER BY o.id DESC LIMIT 1`,
      [req.customer.id, productId]
    )
    const order = orders[0]
    if (!order) return res.status(400).json({ success: false, message: '请先购买该商品后再评价' })

    const rating = requiredRating(body.rating)
    const content = requiredText(body.content, '评价内容', { min: 1, max: 500 })
    const images = await saveImages(req.files)

    // customer_name 取用户名快照（昵称已并入用户名），用户名为空时退化为脱敏手机号：
    // 评论列表是公开的，不能把完整手机号暴露出去（与 utils/customer.js 的脱敏口径一致）
    const [result] = await db.execute(
      `INSERT INTO product_review (product_id, customer_id, customer_name, rating, content, images, order_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        productId,
        req.customer.id,
        req.customer.username || maskPhone(req.customer.phone),
        rating,
        content,
        images.length ? JSON.stringify(images) : null,
        order.id,
      ]
    )

    const productStat = (await recalcProductRating(productId))[0]
    const review = await loadReview(result.insertId, req.customer.id)
    res.status(201).json({ success: true, message: '评价已发布', data: publicReview(review), product: productStat })
  } catch (error) { next(error) }
})

// 修改自己发布的评价：归属校验 + 发布超过 24 小时拒绝
router.put('/reviews/:id', upload.array('images', REVIEW_MAX_IMAGES), async (req, res, next) => {
  let saved = []
  let applied = false
  try {
    const body = req.body || {}
    const id = toId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '评论不存在' })

    const [rows] = await db.execute(
      `SELECT ${reviewFields}, ${reviewEditExpiredSql('r.')} AS edit_expired FROM product_review r WHERE r.id = ?`,
      [id]
    )
    const review = rows[0]
    if (!review) return res.status(404).json({ success: false, message: '评论不存在' })

    // 归属校验：只能改自己的评价。账号被删除后 customer_id 会被置为 NULL（见 025），这类评论同样不可改
    if (review.customer_id === null || Number(review.customer_id) !== req.customer.id) {
      return res.status(403).json({ success: false, message: '只能修改自己发布的评价' })
    }
    // 时间窗口校验：以 created_at 为准（不是 updated_at），改过也不会重新获得 24 小时
    if (Boolean(review.edit_expired)) {
      return res.status(400).json({ success: false, message: '评论发布超过 24 小时，无法修改' })
    }

    const updates = []
    const values = []
    if (body.rating !== undefined) { updates.push('rating = ?'); values.push(requiredRating(body.rating)) }
    if (body.content !== undefined) { updates.push('content = ?'); values.push(requiredText(body.content, '评价内容', { min: 1, max: 500 })) }

    // 图片是「整体替换」语义：保留的旧图 + 本次新上传的图。
    // 只有传了 keep_images 或真的选了新图片才动 images，否则保持原样，避免误删配图。
    const currentImages = parseImages(review.images, { absolute: false })
    const keepImages = (body.keep_images === undefined && !(req.files || []).length)
      ? null
      : (body.keep_images === undefined ? currentImages : pickKeptImages(body.keep_images, currentImages))
    if (keepImages) {
      saved = await saveImages(req.files)
      const finalImages = [...new Set([...keepImages, ...saved])]
      updates.push('images = ?')
      values.push(finalImages.length ? JSON.stringify(finalImages) : null)
      // 被移除的旧图在更新成功后再删文件（见下方），这里先记下来
    }
    if (!updates.length) return res.status(400).json({ success: false, message: '没有可保存的更改' })

    // updated_at 记录最后修改时间；is_edited 显式置 1——「已编辑」标记不再依赖时间戳比较：
    // datetime('now') 精度只到秒，发布后 1 秒内修改会让 updated_at 与 created_at 相同（见 032 迁移）
    updates.push("updated_at = datetime('now')", 'is_edited = 1')
    values.push(id)
    await db.execute(`UPDATE product_review SET ${updates.join(', ')} WHERE id = ?`, values)
    // 更新已落库：新图片从这一刻起被评论引用（见下方注释，报错时不能再删）
    applied = true

    const productStat = (await recalcProductRating(review.product_id))[0]
    const removedImages = keepImages ? currentImages.filter(path => !keepImages.includes(path)) : []
    if (removedImages.length) await removeReviewImages(removedImages)

    const updated = await loadReview(id, req.customer.id)
    res.json({ success: true, message: '评价已更新', data: publicReview(updated), product: productStat })
  } catch (error) {
    // 更新还没落库时才清理本次新上传的图片；已落库的图片正被评论引用，删掉会让评价出现坏图
    if (!applied && saved.length) await removeReviewImages(saved)
    next(error)
  }
})

// 删除自己发布的评价：只校验归属，不限时间（发布多久都可以删）
router.delete('/reviews/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '评论不存在' })

    const [rows] = await db.execute('SELECT id, product_id, customer_id, customer_name, images FROM product_review WHERE id = ?', [id])
    const review = rows[0]
    if (!review) return res.status(404).json({ success: false, message: '评论不存在' })
    if (review.customer_id === null || Number(review.customer_id) !== req.customer.id) {
      return res.status(403).json({ success: false, message: '只能删除自己发布的评价' })
    }

    await db.execute('DELETE FROM product_review WHERE id = ?', [id])
    const productStat = (await recalcProductRating(review.product_id))[0]
    await removeReviewImages(review.images)

    res.json({ success: true, message: '评价已删除，商品评分已同步', data: { id, product: productStat } })
  } catch (error) { next(error) }
})

export default router
