// 临时验证：图片尺寸、标题两行省略、标题到价格间距（跑完删除）
import { test, expect } from '@playwright/test'

test('card layout', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('craftora-language', 'zh-CN'))
  await page.goto('/')
  await page.waitForLoadState('networkidle').catch(() => {})

  const card = page.locator('.product-card').first()
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  // 用超长名称验证两行截断（仅在页面内改文本，不影响源码）
  await page.evaluate(() => {
    const title = document.querySelector('.product-card .product-title')
    title.textContent = '这是一件名字非常非常长的手工作品用于验证两行截断与省略号是否正常工作'
  })
  await page.waitForTimeout(100)

  const data = await page.evaluate(() => {
    const cardEl = document.querySelector('.product-card')
    const image = cardEl.querySelector('.product-image')
    const img = image.querySelector('img')
    const title = cardEl.querySelector('.product-title')
    const price = cardEl.querySelector('.product-bottom')
    const titleStyle = getComputedStyle(title)
    const cardStyle = getComputedStyle(cardEl)
    const imageRect = image.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const priceRect = price.getBoundingClientRect()
    return {
      imageRatio: +(imageRect.height / imageRect.width).toFixed(2),
      imageWidth: Math.round(imageRect.width),
      cardWidth: Math.round(cardEl.getBoundingClientRect().width),
      imageToCard: +(imageRect.width / cardEl.getBoundingClientRect().width).toFixed(3),
      padding: cardStyle.paddingTop,
      clamp: titleStyle.webkitLineClamp,
      titleOverflow: titleStyle.overflow,
      titleHeight: Math.round(titleRect.height),
      lineHeight: parseFloat(titleStyle.lineHeight),
      gap: Math.round(priceRect.top - titleRect.bottom),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      imgLoaded: img.complete && img.naturalWidth > 0,
    }
  })
  console.log(`[card:${testInfo.project.name}] ${JSON.stringify(data)}`)

  expect(data.imgLoaded).toBeTruthy()
  expect(data.imageRatio).toBeGreaterThanOrEqual(1.2)
  expect(data.padding).toBe('4px')
  expect(data.clamp).toBe('2')
  expect(data.titleOverflow).toBe('hidden')
  expect(data.titleHeight).toBeLessThanOrEqual(Math.ceil(data.lineHeight * 2) + 2)
  expect(data.gap).toBeLessThanOrEqual(8)
  expect(data.scrollWidth).toBeLessThanOrEqual(data.clientWidth + 1)

  await page.screenshot({ path: `tmp-test/shots/card-${testInfo.project.name}.png` })
})

test('catalog and related grids stay within viewport', async ({ page }) => {
  const list = await (await fetch('http://localhost:3998/api/public/products?page=1&page_size=1')).json()
  const id = list.data?.[0]?.id
  for (const url of ['/products', `/product/${id}`]) {
    await page.goto(url)
    await page.waitForLoadState('networkidle').catch(() => {})
    const size = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      ratio: +(document.querySelector('.product-image')?.getBoundingClientRect().height / document.querySelector('.product-image')?.getBoundingClientRect().width).toFixed(2),
    }))
    expect(size.scrollWidth, `${url} 横向溢出`).toBeLessThanOrEqual(size.clientWidth + 1)
    if (size.ratio) expect(size.ratio).toBeGreaterThanOrEqual(1.2)
  }
})
