import db from '../config/db.js'
import storageService from '../services/storageService.js'

/**
 * 商品评论（product_review）公共逻辑。
 *
 * 抽出来的原因：管理员接口（routes/reviews.js 的 adminRouter）与顾客接口（routes/customerReview.js）
 * 必须共用同一条业务规则——product.rating / product.review_count 只能由「可见评论」推导出来，
 * 只有一份实现才能保证「后台隐藏评论」和「顾客删除评论」算出来的评分完全一致。
 *
 * 表结构约定见 server/sql/025_product_review.sql、027_product_review_updated_at.sql：
 *   - status：1 显示 / 0 隐藏，前台只读 1；
 *   - customer_name：评论时的昵称快照，账号被删（customer_id 置 NULL）也能正常展示；
 *   - created_at：发布时间，也是 24 小时可修改窗口的计算依据，任何修改都不得改写它；
 *   - updated_at：最后一次修改时间，仅用于展示；
 *   - is_edited：是否被编辑过（0/1），「已编辑」标记的唯一依据（见 032_product_review_is_edited.sql）。
 */

export const REVIEW_VISIBLE = 1
export const REVIEW_HIDDEN = 0

// 评论发布后可修改的时间窗口（小时）：超时后只能删除，不能再改
export const REVIEW_EDIT_WINDOW_HOURS = 24

// 单条评论最多上传几张配图
export const REVIEW_MAX_IMAGES = 6

export function toId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 「该评论是否已超出可修改窗口」的 SQL 片段。
 *
 * 为什么放在 SQL 里算：created_at 由 CURRENT_TIMESTAMP 写入（SQLite 的时间函数统一按 UTC），
 * 而 Node 解析 'YYYY-MM-DD HH:MM:SS' 这种字符串时按「本地时区」处理，
 * 两边直接比较会产生时区偏差（东八区会凭空多出 8 小时），关键的时间窗口判断不能交给它。
 *
 * 需要传别名（如 'r.'）：调用方的查询可能 JOIN 了同样带 created_at 的表（customer 也有该列），
 * 不加限定会出现 ambiguous column name。
 */
export function reviewEditExpiredSql(alias = '') {
  return `(${alias}created_at <= datetime('now', '-${REVIEW_EDIT_WINDOW_HOURS} hours'))`
}

/**
 * 解析 images 字段。库里存的是 JSON 数组字符串（如 '["/uploads/reviews/a.jpg"]'）。
 * absolute = true（默认）时转成可直接访问的完整地址，用于接口输出；
 * absolute = false 时返回库里的相对路径，用于删除文件、校验「保留哪些旧图」等内部逻辑。
 * 解析失败或为空统一返回空数组，避免前端拿到字符串后当数组遍历报错。
 */
export function parseImages(value, { absolute = true } = {}) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    const paths = parsed.filter(item => typeof item === 'string' && item.trim())
    return absolute ? paths.map(item => storageService.getUrl(item) || item) : paths
  } catch {
    return []
  }
}

/**
 * 按「可见评论」重算商品平均分与评论数。
 * product_review 是评分的唯一数据来源，隐藏 / 删除 / 新增评论后若不重算，详情页顶部的评分会不准。
 * 没有可见评论时评分回落到建表默认值 5.0，避免写入 NULL（product.rating 为 NOT NULL）。
 *
 * 可传入事务连接复用（connection），默认用全局连接。
 */
export async function recalcProductRating(productIds, connection = db) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [productIds]).map(toId).filter(Boolean))]
  const result = []
  for (const id of ids) {
    const [[row]] = await connection.execute(
      'SELECT COUNT(*) AS total, AVG(rating) AS average FROM product_review WHERE product_id = ? AND status = ?',
      [id, REVIEW_VISIBLE]
    )
    const total = Number(row.total) || 0
    const rating = total ? Number(Number(row.average).toFixed(1)) : 5.0
    await connection.execute('UPDATE product SET rating = ?, review_count = ? WHERE id = ?', [rating, total, id])
    result.push({ product_id: id, rating, review_count: total })
  }
  return result
}

/**
 * 删除评论配图文件（评论被删除、或编辑时移除了某张图）。
 * 只处理 /uploads/ 下的文件，失败不阻断主流程——图片残留只是浪费一点磁盘，
 * 但让「删评论」因为文件删不掉而报错，用户会以为评论没删掉。
 */
export async function removeReviewImages(images) {
  const paths = parseImages(images, { absolute: false })
  await Promise.all(paths.map(path => storageService.delete(path).catch(error => {
    console.error(`无法删除评论图片 ${path}`, error)
  })))
}

/**
 * 评论输出结构（顾客端 / 前台商品详情共用）。
 * is_mine / edit_expired 由调用方的 SQL 计算后带进来（见 loadReview* 系列查询），
 * can_edit 是给前端决定「编辑」按钮是否展示用的，真正的拦截仍在服务端。
 */
export function publicReview(review) {
  const isMine = Boolean(review.is_mine)
  return {
    id: review.id,
    product_id: review.product_id,
    customer_name: review.customer_name,
    avatar_url: storageService.getUrl(review.customer_avatar),
    rating: Number(review.rating),
    content: review.content,
    images: parseImages(review.images),
    is_purchased: Boolean(review.order_id),
    is_mine: isMine,
    can_edit: isMine && !Boolean(review.edit_expired),
    // 「已编辑」取显式字段，不再比较时间戳：datetime('now') 精度只到秒，
    // 发布后 1 秒内修改会让 updated_at === created_at，从而漏判（见 032 迁移）。
    edited: Boolean(review.is_edited),
    created_at: review.created_at,
    updated_at: review.updated_at || review.created_at,
  }
}
