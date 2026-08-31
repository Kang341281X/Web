import { ref } from 'vue'

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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        errorMsg.value = data.message || '登录失败'
        return { success: false, message: errorMsg.value }
      }
      return {
        success: true,
        token: data.token,
        user: data.user
      }
    } catch (err) {
      errorMsg.value = '网络错误，请检查后端服务是否启动'
      return { success: false, message: errorMsg.value }
    } finally {
      loading.value = false
    }
  }

  return { login, loading, errorMsg }
}
