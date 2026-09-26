import { test, expect } from '@playwright/test'
import { adminLogin, pickProduct, api } from './helpers.mjs'

test.describe('商品库存丢失更新修复（方案 A：库存与编辑解耦）', () => {
  test('编辑商品时提交过期 stock/sales 不会覆盖真实库存；库存走 PATCH 增量接口', async () => {
    const adminToken = await adminLogin()
    const product = await pickProduct()

    // 读取商品当前完整信息
    const detail = await api(`/api/products/${product.id}`, { token: adminToken })
    expect(detail.status).toBe(200)
    const current = detail.data.data
    expect(current.stock).toBe(product.stock)

    // 模拟「编辑弹窗打开时的过期快照」：表单里带一个离谱的 stock/sales 提交编辑
    const stalePayload = {
      ...current,
      stock: current.stock + 9999,
      sales: current.sales + 9999,
      description: `${current.description || ''}`.slice(0, 100) || '接口测试',
    }
    const updated = await api(`/api/products/${product.id}`, { method: 'PUT', token: adminToken, body: stalePayload })
    expect(updated.status).toBe(200)

    // PUT 后再读：stock/sales 不被编辑覆盖（仍然等于原值）
    const after = await api(`/api/products/${product.id}`, { token: adminToken })
    expect(after.data.data.stock).toBe(current.stock)
    expect(after.data.data.sales).toBe(current.sales)
  })

  test('PATCH /stock 增量调整：加减原子生效、调负数被拒', async () => {
    const adminToken = await adminLogin()
    const product = await pickProduct()
    const detail = await api(`/api/products/${product.id}`, { token: adminToken })
    const current = detail.data.data

    // +5
    const up = await api(`/api/products/${product.id}/stock`, {
      method: 'PATCH', token: adminToken, body: { delta: 5, reason: '接口测试补货' },
    })
    expect(up.status).toBe(200)
    expect(up.data.data.stock).toBe(current.stock + 5)

    // -5 恢复
    const down = await api(`/api/products/${product.id}/stock`, {
      method: 'PATCH', token: adminToken, body: { delta: -5, reason: '接口测试还原' },
    })
    expect(down.status).toBe(200)
    expect(down.data.data.stock).toBe(current.stock)

    // 下调超过当前库存 → 400，库存不变
    const overflow = await api(`/api/products/${product.id}/stock`, {
      method: 'PATCH', token: adminToken, body: { delta: -(current.stock + 1) },
    })
    expect(overflow.status).toBe(400)
    const afterOverflow = await api(`/api/products/${product.id}`, { token: adminToken })
    expect(afterOverflow.data.data.stock).toBe(current.stock)

    // delta = 0 / 非整数 → 400
    const zero = await api(`/api/products/${product.id}/stock`, { method: 'PATCH', token: adminToken, body: { delta: 0 } })
    expect(zero.status).toBe(400)
    const frac = await api(`/api/products/${product.id}/stock`, { method: 'PATCH', token: adminToken, body: { delta: 1.5 } })
    expect(frac.status).toBe(400)
  })
})
