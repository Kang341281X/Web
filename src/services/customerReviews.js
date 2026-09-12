import customerApi from './customerApi'

/**
 * 顾客端评价接口（/api/customer）。
 *
 * 对应后端 routes/customerReview.js：
 *   POST   /products/:productId/reviews  发布评价
 *   PUT    /reviews/:id                  修改自己 24 小时内发布的评价
 *   DELETE /reviews/:id                  删除自己发布的评价（不限时）
 *
 * 配图走 multipart/form-data，字段名与后端 multer 保持一致（images）。
 * 这里刻意不手动设置 Content-Type：必须让浏览器自动带上 multipart 的 boundary，
 * 手写 'multipart/form-data' 会因为缺少 boundary 导致后端解析不出文件。
 */

function buildForm({ rating, content, images = [] }) {
  const form = new FormData()
  form.append('rating', String(rating))
  form.append('content', content)
  images.forEach(file => form.append('images', file))
  return form
}

// 发布评价
export async function createProductReview(productId, { rating, content, images = [] }) {
  const { data } = await customerApi.post(`/products/${productId}/reviews`, buildForm({ rating, content, images }))
  return data
}

// 修改评价：keepImages 为「编辑后保留的原有配图」，
// 传完整地址也可以，后端会归一化后再与库里路径比对（见 customerReview.js 的 toStoredPath）
export async function updateCustomerReview(reviewId, { rating, content, images = [], keepImages = [] }) {
  const form = buildForm({ rating, content, images })
  form.append('keep_images', JSON.stringify(keepImages))
  const { data } = await customerApi.put(`/reviews/${reviewId}`, form)
  return data
}

// 删除评价：不限时间，仅校验归属
export async function deleteCustomerReview(reviewId) {
  const { data } = await customerApi.delete(`/reviews/${reviewId}`)
  return data
}
