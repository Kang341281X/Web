import { defineStore } from 'pinia'
import { useAuth } from '../composables/useAuth'

export const useUserStore = defineStore('user', {
  state: () => ({
    isLoginOpen: false,
    // 前台访客名称
    name: '',
    // 后台管理员登录状态
    adminToken: localStorage.getItem('admin_token') || '',
    adminUser: JSON.parse(localStorage.getItem('admin_user') || 'null')
  }),
  getters: {
    isGuest: s => !s.name,
    isAdmin: s => !!s.adminToken
  },
  actions: {
    openLogin() { this.isLoginOpen = true },
    closeLogin() { this.isLoginOpen = false },

    // 后台管理员登录
    async adminLogin(username, password) {
      const auth = useAuth()
      const result = await auth.login(username, password)
      if (result.success) {
        this.adminToken = result.token
        this.adminUser = result.user
        localStorage.setItem('admin_token', result.token)
        localStorage.setItem('admin_user', JSON.stringify(result.user))
      }
      return result
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
