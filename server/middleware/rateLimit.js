import rateLimit from 'express-rate-limit'

/**
 * 登录接口限流：15 分钟窗口内每个 IP 最多 10 次请求，超出后返回统一 JSON 错误。
 * 仅挂在管理员登录与顾客登录两个路由上（双保险：两者已有图形验证码防爆破），
 * 不做全局中间件，避免误伤商品列表等高频只读接口。
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '尝试次数过多，请稍后再试' }
})
