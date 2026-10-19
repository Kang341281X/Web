import { test, expect } from '@playwright/test'
import { ADDRESS_COUNTRIES, getCountryConfig, SHIPPING_COUNTRIES } from '../src/data/address-countries.js'
import { parseChinaAddress } from '../src/utils/chinaAddress.js'

test('country rules include required countries, ISO codes, and representative postal rules', () => {
  for (const code of ['US','CA','GB','DE','FR','AU','JP','KR','SG','HK','TW','MO','CN']) {
    expect(ADDRESS_COUNTRIES.some(country => country.code === code)).toBeTruthy()
  }
  const postalRule=code=>new RegExp(getCountryConfig(code).fields.find(field=>field.key==='postal_code').pattern,'i')
  expect(postalRule('US').test('10001')).toBeTruthy()
  expect(postalRule('US').test('10A01')).toBeFalsy()
  expect(postalRule('CA').test('K1A 0B1')).toBeTruthy()
  expect(postalRule('GB').test('SW1A 1AA')).toBeTruthy()
  expect(postalRule('DE').test('10115')).toBeTruthy()
  expect(postalRule('AU').test('2000')).toBeTruthy()
  expect(postalRule('JP').test('100-0001')).toBeTruthy()
  expect(getCountryConfig('JP').nameOrder).toBe('family-first')
  expect(SHIPPING_COUNTRIES).toContain('CN')
  expect(getCountryConfig('NZ').fields.some(field => field.key === 'address_line1')).toBeTruthy()
})

test('China address paste recognizes five common formats and division names', async () => {
  const examples = [
    ['张三','张三 13800138000 广东省深圳市南山区科技南路 8 号'],
    ['李四','李四，电话：13800138000，广东省 深圳市 南山区 科技南路8号'],
    ['王五','王五 +86 13800138000 广东省深圳市南山区科技南路8号'],
    ['赵六','收货人：赵六 地址：广东省深圳市南山区科技南路 8 号 手机 13800138000'],
    ['周七','周七13800138000广东省深圳市南山区科技南路8号'],
  ]
  for (const [expectedName,sample] of examples) {
    const parsed = await parseChinaAddress(sample)
    expect(parsed.recipientName).toBe(expectedName)
    expect(parsed.phone).toBe('13800138000')
    expect(parsed.province).toBe('广东省')
    expect(parsed.city).toBe('深圳市')
    expect(parsed.district).toBe('南山区')
    expect(parsed.regionCodes.province).toMatch(/^\d{6}$/)
    expect(parsed.addressLine1).toContain('科技南路')
  }
})

test('address API keeps one default, promotes after delete, and enforces the per-customer limit', async () => {
  const { registerCustomer, api } = await import('./helpers.mjs')
  const customer = await registerCustomer()
  const payload = index => ({
    country_code:'CN', recipient_name:`收件人${index}`, phone_e164:'+8613800138000',
    province:'广东省', city:'深圳市', district:'南山区',
    address_line1:`科技南路 ${index} 号`, region_codes:{province:'440000',city:'440300',district:'440305'},
  })
  const ids=[]
  for(let index=0;index<10;index++){
    const result=await api('/api/customer/addresses',{method:'POST',token:customer.token,body:payload(index)})
    expect(result.status).toBe(201)
    ids.push(result.data.data.id)
  }
  let list=(await api('/api/customer/addresses',{token:customer.token})).data.data
  expect(list.filter(item=>item.is_default)).toHaveLength(1)
  expect(list[0].is_default).toBe(1)
  expect((await api('/api/customer/addresses',{method:'POST',token:customer.token,body:payload(11)})).status).toBe(400)
  expect((await api(`/api/customer/addresses/${ids[1]}/used`,{method:'PATCH',token:customer.token})).status).toBe(200)
  expect((await api(`/api/customer/addresses/${ids[0]}`,{method:'DELETE',token:customer.token})).status).toBe(200)
  list=(await api('/api/customer/addresses',{token:customer.token})).data.data
  expect(list.filter(item=>item.is_default)).toHaveLength(1)
  expect(list[0].id).toBe(ids[1])
})

test('address dialog changes field order and saves an international address in browser', async ({ page }) => {
  const { registerCustomer } = await import('./helpers.mjs')
  const customer = await registerCustomer()
  await page.goto('http://localhost:5999/')
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('customer_token', token)
    localStorage.setItem('customer_user', JSON.stringify(user))
    localStorage.setItem('craftora-language', 'en')
  }, { token: customer.token, user: { id: customer.id, username: customer.username, phone: customer.phone } })
  await page.goto('http://localhost:5999/account/addresses')
  await page.getByRole('button', { name: 'Add address', exact: true }).click()
  const country = page.getByLabel(/Country \/ region/)
  await country.selectOption('US')
  await expect(page.getByLabel(/^State/)).toBeVisible()
  await page.getByLabel(/Full name/).fill('Taylor Morgan')
  await page.getByLabel(/Address line 1/).fill('350 Fifth Avenue')
  await page.getByLabel(/City \/ town/).fill('New York')
  await page.getByLabel(/^State/).selectOption('NY')
  await page.getByLabel(/ZIP code/).fill('10001')
  await page.locator('.phone-input input').fill('2025550123')
  await page.getByRole('button', { name: '保存地址' }).click()
  await expect(page.getByText('Taylor Morgan')).toBeVisible()
  await expect(page.getByText(/350 Fifth Avenue/)).toBeVisible()
})
