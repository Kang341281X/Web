import { ref } from 'vue'
import api from '../services/api'

/**
 * 认证 composable
 * 调用后端 API 进行管理员登录验证，使用 SQL 查询 admin_users 表
 */
export function useAuth() {
  const loading = ref(false)
  const errorMsg = ref('')

  async function login(username, password) {
    loading.value = true
    errorMsg.value = ''
    try {
      const { data } = await api.post('/admin/login', { username, password })
      if (!data.success) {
        errorMsg.value = data.message || '登录失败'
        return { success: false, message: errorMsg.value }
      }
      return {
        success: true,
        token: data.token,
        user: data.user
      }
    } catch (err) {
      errorMsg.value = err.response?.data?.message || '网络错误，请检查后端服务是否启动'
      return { success: false, message: errorMsg.value }
    } finally {
      loading.value = false
    }
  }

  return { login, loading, errorMsg }
}
