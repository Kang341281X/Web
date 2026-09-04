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
    return Promise.reject(error)
  }
)
export default api
