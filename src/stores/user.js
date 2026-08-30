import { defineStore } from 'pinia'
export const useUserStore = defineStore('user', {
  state: () => ({ isLoginOpen: false, name: '' }),
  getters: { isGuest: s => !s.name },
  actions: { openLogin() { this.isLoginOpen = true }, closeLogin() { this.isLoginOpen = false } }
})
