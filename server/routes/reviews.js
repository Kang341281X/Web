import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'

/**
 * 商品评论（product_review）相关接口。
 *
 * 同文件导出两个 router，让「权限边界」和「挂载点」一一对应：
 *   - adminRouter  挂载到 /api/admin-reviews，供后台「商品管理 → 商品评论」查看 / 隐藏 / 删除；
 *   - publicRouter 挂载到 /api/public，供前台商品详情页「买家评价」按商品读取。
 *
 * 关于表设计的两点约定（见 server/sql/025_product_review.sql）：
 *   1. 评论可见性由 status 控制（1 显示 / 0 隐藏），前台只读 status = 1；
 *      隐藏与删除都会改变评分，因此每次变更后都要重算并回写 product.rating / review_count；
 *   2. customer_name 是「评论时的昵称快照」，即使顾客被删除（customer_id 置 NULL）也能正常展示，
 *      所以展示一律用 customer_name，customer 表只用来补头像、手机号等辅助信息。
 */

const REVIEW_VISIBLE = 1
const REVIEW_HIDDEN = 0

function toId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// images 在库里存 JSON 数组字符串（如 '["/uploads/products/a.jpg"]'），本阶段前端尚未实现上传。
// 解析失败或为空统一返回空数组，避免前端拿到字符串后当数组遍历报错。
function parseImages(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item.trim()).map(item => storageService.getUrl(item) || item)
      : []
  } catch {
    return []
  }
}

/**
 * 按「可见评论」重算商品平均分与评论数。
 * product_review 是评分的唯一数据来源，隐藏 / 删除评论后若不重算，详情页顶部的评分会虚高。
 * 没有可见评论时评分回落到建表默认值 5.0，避免写入 NULL（product.rating 为 NOT NULL）。
 */
async function recalcProductRating(productIds) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [productIds]).map(toId).filter(Boolean))]
  const result = []
  for (const id of ids) {
    const [[row]] = await db.execute(
      'SELECT COUNT(*) AS total, AVG(rating) AS average FROM product_review WHERE product_id = ? AND status = ?',
      [id, REVIEW_VISIBLE]
    )
    const total = Number(row.total) || 0
    const rating = total ? Number(Number(row.average).toFixed(1)) : 5.0
    await db.execute('UPDATE product SET rating = ?, review_count = ? WHERE id = ?', [rating, total, id])
    result.push({ product_id: id, rating, review_count: total })
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* 后台管理：/api/admin-reviews                                                */
/* -------------------------------------------------------------------------- */
export const adminRouter = Router()
adminRouter.use(requireAuth, requirePasswordChanged)

const adminFields = `r.id, r.product_id, p.name AS product_name, r.customer_id, r.customer_name, cu.phone AS customer_phone, cu.avatar AS customer_avatar, r.rating, r.content, r.images, r.order_id, o.order_no, r.status, r.created_at`
const adminFrom = `FROM product_review r
  LEFT JOIN product p ON p.id = r.product_id
  LEFT JOIN customer cu ON cu.id = r.customer_id
  LEFT JOIN customer_order o ON o.id = r.order_id`

function adminReviewRow(review) {
  return {
    ...review,
    images: parseImages(review.images),
    customer_avatar_url: storageService.getUrl(review.customer_avatar),
    is_purchased: Boolean(review.order_id),
  }
}

// 评论列表：分页 + 关键词（商品名 / 评价人 / 评论内容）+ 评分 / 状态 / 指定商品筛选
adminRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 100)
    const keyword = String(req.query.keyword || '').trim()
    const rating = Number.parseInt(req.query.rating, 10)
    const status = req.query.status
    const productId = toId(req.query.product_id)

    const clauses = []
    const params = []
    if (keyword) {
      const like = `%${keyword}%`
      clauses.push('(p.name LIKE ? OR r.customer_name LIKE ? OR r.content LIKE ?)')
      params.push(like, like, like)
    }
    if (productId) { clauses.push('r.product_id = ?'); params.push(productId) }
    if ([1, 2, 3, 4, 5].includes(rating)) { clauses.push('r.rating = ?'); params.push(rating) }
    if (status === '0' || status === '1') { clauses.push('r.status = ?'); params.push(Number(status)) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total ${adminFrom} ${where}`, params)
    const [rows] = await db.execute(
      `SELECT ${adminFields} ${adminFrom} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: rows.map(adminReviewRow), pagination: { page, page_size: pageSize, total } })
  } catch (error) { next(error) }
})

// 顶部统计卡片：总数 / 显示中 / 已隐藏 / 平均分 / 今日新增。
// 必须注册在 '/:id' 之前，否则 stats 会被当成评论 id。
adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total_reviews,
              COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS visible_reviews,
              COALESCE(SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END), 0) AS hidden_reviews,
              COALESCE(AVG(CASE WHEN status = 1 THEN rating END), 0) AS average_rating,
              COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today_new
       FROM product_review`
    )
    res.json({
      success: true,
      data: {
        total_reviews: Number(row.total_reviews),
        visible_reviews: Number(row.visible_reviews),
        hidden_reviews: Number(row.hidden_reviews),
        average_rating: Number(Number(row.average_rating).toFixed(1)),
        today_new: Number(row.today_new),
      },
    })
  } catch (error) { next(error) }
})

// 显示 / 隐藏评论：隐藏后前台立即不可见，并同步重算商品评分
adminRouter.put('/:id/status', async (req, res, next) => {
  try {
    const id = toId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '评论不存在' })
    const status = [1, '1', true, 'true'].includes(req.body.status) ? REVIEW_VISIBLE
      : [0, '0', false, 'false'].includes(req.body.status) ? REVIEW_HIDDEN : null
    if (status === null) return res.status(400).json({ success: false, message: '状态参数不正确' })

    const [rows] = await db.execute('SELECT id, product_id, customer_name, status FROM product_review WHERE id = ?', [id])
    const review = rows[0]
    if (!review) return res.status(404).json({ success: false, message: '评论不存在' })

    // 状态未变化时直接返回，保持幂等，也避免写入无意义的操作日志
    if (review.status === status) {
      return res.json({
        success: true,
        changed: false,
        message: status ? '该评论已处于显示状态' : '该评论已处于隐藏状态',
        product: (await recalcProductRating(review.product_id))[0],
      })
    }

    await db.execute('UPDATE product_review SET status = ? WHERE id = ?', [status, id])
    const [product] = await recalcProductRating(review.product_id)
    await writeOperationLog(
      req.admin.id,
      'update_review_status',
      `评论 #${id}（${review.customer_name}）→ ${status ? '显示' : '隐藏'}`,
      req
    )

    res.json({
      success: true,
      changed: true,
      message: status ? '评论已显示，商品评分已同步' : '评论已隐藏，前台不再展示，商品评分已同步',
      product,
    })
  } catch (error) { next(error) }
})

// 删除评论：不可恢复，删除后同步重算商品评分
adminRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id)
    if (!id) return res.status(404).json({ success: false, message: '评论不存在' })
    const [rows] = await db.execute('SELECT id, product_id, customer_name FROM product_review WHERE id = ?', [id])
    const review = rows[0]
    if (!review) return res.status(404).json({ success: false, message: '评论不存在' })

    await db.execute('DELETE FROM product_review WHERE id = ?', [id])
    const [product] = await recalcProductRating(review.product_id)
    await writeOperationLog(req.admin.id, 'delete_review', `删除评论 #${id}（${review.customer_name}）`, req)

    res.json({ success: true, message: '评论已删除，商品评分已同步', product })
  } catch (error) { next(error) }
})

/* -------------------------------------------------------------------------- */
/* 前台：/api/public                                                           */
/* -------------------------------------------------------------------------- */
export const publicRouter = Router()

// 前台商品详情「买家评价」：只返回显示中的评论，并附带评分概览（平均分 + 各星级条数）。
// 顾客可能已注销（customer_id 为 NULL），因此展示统一用 customer_name 快照。
publicRouter.get('/products/:id/reviews', async (req, res, next) => {
  try {
    const productId = toId(req.params.id)
    if (!productId) return res.status(404).json({ success: false, message: '商品不存在' })

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 50)
    const rating = Number.parseInt(req.query.rating, 10)

    const clauses = ['r.product_id = ?', 'r.status = ?']
    const params = [productId, REVIEW_VISIBLE]
    if ([1, 2, 3, 4, 5].includes(rating)) { clauses.push('r.rating = ?'); params.push(rating) }
    const where = `WHERE ${clauses.join(' AND ')}`

    // 概览统计不受星级筛选影响，始终按该商品的全部可见评论计算
    const [[summary]] = await db.execute(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(rating), 0) AS average,
              COALESCE(SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END), 0) AS rating_5,
              COALESCE(SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END), 0) AS rating_4,
              COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0) AS rating_3,
              COALESCE(SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END), 0) AS rating_2,
              COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) AS rating_1
       FROM product_review r WHERE r.product_id = ? AND r.status = ?`,
      [productId, REVIEW_VISIBLE]
    )

    const [rows] = await db.execute(
      `SELECT r.id, r.customer_name, cu.avatar AS customer_avatar, r.rating, r.content, r.images, r.order_id, r.created_at
       FROM product_review r LEFT JOIN customer cu ON cu.id = r.customer_id
       ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )

    res.json({
      success: true,
      data: rows.map(review => ({
        id: review.id,
        customer_name: review.customer_name,
        avatar_url: storageService.getUrl(review.customer_avatar),
        rating: Number(review.rating),
        content: review.content,
        images: parseImages(review.images),
        is_purchased: Boolean(review.order_id),
        created_at: review.created_at,
      })),
      summary: {
        total: Number(summary.total),
        average: Number(Number(summary.average).toFixed(1)),
        distribution: {
          5: Number(summary.rating_5),
          4: Number(summary.rating_4),
          3: Number(summary.rating_3),
          2: Number(summary.rating_2),
          1: Number(summary.rating_1),
        },
      },
      pagination: { page, page_size: pageSize, total: Number(summary.total) },
    })
  } catch (error) { next(error) }
})
