import { test, expect } from '@playwright/test'
import { adminLogin, api, pickProduct } from './helpers.mjs'

test.describe('商品多语言译文接口', () => {
  test('有译文时按 locale 返回译文；无译文时回退 zh-CN 原文（列表 / 详情 / 查询参数 / 请求头）', async () => {
    const adminToken = await adminLogin()
    const base = await pickProduct()

    // 创建一个带英文与繁体译文的新商品
    const createRes = await api('/api/products', {
      method: 'POST',
      token: adminToken,
      body: {
        name: '多语言测试商品',
        category_id: base.category_id,
        price: 88,
        stock: 5,
        manufacturer: '测试厂家',
        brand: '测试品牌',
        unit: '件',
        description: '这是简体中文的简要描述',
        detail: '这是简体中文的详情',
        translations: {
          en: { name: 'Translated Product', description: 'English description', detail: 'English detail' },
          'zh-TW': { name: '多語言測試商品', description: '繁體描述', detail: '繁體詳情' },
        },
      },
    })
    expect(createRes.status).toBe(201)
    const createdId = createRes.data.data.id

    // 详情：?locale=en 返回英文译文
    const enDetail = await api(`/api/public/products/${createdId}?locale=en`)
    expect(enDetail.status).toBe(200)
    expect(enDetail.data.data.name).toBe('Translated Product')
    expect(enDetail.data.data.description).toBe('English description')
    expect(enDetail.data.data.detail).toBe('English detail')

    // 详情：?locale=zh-TW 返回繁体译文
    const twDetail = await api(`/api/public/products/${createdId}?locale=zh-TW`)
    expect(twDetail.data.data.name).toBe('多語言測試商品')

    // 详情：无 locale 参数回退 zh-CN 原文
    const zhDetail = await api(`/api/public/products/${createdId}`)
    expect(zhDetail.data.data.name).toBe('多语言测试商品')

    // 详情：请求了没有译文的语言（ja）回退 zh-CN 原文
    const jaDetail = await api(`/api/public/products/${createdId}?locale=ja`)
    expect(jaDetail.data.data.name).toBe('多语言测试商品')

    // 详情：X-Locale 请求头返回英文译文
    const headerDetail = await api(`/api/public/products/${createdId}`, { headers: { 'X-Locale': 'en' } })
    expect(headerDetail.data.data.name).toBe('Translated Product')

    // 列表：?locale=en 返回英文译文
    const listEn = await api('/api/public/products?locale=en&page=1&page_size=60')
    expect(listEn.status).toBe(200)
    const foundEn = (listEn.data.data || []).find(p => p.id === createdId)
    expect(foundEn).toBeTruthy()
    expect(foundEn.name).toBe('Translated Product')

    // 列表：无 locale 参数回退 zh-CN 原文
    const listZh = await api('/api/public/products?page=1&page_size=60')
    const foundZh = (listZh.data.data || []).find(p => p.id === createdId)
    expect(foundZh.name).toBe('多语言测试商品')

    // 既有商品没有任何译文：请求 en 时回退 zh-CN 原文
    const fallbackDetail = await api(`/api/public/products/${base.id}?locale=en`)
    expect(fallbackDetail.status).toBe(200)
    expect(fallbackDetail.data.data.name).toBe(base.name)
  })
})