import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 15000 })
api.interceptors.request.use(config => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/admin/login')) {
      localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user')
      if (location.pathname.startsWith('/admin') && location.pathname !== '/admin/login') location.assign('/admin/login')
    }
    // 后端 requirePasswordChanged 中间件对 must_change_password=1 的账号返回 403 + code: PASSWORD_CHANGE_REQUIRED。
    // 路由守卫已经把非 /admin/profile 的导航挡住了，但若页面里残留的定时器/未卸载组件继续发请求
    // 拿到 403 时仍要兜底把浏览器带回改密页，避免 UI 端出现数据错位（请求被拒但本地状态却像成功）。
    if (error.response?.status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED' && !location.pathname.startsWith('/admin/profile')) {
      location.assign('/admin/profile')
    }
    return Promise.reject(error)
  }
)
export default api
