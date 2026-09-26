import { test, expect } from '@playwright/test'
import { api } from './helpers.mjs'

// 单条最小条目，够走完校验分支即可
const item = { sku: 'T1', name: '测试商品', quantity: 1, price: 9.9 }

test.describe('结算清单导出防护', () => {
  test('超过条目上限（>200）→ 400 并给出清晰中文提示', async () => {
    const res = await api('/api/public/checkout/export', {
      method: 'POST',
      body: { items: Array.from({ length: 201 }, () => ({ ...item })) },
    })
    expect(res.status).toBe(400)
    expect(res.data.success).toBe(false)
    expect(res.data.message).toContain('最多 200 条')
  })

  test('恰好 200 条 → 正常导出', async () => {
    const res = await api('/api/public/checkout/export', {
      method: 'POST',
      body: { items: Array.from({ length: 200 }, (_, i) => ({ ...item, sku: `T${i}` })) },
    })
    expect(res.status).toBe(200)
  })

  test('空 items → 400', async () => {
    const res = await api('/api/public/checkout/export', { method: 'POST', body: { items: [] } })
    expect(res.status).toBe(400)
    expect(res.data.message).toBe('购物车中没有可导出的商品')
  })

  test('同一 IP 每分钟超过 20 次 → 429 限流', async () => {
    // 固定一个 IP 连打 21 次（限流器每 IP 每分钟 20 次），第 21 次应被拒绝
    const fixedIp = '10.77.77.77'
    const statuses = []
    for (let i = 0; i < 21; i++) {
      const res = await api('/api/public/checkout/export', { method: 'POST', ip: fixedIp, body: { items: [item] } })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every(s => s === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})
