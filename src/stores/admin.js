import { defineStore } from 'pinia'
import { products as seedProducts } from '../data/products'

function nextId(list) {
  return list.reduce((max, p) => Math.max(max, p.id), 0) + 1
}

function createProduct(raw, id) {
  return {
    id: id ?? nextId(raw._list || [raw]),
    title: raw.title || '未命名商品',
    category: raw.category || 'gifts',
    price: Number(raw.price) || 0,
    originalPrice: Number(raw.originalPrice) || Number(raw.price) || 0,
    rating: Number(raw.rating) || 5.0,
    reviewCount: Number(raw.reviewCount) || 0,
    seller: raw.seller || '未知卖家',
    image: raw.image || '/assets/images/products/product-placeholder.svg',
    images: parseImages(raw.images, raw.image),
    badge: raw.badge || '',
    description: raw.description || '',
    tags: raw.tags || [raw.category, '手工', '原创设计'],
    stock: Number(raw.stock) || 0,
    createdAt: raw.createdAt || Date.now(),
    sales: Number(raw.sales) || 0
  }
}

function parseImages(raw, fallback) {
  const ph = '/assets/images/products/product-placeholder.svg'
  if (Array.isArray(raw) && raw.length) return raw
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  }
  return [fallback || ph]
}

export const useAdminStore = defineStore('admin', {
  state: () => ({
    products: JSON.parse(JSON.stringify(seedProducts)),
    searchKeyword: '',
    filterCategory: 'all',
    sortBy: 'createdAt',
    sortDir: 'desc'
  }),

  getters: {
    filtered(state) {
      let list = [...state.products]
      if (state.searchKeyword) {
        const kw = state.searchKeyword.toLowerCase()
        list = list.filter(p =>
          p.title.toLowerCase().includes(kw) ||
          p.seller.toLowerCase().includes(kw) ||
          String(p.id).includes(kw)
        )
      }
      if (state.filterCategory !== 'all') {
        list = list.filter(p => p.category === state.filterCategory)
      }
      const dir = state.sortDir === 'asc' ? 1 : -1
      list.sort((a, b) => {
        const va = a[state.sortBy]
        const vb = b[state.sortBy]
        if (typeof va === 'number') return (va - (typeof vb === 'number' ? vb : 0)) * dir
        return String(va).localeCompare(String(vb)) * dir
      })
      return list
    },

    stats(state) {
      const total = state.products.length
      const totalStock = state.products.reduce((s, p) => s + (p.stock || 0), 0)
      const totalSales = state.products.reduce((s, p) => s + (p.sales || 0), 0)
      const categories = new Set(state.products.map(p => p.category)).size
      return { total, totalStock, totalSales, categories }
    }
  },

  actions: {
    getById(id) {
      return this.products.find(p => p.id === Number(id))
    },

    addProduct(raw) {
      const product = createProduct(raw, nextId(this.products))
      this.products.unshift(product)
      return product
    },

    updateProduct(id, patch) {
      const idx = this.products.findIndex(p => p.id === Number(id))
      if (idx === -1) return null
      const merged = { ...this.products[idx], ...patch }
      if (patch.images !== undefined) {
        merged.images = parseImages(patch.images, merged.image)
      }
      this.products[idx] = merged
      return merged
    },

    deleteProduct(id) {
      const idx = this.products.findIndex(p => p.id === Number(id))
      if (idx > -1) this.products.splice(idx, 1)
    },

    batchAdd(rawList) {
      let added = 0
      rawList.forEach(raw => {
        const product = createProduct(raw, nextId(this.products))
        this.products.unshift(product)
        added++
      })
      return added
    },

    batchReplace(rawList) {
      // 完全替换，保留原有 id 分配新 id
      this.products = rawList.map((raw, i) => createProduct(raw, i + 1))
      return this.products.length
    },

    setSearch(kw) { this.searchKeyword = kw },
    setCategory(cat) { this.filterCategory = cat },
    setSortBy(field) {
      if (this.sortBy === field) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        this.sortBy = field
        this.sortDir = 'asc'
      }
    },

    // 根据商品 id 生成图片目录路径
    getImageDir(id) {
      return `/assets/products/${id}/`
    },

    // 根据商品 id 和数量生成图片路径数组
    generateImagePaths(id, count = 1) {
      const dir = this.getImageDir(id)
      const paths = []
      for (let i = 1; i <= Math.min(count, 6); i++) {
        paths.push(`${dir}${i}.jpg`)
      }
      return paths.length ? paths : ['/assets/images/products/product-placeholder.svg']
    }
  }
})
