import { defineStore } from 'pinia'
import customerApi, { CUSTOMER_TOKEN_KEY, CUSTOMER_USER_KEY, setUnauthorizedHandler } from '../services/customerApi'
import { useAddressStore } from './address'

// 读取本地缓存的顾客资料（内容损坏时忽略，后续可用 fetchProfile 重新拉取）
function readStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_USER_KEY) || 'null')
  } catch {
    return null
  }
}

/**
 * 前台顾客登录态。
 * 与 stores/user.js（后台管理员登录态）完全独立，两者互不影响。
 */
export const useCustomerStore = defineStore('customer', {
  state: () => ({
    token: localStorage.getItem(CUSTOMER_TOKEN_KEY) || '',
    profile: readStoredProfile(),
    loading: false,
  }),
  getters: {
    isLoggedIn: state => !!state.token,
    // 优先昵称，其次手机号（后端返回的 phone 已脱敏）
    displayName: state => state.profile?.nickname || state.profile?.phone || '',
    avatarUrl: state => state.profile?.avatar_url || '',
  },
  actions: {
    // state 与 localStorage 一起更新，避免刷新后登录态不一致
    applySession(token, profile) {
      // 换顾客（含退出登录）时清掉上一个账号的收货地址，避免串号
      const previousCustomerId = this.profile?.id ?? null
      this.token = token || ''
      this.profile = profile || null
      if (this.token) localStorage.setItem(CUSTOMER_TOKEN_KEY, this.token)
      else localStorage.removeItem(CUSTOMER_TOKEN_KEY)
      if (this.profile) localStorage.setItem(CUSTOMER_USER_KEY, JSON.stringify(this.profile))
      else localStorage.removeItem(CUSTOMER_USER_KEY)
      if ((profile?.id ?? null) !== previousCustomerId) useAddressStore().reset()
    },

    errorMessage(error, fallback) {
      return error.response?.data?.message || fallback
    },

    // 注册：后端只返回顾客资料，不签发 token，需要登录态时请再调用 login
    async register(phone, password, nickname) {
      this.loading = true
      try {
        const { data } = await customerApi.post('/register', {
          phone,
          password,
          nickname: nickname || '',
        })
        return { success: true, message: data.message || '注册成功', user: data.user }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '注册失败，请稍后重试') }
      } finally {
        this.loading = false
      }
    },

    async login(phone, password) {
      this.loading = true
      try {
        const { data } = await customerApi.post('/login', { phone, password })
        this.applySession(data.token, data.user)
        return { success: true, message: data.message || '登录成功', user: data.user }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '登录失败，请稍后重试') }
      } finally {
        this.loading = false
      }
    },

    // 退出登录：顾客侧没有服务端会话，清空本地登录态即可
    logout() {
      this.applySession('', null)
    },

    async fetchProfile() {
      if (!this.token) return { success: false, message: '尚未登录' }
      try {
        const { data } = await customerApi.get('/profile')
        this.applySession(this.token, data.user)
        return { success: true, user: data.user }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '获取个人信息失败') }
      }
    },

    // payload 支持 nickname / email；带 avatar(File) 时走 multipart 上传
    async updateProfile(payload = {}) {
      try {
        const form = new FormData()
        if (payload.nickname !== undefined) form.append('nickname', payload.nickname ?? '')
        if (payload.email !== undefined) form.append('email', payload.email ?? '')
        if (payload.avatar) form.append('avatar', payload.avatar)
        const { data } = await customerApi.put('/profile', form)
        this.applySession(this.token, data.user)
        return { success: true, message: data.message || '个人信息已更新', user: data.user }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '保存失败，请稍后重试') }
      }
    },

    async changePassword(currentPassword, newPassword) {
      try {
        const { data } = await customerApi.put('/password', {
          current_password: currentPassword,
          new_password: newPassword,
        })
        return { success: true, message: data.message || '密码已更新' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '修改密码失败，请稍后重试') }
      }
    },
  },
})

// 顾客 token 失效（401）时清空本地登录态；注册到服务层，避免 customerApi 反向依赖 store
setUnauthorizedHandler(() => useCustomerStore().logout())
