import { test, expect } from '@playwright/test'
import { registerCustomer, fetchCaptcha, loginCustomer, api } from './helpers.mjs'

test.describe('顾客登录', () => {
  test('验证码错误 → 400（不进入账号密码校验）', async () => {
    const customer = await registerCustomer()
    const captcha = await fetchCaptcha()

    const res = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: 'bad1',
    })
    expect(res.status).toBe(400)
    expect(res.data.code).toBe('CAPTCHA_INVALID')
  })

  test('账号密码错误 → 401', async () => {
    const customer = await registerCustomer()
    const captcha = await fetchCaptcha()

    const res = await loginCustomer({
      username: customer.username,
      password: 'WrongPassword',
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(res.status).toBe(401)
    expect(res.data.message).toBe('用户名或密码错误')
  })

  test('不存在的用户名 → 401（不泄漏账号是否存在）', async () => {
    const captcha = await fetchCaptcha()
    const res = await loginCustomer({
      username: 'no_such_user_xyz',
      password: 'Whatever123',
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(res.status).toBe(401)
    expect(res.data.message).toBe('用户名或密码错误')
  })

  test('正确登录 → 200，token 可访问个人信息', async () => {
    const customer = await registerCustomer()
    const captcha = await fetchCaptcha()

    const res = await loginCustomer({
      username: customer.username,
      password: customer.password,
      captchaId: captcha.captchaId,
      captchaText: captcha.text,
    })
    expect(res.status).toBe(200)
    expect(res.data.success).toBe(true)
    expect(res.data.token).toBeTruthy()
    expect(res.data.user.username).toBe(customer.username)

    const profile = await api('/api/customer/profile', { token: res.data.token })
    expect(profile.status).toBe(200)
    expect(profile.data.user.username).toBe(customer.username)
  })
})
