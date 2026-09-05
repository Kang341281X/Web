import axios from 'axios'

const publicApi = axios.create({ baseURL: '/api/public', timeout: 15000 })

// 适配：将后端商品格式转换为前端组件期望的格式
function adaptProduct(raw) {
  return {
    id: raw.id,
    title: raw.name,
    category: raw.category_name,
    categoryId: raw.category_id,
    price: Number(raw.price) || 0,
    originalPrice: raw.original_price !== null ? Number(raw.original_price) : Number(raw.price) || 0,
    rating: 5.0,
    reviewCount: 0,
    seller: raw.brand || raw.manufacturer || '未知卖家',
    sellerAvatar: '/assets/images/avatars/avatar-placeholder.svg',
    image: raw.main_image_url || '/assets/images/products/product-placeholder.svg',
    images: raw.images
      ? raw.images.map(img => img.image_url)
      : [raw.main_image_url || '/assets/images/products/product-placeholder.svg'],
    badge: raw.original_price !== null && raw.original_price > raw.price ? '特惠' : '',
    description: raw.description || '',
    detail: raw.detail || '',
    tags: [raw.category_name, '手工', '原创设计'],
    stock: raw.stock || 0,
    unit: raw.unit || '',
    manufacturer: raw.manufacturer || '',
    brand: raw.brand || '',
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

export async function fetchSettings() {
  const { data } = await publicApi.get('/settings')
  return data.data
}

export default publicApi
