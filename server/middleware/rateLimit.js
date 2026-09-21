import rateLimit from 'express-rate-limit'

/**
 * 登录接口限流：15 分钟窗口内每个 IP 最多 10 次请求，超出后返回统一 JSON 错误。
 * 仅挂在管理员登录与顾客登录两个路由上（双保险：两者已有图形验证码防爆破），
 * 不做全局中间件，避免误伤商品列表等高频只读接口。
 * skipSuccessfulRequests：登录成功的请求不消耗额度——正常用户登录一次即可，
 * 只统计失败尝试（响应非 2xx），额度全部留给防爆破场景。
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '尝试次数过多，请稍后再试' }
})

/**
 * 注册接口限流：每 IP 每小时最多 10 次。
 * 注册没有验证码（人机校验只用于登录），是前台唯一无门槛的写入口，
 * 用限流兜底批量灌注册 / 用户名撞库探测。与 loginLimiter 是两个独立实例，
 * 额度互不干扰；成功注册同样计数（单 IP 一小时注册超 10 次本身就可疑）。
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '注册过于频繁，请稍后再试' }
})
