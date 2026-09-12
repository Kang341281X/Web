import axios from 'axios'
import { IMG_FALLBACK } from '../utils/image'

const publicApi = axios.create({ baseURL: '/api/public', timeout: 15000 })

// 适配：将后端商品格式转换为前端组件期望的格式。
// 购物车（stores/cart.js）读取服务端购物车时复用同一个适配器，
// 这样游客（localStorage）与登录用户（服务端）拿到的商品结构完全一致。
export function adaptProduct(raw) {
  return {
    id: raw.id,
    title: raw.name,
    category: raw.category_name,
    categoryId: raw.category_id,
    price: Number(raw.price) || 0,
    originalPrice: raw.original_price !== null ? Number(raw.original_price) : Number(raw.price) || 0,
    rating: raw.rating !== undefined && raw.rating !== null ? Number(raw.rating) : 5.0,
    reviewCount: raw.review_count || 0,
    seller: raw.brand || raw.manufacturer || '未知卖家',
    sellerAvatar: IMG_FALLBACK,
    image: raw.main_image_url || IMG_FALLBACK,
    images: raw.images
      ? raw.images.map(img => img.image_url).filter(Boolean)
      : [raw.main_image_url || IMG_FALLBACK],
    badge: raw.original_price !== null && raw.original_price > raw.price ? '特惠' : '',
    description: raw.description || '',
    detail: raw.detail || '',
    tags: [raw.category_name, '手工', '原创设计'],
    stock: raw.stock || 0,
    unit: raw.unit || '',
    manufacturer: raw.manufacturer || '',
    brand: raw.brand || '',
    sku: raw.sku || '',
    isCustomizable: raw.is_customizable === 1 || raw.is_customizable === true,
    createdAt: raw.created_at ? new Date(raw.created_at).getTime() / 1000 : 0,
    sales: raw.sales || 0,
    isMainImage: (index) => raw.images ? raw.images[index]?.is_main === 1 : index === 0,
  }
}

export async function fetchCategories() {
  const { data } = await publicApi.get('/categories')
  return data.data
}

export async function fetchProducts(params = {}) {
  const { data } = await publicApi.get('/products', { params })
  return { products: data.data.map(adaptProduct), pagination: data.pagination }
}

export async function fetchProduct(id) {
  const { data } = await publicApi.get(`/products/${id}`)
  return adaptProduct(data.data)
}

// 商品详情页「买家评价」：返回已显示的评论列表 + 评分概览（平均分 / 各星级条数）。
// 后端只返回 status = 1 的评论，顾客注销后仍以昵称快照展示。
export async function fetchProductReviews(productId, params = {}) {
  const { data } = await publicApi.get(`/products/${productId}/reviews`, { params })
  return { reviews: data.data, summary: data.summary, pagination: data.pagination }
}

export async function fetchSettings() {
  const { data } = await publicApi.get('/settings')
  return data.data
}

export async function saveIntentOrder(payload) {
  const { data } = await publicApi.post('/intent-orders', payload)
  return data.data
}

// 从 Content-Disposition 中解析文件名（优先 filename*=UTF-8''，兜底返回默认名）
function resolveFilename(contentDisposition, fallback = '结算清单.xlsx') {
  const utf8 = String(contentDisposition || '').match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8) {
    try { const decoded = decodeURIComponent(utf8[1]); if (decoded) return decoded } catch { /* 解码失败走兜底 */ }
  }
  const plain = String(contentDisposition || '').match(/filename="?([^";]+)"?/i)
  return (plain && plain[1]) ? plain[1] : fallback
}

// 导出购物车结算清单：由后端基于 public/assets/结算清单.xlsx 模板生成
export async function exportCheckoutList(items) {
  const { data, headers } = await publicApi.post('/checkout/export', { items }, { responseType: 'blob' })
  return { blob: data, filename: resolveFilename(headers['content-disposition']) }
}

export default publicApi
