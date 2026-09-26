import { test, expect } from '@playwright/test'
import {
  registerCustomer, addAddress, pickProduct, pickShippingRate, placeOrder, advanceOrder, adminLogin, api, openTestDb,
} from './helpers.mjs'

test.describe('评价权限与 24 小时窗口', () => {
  test('无「已完成」订单不能评价；已完成可评价、24 小时内可改、超时只能删', async () => {
    const adminToken = await adminLogin()
    const product = await pickProduct()
    const rate = await pickShippingRate()

    // -- 前置：顾客 A 完成一笔包含该商品的订单 --
    const buyer = await registerCustomer()
    const addressId = await addAddress(buyer.token)
    const ordered = await placeOrder(buyer.token, {
      addressId, locale: rate.locale, productId: product.id, quantity: 1,
      shippingFee: rate.fee_cny,
    })
    expect(ordered.status).toBe(201)

    // A 还没完成订单（pending）→ 不能评价
    const tooEarly = await api(`/api/customer/products/${product.id}/reviews`, {
      method: 'POST', token: buyer.token, body: { rating: 5, content: '刚下单就想评价' },
    })
    expect(tooEarly.status).toBe(400)
    expect(tooEarly.data.message).toBe('请先购买该商品后再评价')

    // -- 顾客 B 完全没买过 → 不能评价 --
    const stranger = await registerCustomer()
    const noPurchase = await api(`/api/customer/products/${product.id}/reviews`, {
      method: 'POST', token: stranger.token, body: { rating: 5, content: '没买过也想评价' },
    })
    expect(noPurchase.status).toBe(400)
    expect(noPurchase.data.message).toBe('请先购买该商品后再评价')

    // -- 推进到已完成 → 可评价 --
    const steps = await advanceOrder(ordered.data.data.id, ['confirmed', 'shipped', 'completed'], adminToken)
    for (const step of steps) expect(step.data.changed).toBe(true)

    const reviewed = await api(`/api/customer/products/${product.id}/reviews`, {
      method: 'POST', token: buyer.token, body: { rating: 5, content: '接口测试：商品很好' },
    })
    expect(reviewed.status).toBe(201)
    expect(reviewed.data.data.is_purchased).toBe(true)
    const reviewId = reviewed.data.data.id

    // -- 24 小时内：可修改 --
    const edited = await api(`/api/customer/reviews/${reviewId}`, {
      method: 'PUT', token: buyer.token, body: { rating: 4, content: '接口测试：改一下评分' },
    })
    expect(edited.status).toBe(200)
    expect(edited.data.data.rating).toBe(4)
    expect(edited.data.data.edited).toBe(true)

    // -- 超过 24 小时：不能修改（把 created_at 直接回拨 25 小时构造条件） --
    const db = openTestDb()
    db.prepare("UPDATE product_review SET created_at = datetime('now', '-25 hours') WHERE id = ?").run(reviewId)
    db.close()

    const editExpired = await api(`/api/customer/reviews/${reviewId}`, {
      method: 'PUT', token: buyer.token, body: { rating: 3, content: '接口测试：超时修改' },
    })
    expect(editExpired.status).toBe(400)
    expect(editExpired.data.message).toBe('评论发布超过 24 小时，无法修改')

    // -- 超过 24 小时：仍可删除 --
    const deleted = await api(`/api/customer/reviews/${reviewId}`, {
      method: 'DELETE', token: buyer.token,
    })
    expect(deleted.status).toBe(200)
    expect(deleted.data.success).toBe(true)

    // 清理：取消该已完成订单已不可能（终态），保留订单不影响其它用例（各自使用独立顾客）
  })

  test('不能删除/修改别人的评价', async () => {
    const adminToken = await adminLogin()
    const product = await pickProduct()
    const rate = await pickShippingRate()

    const owner = await registerCustomer()
    const addressId = await addAddress(owner.token)
    const ordered = await placeOrder(owner.token, {
      addressId, locale: rate.locale, productId: product.id, quantity: 1,
      shippingFee: rate.fee_cny,
    })
    await advanceOrder(ordered.data.data.id, ['confirmed', 'shipped', 'completed'], adminToken)
    const reviewed = await api(`/api/customer/products/${product.id}/reviews`, {
      method: 'POST', token: owner.token, body: { rating: 5, content: '归属校验用评价' },
    })
    expect(reviewed.status).toBe(201)
    const reviewId = reviewed.data.data.id

    const other = await registerCustomer()
    const editOther = await api(`/api/customer/reviews/${reviewId}`, {
      method: 'PUT', token: other.token, body: { rating: 1, content: '改别人的' },
    })
    expect(editOther.status).toBe(403)

    const deleteOther = await api(`/api/customer/reviews/${reviewId}`, {
      method: 'DELETE', token: other.token,
    })
    expect(deleteOther.status).toBe(403)

    // 清理：本人删除，恢复商品评分统计
    const cleanup = await api(`/api/customer/reviews/${reviewId}`, { method: 'DELETE', token: owner.token })
    expect(cleanup.status).toBe(200)
  })
})
