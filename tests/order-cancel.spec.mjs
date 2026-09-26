import { test, expect } from '@playwright/test'
import {
  registerCustomer, addAddress, pickProduct, pickShippingRate, getProduct, placeOrder, advanceOrder, adminLogin, api,
} from './helpers.mjs'

test.describe('订单取消', () => {
  test('取消订单：库存回补 + 重复取消幂等', async () => {
    const customer = await registerCustomer()
    const addressId = await addAddress(customer.token)
    const product = await pickProduct()
    const rate = await pickShippingRate()
    const stockBefore = (await getProduct(product.id)).stock

    const ordered = await placeOrder(customer.token, {
      addressId, locale: rate.locale, productId: product.id, quantity: 1,
      shippingFee: rate.fee_cny,
    })
    expect(ordered.status).toBe(201)
    const orderId = ordered.data.data.id
    expect((await getProduct(product.id)).stock).toBe(stockBefore - 1)

    // 取消 → 库存回补
    const cancel = await api(`/api/customer/orders/${orderId}/cancel`, { method: 'PUT', token: customer.token })
    expect(cancel.status).toBe(200)
    expect(cancel.data.changed).toBe(true)
    expect(cancel.data.restored).toBe(1)
    expect(cancel.data.data.status).toBe('cancelled')
    expect((await getProduct(product.id)).stock).toBe(stockBefore)

    // 重复取消 → 幂等：不再回补库存，状态不变
    const cancelAgain = await api(`/api/customer/orders/${orderId}/cancel`, { method: 'PUT', token: customer.token })
    expect(cancelAgain.status).toBe(200)
    expect(cancelAgain.data.changed).toBe(false)
    expect((await getProduct(product.id)).stock).toBe(stockBefore)
  })

  test('已发货订单不可取消（409/400 由状态机拒绝）', async () => {
    const customer = await registerCustomer()
    const addressId = await addAddress(customer.token)
    const product = await pickProduct()
    const rate = await pickShippingRate()
    const adminToken = await adminLogin()

    const ordered = await placeOrder(customer.token, {
      addressId, locale: rate.locale, productId: product.id, quantity: 1,
      shippingFee: rate.fee_cny,
    })
    expect(ordered.status).toBe(201)
    const orderId = ordered.data.data.id

    // pending → confirmed → shipped
    const steps = await advanceOrder(orderId, ['confirmed', 'shipped'], adminToken)
    for (const step of steps) {
      expect(step.status).toBe(200)
      expect(step.data.changed).toBe(true)
    }

    const stockBeforeShip = (await getProduct(product.id)).stock
    const cancel = await api(`/api/customer/orders/${orderId}/cancel`, { method: 'PUT', token: customer.token })
    expect(cancel.status).toBe(400)
    expect(cancel.data.success).toBe(false)
    // 库存没有因为失败的取消而被回补
    expect((await getProduct(product.id)).stock).toBe(stockBeforeShip)
  })
})
