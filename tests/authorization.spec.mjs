import { test, expect } from '@playwright/test'
import {
  registerCustomer, addAddress, pickProduct, pickShippingRate, placeOrder, adminLogin, api,
} from './helpers.mjs'

test.describe('越权隔离', () => {
  test('顾客 token 不能访问后台接口（401）', async () => {
    const customer = await registerCustomer()

    for (const path of ['/api/admin-orders', '/api/admins', '/api/admin/finance/summary', '/api/products']) {
      const res = await api(path, { token: customer.token })
      expect(res.status, `GET ${path}`).toBe(401)
      expect(res.data.success).toBe(false)
    }
  })

  test('顾客 A 不能查看顾客 B 的订单（404，不泄漏订单存在性）', async () => {
    const customerA = await registerCustomer()
    const customerB = await registerCustomer()
    const product = await pickProduct()
    const rate = await pickShippingRate()

    // B 下单
    const addressId = await addAddress(customerB.token)
    const orderedByB = await placeOrder(customerB.token, {
      addressId, locale: rate.locale, productId: product.id, quantity: 1,
      shippingFee: rate.fee_cny,
    })
    expect(orderedByB.status).toBe(201)
    const orderOfB = orderedByB.data.data.id

    // A 尝试查看 B 的订单详情 → 404
    const peek = await api(`/api/customer/orders/${orderOfB}`, { token: customerA.token })
    expect(peek.status).toBe(404)
    expect(peek.data.message).toBe('订单不存在')

    // A 尝试取消 B 的订单 → 404，且订单状态不受影响
    const cancel = await api(`/api/customer/orders/${orderOfB}/cancel`, { method: 'PUT', token: customerA.token })
    expect(cancel.status).toBe(404)
    const own = await api(`/api/customer/orders/${orderOfB}`, { token: customerB.token })
    expect(own.status).toBe(200)
    expect(own.data.data.status).toBe('pending')
  })

  test('普通 admin 不能访问财务、管理员管理等仅超管接口（403），订单接口正常（200）', async () => {
    const normalAdmin = await adminLogin('admin')
    const superAdmin = await adminLogin('superadmin')

    // 普通管理员：财务 / 管理员管理 → 403
    const finance = await api('/api/admin/finance/summary', { token: normalAdmin })
    expect(finance.status).toBe(403)
    expect(finance.data.message).toBe('仅超级管理员可访问')

    const admins = await api('/api/admins', { token: normalAdmin })
    expect(admins.status).toBe(403)
    expect(admins.data.message).toBe('仅超级管理员可访问')

    // 普通管理员：订单管理属于本职权限 → 200
    const orders = await api('/api/admin-orders?page=1&page_size=1', { token: normalAdmin })
    expect(orders.status).toBe(200)

    // 超级管理员：两个接口都可访问 → 200
    const financeSuper = await api('/api/admin/finance/summary', { token: superAdmin })
    expect(financeSuper.status).toBe(200)
    const adminsSuper = await api('/api/admins', { token: superAdmin })
    expect(adminsSuper.status).toBe(200)
  })
})
