import { defineStore } from 'pinia'

const STORAGE_KEY = 'craftora-cart'

const readCart = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    const items = raw.filter(item => item?.product?.id && Number(item.quantity) > 0)
    if (items.length !== raw.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    return items
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

export const useCartStore = defineStore('cart', {
  state: () => ({ items: readCart() }),
  getters: {
    count: s => s.items.reduce((n, item) => n + item.quantity, 0),
    subtotal: s => s.items.reduce((n, item) => n + item.product.price * item.quantity, 0)
  },
  actions: {
    persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items)) },
    add(product, quantity = 1) {
      const found = this.items.find(i => i.product.id === product.id)
      if (found) found.quantity = Math.min(found.quantity + quantity, product.stock)
      else this.items.push({ product, quantity })
      this.persist()
    },
    setQuantity(id, quantity) {
      const item = this.items.find(i => i.product.id === id)
      if (!item) return
      item.quantity = Math.max(1, Math.min(quantity, item.product.stock))
      this.persist()
    },
    remove(id) {
      this.items = this.items.filter(i => i.product.id !== id)
      this.persist()
    },
    clear() {
      this.items = []
      this.persist()
    }
  }
})
