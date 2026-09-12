import { defineStore } from 'pinia'
import customerApi from '../services/customerApi'

// 表单模型（camelCase）→ 接口字段（snake_case），字段名与 server/routes/customerAddress.js 一一对应
function toPayload(form = {}) {
  return {
    receiver_name: (form.receiverName || '').trim(),
    receiver_phone: (form.receiverPhone || '').trim(),
    province: (form.province || '').trim(),
    city: (form.city || '').trim(),
    district: (form.district || '').trim(),
    detail_address: (form.detailAddress || '').trim(),
    is_default: form.isDefault ? 1 : 0,
  }
}

/**
 * 顾客收货地址。
 * 后端维护了「只要存在地址就有唯一默认地址」这条不变量（首条自动成为默认、
 * 删除默认后自动补位、列表按默认优先排序），所以每次写操作后统一重新拉取列表，
 * 最终顺序与默认项一律以服务端返回为准，前端不再自行推算。
 */
export const useAddressStore = defineStore('address', {
  state: () => ({ list: [], loading: false, saving: false, loaded: false }),
  getters: {
    defaultAddress: state => state.list.find(item => item.is_default) || null,
  },
  actions: {
    errorMessage(error, fallback) {
      return error.response?.data?.message || fallback
    },

    // 切换到另一个顾客（含退出登录）时清空，避免把上一个账号的地址带过来
    reset() {
      this.list = []
      this.loading = false
      this.saving = false
      this.loaded = false
    },

    async fetchList() {
      this.loading = true
      try {
        const { data } = await customerApi.get('/addresses')
        this.list = data.data || []
        this.loaded = true
        return { success: true, data: this.list }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, '获取收货地址失败') }
      } finally {
        this.loading = false
      }
    },

    // 写操作统一入口：请求成功后刷新列表，保证默认地址与排序跟服务端一致
    async write(request, fallback) {
      this.saving = true
      try {
        const { data } = await request()
        await this.fetchList()
        return { success: true, message: data.message, data: data.data }
      } catch (error) {
        return { success: false, message: this.errorMessage(error, fallback) }
      } finally {
        this.saving = false
      }
    },

    create(form) {
      return this.write(() => customerApi.post('/addresses', toPayload(form)), '新增地址失败，请稍后重试')
    },

    update(id, form) {
      return this.write(() => customerApi.put(`/addresses/${id}`, toPayload(form)), '保存地址失败，请稍后重试')
    },

    setDefault(id) {
      return this.write(() => customerApi.put(`/addresses/${id}/set-default`), '设置默认地址失败，请稍后重试')
    },

    remove(id) {
      return this.write(() => customerApi.delete(`/addresses/${id}`), '删除地址失败，请稍后重试')
    },
  },
})
