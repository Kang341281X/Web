import { test, expect } from '@playwright/test'
import { registerCustomer, fetchCaptcha, loginCustomer } from './helpers.mjs'

test.describe('图形验证码一次性机制', () => {
  test('同一个 captchaId 用两次：第一次成功后，第二次必须失败', async () => {
    const customer = await registerCustomer()
    const captcha = await fetchCaptcha()

    const first = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(first.status).toBe(200)
    expect(first.data.success).toBe(true)
    expect(first.data.token).toBeTruthy()

    // 同一张验证码再试一次：已被消费，必须拒绝
    const second = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(second.status).toBe(400)
    expect(second.data.success).toBe(false)
    expect(second.data.code).toBe('CAPTCHA_INVALID')
  })

  test('验证码输错一次即作废：之后即使输入正确文本也不能复用', async () => {
    const customer = await registerCustomer()
    const captcha = await fetchCaptcha()

    // 第一次输错文本 → 400，且验证码同时被删除（防爆破关键：不能反复猜）
    const wrong = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: 'XXXX',
    })
    expect(wrong.status).toBe(400)
    expect(wrong.data.code).toBe('CAPTCHA_INVALID')

    // 第二次带正确文本复用同一 id → 仍失败
    const reuse = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(reuse.status).toBe(400)
    expect(reuse.data.code).toBe('CAPTCHA_INVALID')
  })
})
