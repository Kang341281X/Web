import api from './api'
import customerApi from './customerApi'

/**
 * 图形验证码客户端。
 *
 * 服务端自托管（server/routes/captcha.js + server/services/captchaService.js），
 * 不依赖 Google reCAPTCHA 等任何外部服务：这里只有一次同源请求，拿到一张 data URI 图片。
 *
 * 前后台共用同一份签发实现，但走各自的 axios 实例：
 *   - 前台顾客：customerApi → /api/customer/captcha
 *   - 后台管理：api        → /api/captcha
 * 两个实例挂的响应拦截器不同（顾客的 401 只清本地登录态，管理员的 401 会跳登录页），
 * 分开走各自的实例，语义最清楚，也避免验证码接口被无关的拦截器影响。
 *
 * @returns {Promise<{captchaId: string, image: string, expiresIn: number}>}
 */
const fetch = async client => {
  const { data } = await client.get('/captcha')
  return { captchaId: data.captchaId, image: data.image, expiresIn: data.expiresIn }
}

export const fetchCustomerCaptcha = () => fetch(customerApi)
export const fetchAdminCaptcha = () => fetch(api)
