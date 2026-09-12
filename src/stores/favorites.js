import { defineStore } from 'pinia'
import customerApi, { isCustomerLoggedIn } from '../services/customerApi'

const STORAGE_KEY = 'craftora-favorites'

/**
 * 收藏有两种数据源：
 * - 未登录：localStorage（行为与改造前一致）
 * - 已登录：服务端 /api/customer/favorites（阶段 4 接口）
 * 前端只保存商品 id 列表，收藏页会按 id 再拉完整商品；登录时把游客收藏合并到服务端。
 */

const readLocal = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    const ids = [...new Set(raw.filter(id => Number.isInteger(id)))]
    if (ids.length !== raw.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    return ids
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

const writeLocal = ids => localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
const clearLocal = () => localStorage.removeItem(STORAGE_KEY)

const errorMessage = (error, fallback) => error.response?.data?.message || fallback

export const useFavoritesStore = defineStore('favorites', {
  // 未登录时读游客数据；登录态下由 main.js（刷新恢复）或登录流程从服务端覆盖
  state: () => ({ ids: readLocal(), loading: false }),
  getters: { has: s => id => s.ids.includes(id) },
  actions: {
    persist() { writeLocal(this.ids) },

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

    // 合并游客收藏并覆盖本地状态；只有成功才清空 localStorage，失败保留以便下次登录重试
    async mergeGuestFavorites() {
      const guest = readLocal()
      this.loading = true
      try {
        const { data } = await customerApi.post('/favorites/merge', { product_ids: guest })
        this.applyServer(data.data)
        clearLocal()
        return { success: true, message: data.message }
      } catch (error) {
        return { success: false, message: errorMessage(error, '收藏合并失败') }
      } finally {
        this.loading = false
      }
    },

    // 登录成功后调用：有游客数据先合并到服务端，没有则直接拉取
    syncAfterLogin() {
      if (!isCustomerLoggedIn()) return Promise.resolve({ success: false })
      return readLocal().length ? this.mergeGuestFavorites() : this.fetchFromServer()
    },

    // 带着 token 刷新页面时调用：只以服务端为准，不读 localStorage
    restoreFromServer() {
      if (!isCustomerLoggedIn()) return Promise.resolve({ success: false })
      return this.fetchFromServer()
    },

    // 退出登录：回到游客视图（正常情况下登录时已清空游客数据，故展示为空）。
    // 不删服务端数据，下次登录会重新拉取
    reset() {
      this.ids = readLocal()
      this.loading = false
    },

    // ---------- 变更操作：未登录写 localStorage，已登录直接调服务端 ----------
    async toggle(id) {
      const favorited = this.ids.includes(id)

      if (!isCustomerLoggedIn()) {
        this.ids = favorited ? this.ids.filter(x => x !== id) : [...this.ids, id]
        this.persist()
        return { success: true }
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
