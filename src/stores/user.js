import { defineStore } from 'pinia'
import { useAuth } from '../composables/useAuth'
import api from '../services/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    isLoginOpen: false,
    // 后台管理员登录状态
    adminToken: localStorage.getItem('admin_token') || '',
    adminUser: JSON.parse(localStorage.getItem('admin_user') || 'null')
  }),
  getters: {
    isAdmin: s => !!s.adminToken
  },
  actions: {
    // 前台登录弹窗开关（真正的顾客登录态在 stores/customer.js）
    openLogin() { this.isLoginOpen = true },
    closeLogin() { this.isLoginOpen = false },

    // 后台管理员登录（captcha: { captchaId, captchaText }）
    async adminLogin(username, password, captcha = {}) {
      const auth = useAuth()
      const result = await auth.login(username, password, captcha)
      if (result.success) {
        this.adminToken = result.token
        this.adminUser = result.user
        localStorage.setItem('admin_token', result.token)
        localStorage.setItem('admin_user', JSON.stringify(result.user))
      }
      return result
    },

    async refreshAdminProfile() {
      const { data } = await api.get('/admin/profile')
      this.adminUser = data.user
      localStorage.setItem('admin_user', JSON.stringify(data.user))
      return data.user
    },

    setAdminUser(user) {
      this.adminUser = user
      localStorage.setItem('admin_user', JSON.stringify(user))
    },

    // 后台管理员退出
    adminLogout() {
      this.adminToken = ''
      this.adminUser = null
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
    }
  }
})
