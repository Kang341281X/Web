import { test, expect } from '@playwright/test'
import {
  registerCustomer, addAddress, pickProduct, pickShippingRate, getProduct, placeOrder, api,
} from './helpers.mjs'

test.describe('完整下单流程', () => {
  test('加购 → 运费不一致拒绝(409) → 正常下单 → 库存扣减 → 购物车清空', async () => {
    const customer = await registerCustomer()
    const addressId = await addAddress(customer.token)
    const product = await pickProduct()
    const rate = await pickShippingRate()
    const quantity = 2

    // 1) 加入购物车
    const added = await api('/api/customer/cart', {
      method: 'POST', token: customer.token,
      body: { product_id: product.id, quantity },
    })
    expect(added.status).toBe(200)
    expect(added.data.data.quantity).toBe(quantity)

    const cartBefore = await api('/api/customer/cart', { token: customer.token })
    expect(cartBefore.data.data).toHaveLength(1)
    expect(cartBefore.data.data[0].product_id).toBe(product.id)

    const stockBefore = (await getProduct(product.id)).stock

    // 2) 运费不一致（页面过期/被篡改）→ 409，且不产生任何副作用
    const stale = await placeOrder(customer.token, {
      addressId, locale: rate.locale, quantity,
      shippingFee: rate.fee_cny + 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.data.success).toBe(false)

    // 订单未生成、库存未动、购物车未清
    expect((await getProduct(product.id)).stock).toBe(stockBefore)
    const cartAfterStale = await api('/api/customer/cart', { token: customer.token })
    expect(cartAfterStale.data.data).toHaveLength(1)

    // 3) 声明正确运费 → 下单成功（未传 items，走购物车全部商品）
    const ordered = await placeOrder(customer.token, {
      addressId, locale: rate.locale, quantity,
      shippingFee: rate.fee_cny,
    })
    expect(ordered.status).toBe(201)
    expect(ordered.data.data.status).toBe('pending')
    expect(ordered.data.data.items).toHaveLength(1)
    expect(ordered.data.data.items[0].product_id).toBe(product.id)
    expect(ordered.data.data.items[0].quantity).toBe(quantity)
    // total = 商品小计 + 运费（以服务端口径写入）
    const subtotal = ordered.data.data.items[0].subtotal
    expect(ordered.data.data.total_amount).toBe(subtotal + rate.fee_cny)

    // 4) 库存正确扣减
    expect((await getProduct(product.id)).stock).toBe(stockBefore - quantity)

    // 5) 购物车已清空（只清本次下单商品）
    const cartAfter = await api('/api/customer/cart', { token: customer.token })
    expect(cartAfter.data.data).toHaveLength(0)
  })

  test('直传 items 下单同样扣库存（不依赖购物车）', async () => {
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
    expect((await getProduct(product.id)).stock).toBe(stockBefore - 1)
  })
})
