import { defineStore } from 'pinia'
import customerApi, { isCustomerLoggedIn } from '../services/customerApi'
import { adaptProduct } from '../services/publicApi'

const STORAGE_KEY = 'craftora-cart'

/**
 * 购物车有两种数据源：
 * - 未登录：localStorage（游客可以随便逛随便加，行为与改造前完全一致）
 * - 已登录：服务端 /api/customer/cart（阶段 4 接口），不再写 localStorage
 * 登录成功瞬间把游客购物车合并到服务端，合并成功后清空 localStorage 并改用服务端数据。
 */

const readLocal = () => {
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

const writeLocal = items => localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
const clearLocal = () => localStorage.removeItem(STORAGE_KEY)

const errorMessage = (error, fallback) => error.response?.data?.message || fallback

// 服务端返回的是「商品字段 + quantity」的扁平行：商品 id 别名为 product_id，
// created_at / updated_at 是购物车行自己的时间。这里剔除行字段后复用前台商品适配器，
// 还原成组件统一使用的 { product, quantity }
const adaptItem = row => {
  const { cart_id, quantity, created_at, updated_at, ...product } = row
  return { product: adaptProduct({ ...product, id: product.product_id }), quantity }
}

export const useCartStore = defineStore('cart', {
  // 未登录时读游客数据；登录态下由 main.js（刷新恢复）或登录流程从服务端覆盖
  state: () => ({ items: readLocal(), loading: false }),
  getters: {
    count: s => s.items.reduce((n, item) => n + item.quantity, 0),
    subtotal: s => s.items.reduce((n, item) => n + item.product.price * item.quantity, 0)
  },
  actions: {
    persist() { writeLocal(this.items) },

    // ---------- 与服务端同步（仅登录态）----------
    applyServer(rows) { this.items = (rows || []).map(adaptItem) },

    // 拉取服务端购物车并覆盖本地状态
    async fetchFromServer() {
      this.loading = true
      try {
        const { data } = await customerApi.get('/cart')
        this.applyServer(data.data)
        return { success: true }
      } catch (error) {
        return { success: false, message: errorMessage(error, '获取购物车失败') }
      } finally {
        this.loading = false
      }
    },

    // 把游客购物车合并到服务端，并用返回的完整购物车覆盖本地状态。
    // 只有合并成功才清空 localStorage：失败时保留游客数据，下次登录会重试合并
    async mergeGuestCart() {
      const guest = readLocal()
      this.loading = true
      try {
        const { data } = await customerApi.post('/cart/merge', guest.map(item => ({ product_id: item.product.id, quantity: item.quantity })))
        this.applyServer(data.data)
        clearLocal()
        return { success: true, message: data.message }
      } catch (error) {
        return { success: false, message: errorMessage(error, '购物车合并失败') }
      } finally {
        this.loading = false
      }
    },

    // 登录成功后调用：有游客数据先合并到服务端，没有则直接拉取
    syncAfterLogin() {
      if (!isCustomerLoggedIn()) return Promise.resolve({ success: false })
      return readLocal().length ? this.mergeGuestCart() : this.fetchFromServer()
    },

    // 带着 token 刷新页面时调用：只以服务端为准，不读 localStorage
    restoreFromServer() {
      if (!isCustomerLoggedIn()) return Promise.resolve({ success: false })
      return this.fetchFromServer()
    },

    // 退出登录：回到游客视图（正常情况下登录时已清空游客数据，故展示为空）。
    // 不删服务端数据，下次登录会重新拉取
    reset() {
      this.items = readLocal()
      this.loading = false
    },

    // ---------- 变更操作：未登录写 localStorage，已登录直接调服务端 ----------
    async add(product, quantity = 1) {
      if (!isCustomerLoggedIn()) {
        const found = this.items.find(i => i.product.id === product.id)
        if (found) found.quantity = Math.min(found.quantity + quantity, product.stock)
        else this.items.push({ product, quantity })
        this.persist()
        return { success: true }
      }
      try {
        const { data } = await customerApi.post('/cart', { product_id: product.id, quantity })
        // 服务端已按库存封顶，直接采用返回数量，保证前后端一致
        const applied = data.data.quantity
        const found = this.items.find(i => i.product.id === product.id)
        if (found) found.quantity = applied
        // 服务端列表按加入时间倒序，新商品放最前，刷新后顺序也一致
        else this.items.unshift({ product, quantity: applied })
        return { success: true, truncated: !!data.truncated, message: data.truncated ? data.message : '' }
      } catch (error) {
        return { success: false, message: errorMessage(error, '加入购物车失败，请稍后重试') }
      }
    },

    async setQuantity(id, quantity) {
      const item = this.items.find(i => i.product.id === id)
      if (!item) return { success: false, message: '购物车中没有该商品' }

      if (!isCustomerLoggedIn()) {
        item.quantity = Math.max(1, Math.min(quantity, item.product.stock))
        this.persist()
        return { success: true }
      }

      // 与游客行为一致：数量下限为 1（数量为 1 时点「−」是空操作，不发请求）
      const target = Math.max(1, Math.trunc(Number(quantity)) || 1)
      if (target === item.quantity) return { success: true }
      try {
        const { data } = await customerApi.put(`/cart/${id}`, { quantity: target })
        item.quantity = data.data.quantity
        return { success: true, truncated: !!data.truncated, message: data.truncated ? data.message : '' }
      } catch (error) {
        return { success: false, message: errorMessage(error, '修改数量失败，请稍后重试') }
      }
    },

    async remove(id) {
      if (!isCustomerLoggedIn()) {
        this.items = this.items.filter(i => i.product.id !== id)
        this.persist()
        return { success: true }
      }
      try {
        await customerApi.delete(`/cart/${id}`)
      } catch (error) {
        // 服务端已无该商品（并发移除、历史数据）时按成功处理，避免界面卡在删不掉的状态
        if (error.response?.status !== 404) return { success: false, message: errorMessage(error, '移除失败，请稍后重试') }
      }
      this.items = this.items.filter(i => i.product.id !== id)
      return { success: true }
    },

    async clear() {
      if (!isCustomerLoggedIn()) {
        this.items = []
        this.persist()
        return { success: true }
      }
      try {
        const { data } = await customerApi.delete('/cart')
        this.items = []
        return { success: true, message: data.message }
      } catch (error) {
        return { success: false, message: errorMessage(error, '清空购物车失败，请稍后重试') }
      }
    }
  }
})
