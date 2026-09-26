import { defineStore } from 'pinia'
import customerApi, { isCustomerLoggedIn } from '../services/customerApi'
import { adaptProduct } from '../services/publicApi'
import { useUserStore } from './user'

/**
 * 购物车只有一种数据源：服务端 /api/customer/cart。
 * 未登录访客不能加购（触发操作时弹登录框），也没有本地购物车，
 * 因此登录后直接从服务端拉取即可，不再需要合并游客数据。
 */

const errorMessage = (error, fallback) => error.response?.data?.message || fallback

// 服务端返回的是「商品字段 + quantity」的扁平行：商品 id 别名为 product_id，
// created_at / updated_at 是购物车行自己的时间。这里剔除行字段后复用前台商品适配器，
// 还原成组件统一使用的 { product, quantity }
const adaptItem = row => {
  const { cart_id, quantity, created_at, updated_at, ...product } = row
  return { product: adaptProduct({ ...product, id: product.product_id }), quantity }
}

export const useCartStore = defineStore('cart', {
  // 未登录时为空；登录态下由 main.js（刷新恢复）或登录流程从服务端覆盖
  state: () => ({ items: [], loading: false }),
  getters: {
    count: s => s.items.reduce((n, item) => n + item.quantity, 0),
    subtotal: s => s.items.reduce((n, item) => n + item.product.price * item.quantity, 0)
  },
  actions: {
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

    // 带着 token 刷新页面时调用
    restoreFromServer() {
      if (!isCustomerLoggedIn()) return Promise.resolve({ success: false })
      return this.fetchFromServer()
    },

    // 退出登录：清空前端展示，服务端数据保留，下次登录会重新拉取
    reset() {
      this.items = []
      this.loading = false
    },

    // ---------- 变更操作：未登录弹登录框，已登录直接调服务端 ----------
    async add(product, quantity = 1) {
      if (!isCustomerLoggedIn()) {
        useUserStore().openLogin()
        return { success: false, requiresLogin: true }
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

      // 数量下限为 1（数量为 1 时点「−」是空操作，不发请求）
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
