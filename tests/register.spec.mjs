import { test, expect } from '@playwright/test'
import { registerCustomer, api } from './helpers.mjs'

test.describe('顾客注册唯一性冲突', () => {
  test('用户名已被占用 → 409', async () => {
    const existing = await registerCustomer()

    const res = await api('/api/customer/register', {
      method: 'POST',
      body: { username: existing.username, phone: '13999990001', password: 'Pass123456' },
    })
    expect(res.status).toBe(409)
    expect(res.data.success).toBe(false)
    expect(res.data.message).toBe('用户名已被占用')
  })

  test('手机号已注册 → 409', async () => {
    const existing = await registerCustomer()

    const res = await api('/api/customer/register', {
      method: 'POST',
      body: { username: 'uniq_user_abcd', phone: existing.phone, password: 'Pass123456' },
    })
    expect(res.status).toBe(409)
    expect(res.data.success).toBe(false)
    expect(res.data.message).toBe('该手机号已注册')
  })

  test('全新的用户名 + 手机号 → 201 注册即登录', async () => {
    const res = await api('/api/customer/register', {
      method: 'POST',
      body: { username: 'reg_ok_' + Date.now().toString(36), phone: '13' + String(Date.now()).slice(-9), password: 'Pass123456' },
    })
    expect(res.status).toBe(201)
    expect(res.data.token).toBeTruthy()
  })
})
