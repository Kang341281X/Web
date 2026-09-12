import { Router } from 'express'
import { issueCaptcha } from '../services/captchaService.js'

const router = Router()

/**
 * GET /captcha —— 签发一张图形验证码。
 *
 * 响应：
 *   {
 *     success: true,
 *     captchaId: 'uuid',                        // 登录时随表单回传
 *     image: 'data:image/svg+xml;base64,...',   // 可直接给 <img src>
 *     expiresIn: 300                            // 有效期（秒）
 *   }
 *
 * 为什么图片用 data URI 而不是直接返回 SVG 源码：
 *   源码方式前端只能 v-html 注入，等于把一个「服务端返回的字符串」当 HTML 解析；
 *   包成 data URI 后前端用 <img :src> 即可，浏览器按图片处理，不存在脚本执行面。
 *
 * 挂载位置见 server/index.js：同一份实现挂两个前缀
 *   /api/customer/captcha  前台顾客登录（LoginModal.vue）
 *   /api/captcha           后台管理员登录（AdminLogin.vue）
 * 验证码本身不携带任何身份，与「是谁在登录」无关，所以不需要做两套实现与两份存储；
 * 详见 server/services/captchaService.js 顶部说明。
 */
router.get('/captcha', (_req, res) => {
  const { captchaId, svg, expiresIn } = issueCaptcha()
  res.json({
    success: true,
    captchaId,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    expiresIn,
  })
})

export default router
