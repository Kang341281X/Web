import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import { optionalCustomerAuth } from '../middleware/customerAuth.js'
import storageService from '../services/storageService.js'
import {
  REVIEW_HIDDEN,
  REVIEW_VISIBLE,
  parseImages,
  publicReview,
  recalcProductRating,
  removeReviewImages,
  reviewEditExpiredSql,
  toId,
} from '../utils/review.js'

/**
 * 商品评论（product_review）相关接口。
 *
 * 同文件导出两个 router，让「权限边界」和「挂载点」一一对应：
 *   - adminRouter  挂载到 /api/admin-reviews，供后台「商品管理 → 商品评论」查看 / 隐藏 / 删除；
 *   - publicRouter 挂载到 /api/public，供前台商品详情页「买家评价」按商品读取。
 *
 * 关于表设计的约定（见 server/sql/025_product_review.sql、027_product_review_updated_at.sql）：
 *   1. 评论可见性由 status 控制（1 显示 / 0 隐藏），前台只读 status = 1；
 *      隐藏与删除都会改变评分，因此每次变更后都要重算并回写 product.rating / review_count；
 *   2. customer_name 是「评论时的昵称快照」，即使顾客被删除（customer_id 置 NULL）也能正常展示，
 *      所以展示一律用 customer_name，customer 表只用来补头像、手机号等辅助信息；
 *   3. created_at 是发布时间的唯一依据（24 小时可修改窗口按它计算，不可被编辑刷新），
 *      updated_at 只用于展示「已编辑」。
 *
 * 评分重算、图片解析、24 小时窗口判断等与顾客端共用的逻辑统一放在 utils/review.js，
 * 顾客端评论接口（routes/customerReview.js）复用同一份实现，避免两边口径不一致。
 */

/* -------------------------------------------------------------------------- */
/* 后台管理：/api/admin-reviews                                                */
/* -------------------------------------------------------------------------- */
export const adminRouter = Router()
adminRouter.use(requireAuth, requirePasswordChanged)

const adminFields = `r.id, r.product_id, p.name AS product_name, r.customer_id, r.customer_name, cu.phone AS customer_phone, cu.avatar AS customer_avatar, r.rating, r.content, r.images, r.order_id, o.order_no, r.status, r.is_edited, r.created_at, r.updated_at`
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
    // 与顾客端口径保持一致：读显式字段 is_edited，不再比较 created_at / updated_at（见 032 迁移）
    edited: Boolean(review.is_edited),
  }
}

// 评论列表：分页 + 关键词（商品名 / 评价人昵称 / 评价人手机号 / 评论内容）+ 评分 / 状态 / 指定商品筛选
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
      // 带上 cu.phone 后，直接输入手机号就能一次列出该评价人的全部评价
      clauses.push('(p.name LIKE ? OR r.customer_name LIKE ? OR r.content LIKE ? OR cu.phone LIKE ?)')
      params.push(like, like, like, like)
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
    const [rows] = await db.execute('SELECT id, product_id, customer_name, images FROM product_review WHERE id = ?', [id])
    const review = rows[0]
    if (!review) return res.status(404).json({ success: false, message: '评论不存在' })

    await db.execute('DELETE FROM product_review WHERE id = ?', [id])
    const [product] = await recalcProductRating(review.product_id)
    // 评论的配图没有其它引用，删除评论后一并清理，避免 /uploads/reviews 里堆积孤儿文件
    await removeReviewImages(review.images)
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
//
// 这是公开接口，但允许带顾客 token：带了就多返回 is_mine / can_edit，
// 让前端知道「哪条是自己写的、还能不能改（24 小时内）」，从而决定编辑/删除按钮是否展示。
// 未登录（或 token 已过期）时一律按游客处理，接口结果对游客完全不变。
// 另外对已登录顾客返回 can_review（是否存在包含该商品的「已完成」订单，即发表评价的资格），
// 前端据此决定「写评价」入口是否展示——与 customerReview.js POST 的服务端校验同一口径。
publicRouter.get('/products/:id/reviews', optionalCustomerAuth, async (req, res, next) => {
  try {
    const productId = toId(req.params.id)
    if (!productId) return res.status(404).json({ success: false, message: '商品不存在' })

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 20, 1), 50)
    const rating = Number.parseInt(req.query.rating, 10)
    // 用 0 代替「未登录」：customer_id 不会是 0，NULL = 0 也不成立，因此不会误判成自己的评论
    const customerId = req.customer?.id || 0

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

    // 发表评价的资格（游客为 null，前端按「未登录」引导登录；口径与 customerReview.js 的 POST 一致）
    let canReview = null
    if (req.customer) {
      const [[order]] = await db.execute(
        `SELECT 1 AS ok FROM customer_order o
           JOIN order_item oi ON oi.order_id = o.id
          WHERE o.customer_id = ? AND o.status = 'completed' AND oi.product_id = ?
          LIMIT 1`,
        [req.customer.id, productId]
      )
      canReview = Boolean(order)
    }

    const [rows] = await db.execute(
      `SELECT r.id, r.product_id, r.customer_name, cu.avatar AS customer_avatar, r.rating, r.content, r.images, r.order_id,
              (r.customer_id = ?) AS is_mine,
              ${reviewEditExpiredSql('r.')} AS edit_expired,
              r.is_edited, r.created_at, r.updated_at
       FROM product_review r LEFT JOIN customer cu ON cu.id = r.customer_id
       ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [customerId, ...params, pageSize, (page - 1) * pageSize]
    )

    res.json({
      success: true,
      data: rows.map(publicReview),
      can_review: canReview,
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
