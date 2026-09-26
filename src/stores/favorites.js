import { defineStore } from 'pinia'
import customerApi, { isCustomerLoggedIn } from '../services/customerApi'
import { useUserStore } from './user'

/**
 * 收藏只有一种数据源：服务端 /api/customer/favorites。
 * 未登录访客不能收藏（触发操作时弹登录框），也没有本地收藏，
 * 因此登录后直接从服务端拉取即可，不再需要合并游客数据。
 */

const errorMessage = (error, fallback) => error.response?.data?.message || fallback

export const useFavoritesStore = defineStore('favorites', {
  // 未登录时为空；登录态下由 main.js（刷新恢复）或登录流程从服务端覆盖
  state: () => ({ ids: [], loading: false }),
  getters: { has: s => id => s.ids.includes(id) },
  actions: {
    // ---------- 与服务端同步（仅登录态）----------
    // 服务端列表已按收藏时间倒序，这里只取商品 id
    applyServer(rows) { this.ids = (rows || []).map(row => row.product_id) },

    async fetchFromServer() {
      this.loading = true
      try {
        const { data } = await customerApi.get('/favorites')
        this.applyServer(data.data)
        return { success: true }
      } catch (error) {
        return { success: false, message: errorMessage(error, '获取收藏失败') }
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
      this.ids = []
      this.loading = false
    },

    // ---------- 变更操作：未登录弹登录框，已登录直接调服务端 ----------
    async toggle(id) {
      const favorited = this.ids.includes(id)

      if (!isCustomerLoggedIn()) {
        useUserStore().openLogin()
        return { success: false, requiresLogin: true }
      }

      try {
        if (favorited) await customerApi.delete(`/favorites/${id}`)
        else await customerApi.post(`/favorites/${id}`)
      } catch (error) {
        // 服务端已是目标状态（并发操作 / 商品已删除）时按成功处理
        if (error.response?.status !== 404) return { success: false, message: errorMessage(error, '操作失败，请稍后重试') }
      }
      // 与服务端一致：最新收藏排最前
      this.ids = favorited ? this.ids.filter(x => x !== id) : [id, ...this.ids]
      return { success: true }
    }
  }
})
