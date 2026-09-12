import axios from 'axios'

// 前台顾客登录态在 localStorage 中的键名（与后台管理员的 admin_token / admin_user 严格区分）
export const CUSTOMER_TOKEN_KEY = 'customer_token'
export const CUSTOMER_USER_KEY = 'customer_user'

// 前台顾客专用实例：baseURL 固定指向 /api/customer，与后台的 /api 实例互不影响
const customerApi = axios.create({ baseURL: '/api/customer', timeout: 15000 })

// 当前顾客 token / 是否处于登录态。
// 与 customer store 的 token 同源：store 的 applySession 始终同步写 localStorage。
// 购物车/收藏 store 用它判断「走服务端还是 localStorage」，避免 store 之间循环依赖。
export const customerToken = () => localStorage.getItem(CUSTOMER_TOKEN_KEY) || ''
export const isCustomerLoggedIn = () => !!customerToken()

customerApi.interceptors.request.use(config => {
  const token = customerToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 登录接口自身返回的 401 表示「手机号或密码错误」，不能当作登录态失效处理
const isLoginRequest = url => /(^|\/)login\/?$/.test(String(url || '').split('?')[0])

// 由 stores/customer.js 注册，避免服务层反向依赖 Pinia store
let unauthorizedHandler = null
export const setUnauthorizedHandler = handler => { unauthorizedHandler = handler }

customerApi.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401 && !isLoginRequest(error.config?.url)) {
      // 前台顾客场景：只清空本地登录态，绝不跳转 /admin/login
      if (unauthorizedHandler) unauthorizedHandler()
      else {
        localStorage.removeItem(CUSTOMER_TOKEN_KEY)
        localStorage.removeItem(CUSTOMER_USER_KEY)
      }
    }
    return Promise.reject(error)
  }
)

export default customerApi
