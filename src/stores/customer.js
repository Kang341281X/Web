import { defineStore } from 'pinia'
import customerApi, { CUSTOMER_TOKEN_KEY, CUSTOMER_USER_KEY, setUnauthorizedHandler } from '../services/customerApi'
import { useAddressStore } from './address'
import { useCartStore } from './cart'
import { useFavoritesStore } from './favorites'

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
    // 展示名即用户名，其次手机号
    displayName: state => state.profile?.username || state.profile?.phone || '',
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
      if ((profile?.id ?? null) !== previousCustomerId) {
        // 换顾客（含退出登录）时清掉上一个账号的前台数据，避免串号；
        // 购物车/收藏只是清空前端展示，服务端数据保留，下次登录会重新拉取
        useAddressStore().reset()
        useCartStore().reset()
        useFavoritesStore().reset()
      }
    },

    errorMessage(error, fallback) {
      return error.response?.data?.message || fallback
    },

    // 后端用 code 标明可程序化处理的失败（目前只有 CAPTCHA_INVALID），
    // 前端靠它决定「要不要换一张验证码」，而不是去匹配中文提示
    errorCode(error) {
      return error.response?.data?.code || ''
    },

    // 注册：用户名 + 手机号 + 密码（+ 可选邮箱）。注册不需要验证码；
    // 后端注册即登录（直接签发 token），游客购物车/收藏的合并口径与登录一致
    async register({ username, phone, password, email }) {
      this.loading = true
      try {
        const { data } = await customerApi.post('/register', {
          username,
          phone,
          password,
          ...(email ? { email } : {}),
        })
        this.applySession(data.token, data.user)
        // 注册即登录：直接从服务端拉取购物车/收藏（游客没有本地数据可合并）
        await Promise.all([useCartStore().fetchFromServer(), useFavoritesStore().fetchFromServer()])
        return { success: true, message: data.message || '注册成功', user: data.user }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '注册失败，请稍后重试') }
      } finally {
        this.loading = false
      }
    },

    // 登录账号是用户名（手机号不再参与登录）；captcha: { captchaId, captchaText } 必须携带，否则后端直接拒绝（400 / CAPTCHA_INVALID）
    async login(username, password, captcha = {}) {
      this.loading = true
      try {
        const { data } = await customerApi.post('/login', {
          username,
          password,
          captchaId: captcha.captchaId || '',
          captchaText: captcha.captchaText || '',
        })
        this.applySession(data.token, data.user)
        // 登录成功后从服务端拉取购物车/收藏（游客没有本地数据可合并）
        await Promise.all([useCartStore().fetchFromServer(), useFavoritesStore().fetchFromServer()])
        return { success: true, message: data.message || '登录成功', user: data.user }
      } catch (error) {
        // 失败时把 code 一并返回：验证码是一次性的，调用方需要据此换一张新图
        return {
          success: false,
          message: this.errorMessage(error, '登录失败，请稍后重试'),
          code: this.errorCode(error),
        }
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

    // payload 支持 phone / email；带 avatar(File) 时走 multipart 上传
    async updateProfile(payload = {}) {
      try {
        const form = new FormData()
        if (payload.phone !== undefined) form.append('phone', payload.phone ?? '')
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
