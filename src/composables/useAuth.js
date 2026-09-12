import { ref } from 'vue'
import api from '../services/api'

/**
 * 认证 composable
 * 调用后端 API 进行管理员登录验证，使用 SQL 查询 admin_users 表
 */
export function useAuth() {
  const loading = ref(false)
  const errorMsg = ref('')

  // captcha: { captchaId, captchaText }，后台登录同样需要人机校验（挡撞库）
  async function login(username, password, captcha = {}) {
    loading.value = true
    errorMsg.value = ''
    try {
      const { data } = await api.post('/admin/login', {
        username,
        password,
        captchaId: captcha.captchaId || '',
        captchaText: captcha.captchaText || ''
      })
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
      // code 用于区分「验证码失效，需要换一张」和其他失败
      return { success: false, message: errorMsg.value, code: err.response?.data?.code || '' }
    } finally {
      loading.value = false
    }
  }

  return { login, loading, errorMsg }
}
