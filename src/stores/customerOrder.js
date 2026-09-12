import { defineStore } from 'pinia'
import customerApi from '../services/customerApi'

/**
 * 顾客端「我的订单」。
 * 下单 / 取消都走后端事务：下单扣库存并清空对应购物车项，取消回补库存。
 * 因此创建/取消成功后前端只需按返回结果刷新列表，不做本地推算。
 */
export const useCustomerOrderStore = defineStore('customerOrder', {
  state: () => ({ list: [], total: 0, loading: false, submitting: false }),
  actions: {
    errorMessage(error, fallback) {
      return error.response?.data?.message || fallback
    },

    // 退出登录 / 切换账号时清空，避免把上一个账号的订单带过来
    reset() {
      this.list = []
      this.total = 0
      this.loading = false
      this.submitting = false
    },

    async fetchList(params = {}) {
      this.loading = true
      try {
        const { data } = await customerApi.get('/orders', { params })
        this.list = data.data || []
        this.total = data.pagination?.total || 0
        return { success: true }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '获取订单失败') }
      } finally {
        this.loading = false
      }
    },

    async fetchDetail(id) {
      try {
        const { data } = await customerApi.get(`/orders/${id}`)
        return { success: true, data: data.data }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '获取订单详情失败') }
      }
    },

    // payload: { address_id, remark, items? }；items 省略时后端按购物车下单
    async createOrder(payload = {}) {
      this.submitting = true
      try {
        const { data } = await customerApi.post('/orders', payload)
        return { success: true, message: data.message, data: data.data }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '提交订单失败，请稍后重试') }
      } finally {
        this.submitting = false
      }
    },

    async cancelOrder(id) {
      try {
        const { data } = await customerApi.put(`/orders/${id}/cancel`)
        return { success: true, message: data.message, data: data.data }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '取消订单失败，请稍后重试') }
      }
    },
  },
})
