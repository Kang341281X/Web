import { defineStore } from 'pinia'
import { getCurrency, formatPrice, setExchangeRates } from '../data/currency'
import { getShippingRate, setShippingRates } from '../data/shipping'
import { translations, categoryNames, supportedLocales } from '../data/translations'
import { fetchExchangeRates, fetchShippingRates } from '../services/publicApi'

// 汇率/运费缓存：首次访问时请求接口写入 localStorage；之后再启动可先用缓存同步预热，
// 避免价格与运费在接口返回前出现短暂的换算闪动。
const RATES_CACHE_KEY = 'craftora-exchange-rates'
const SHIPPING_CACHE_KEY = 'craftora-shipping-rates'

function readCache(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function readInitialLocale() {
  const saved = localStorage.getItem('craftora-language')
  return supportedLocales.includes(saved) ? saved : 'zh-CN'
}

const cachedRates = readCache(RATES_CACHE_KEY)
if (cachedRates.length) setExchangeRates(cachedRates)
const cachedShipping = readCache(SHIPPING_CACHE_KEY)
if (cachedShipping.length) setShippingRates(cachedShipping)

export const useLanguageStore = defineStore('language', {
  state: () => ({
    locale: readInitialLocale(),
    rates: cachedRates,
    ratesLoaded: false,
    shippingRates: cachedShipping,
    shippingLoaded: false,
  }),
  getters: {
    t: state => key => translations[state.locale]?.[key] || translations.en[key] || key,
    category: state => id => (categoryNames[state.locale] || categoryNames.en)[id] || categoryNames.en[id] || id,
    currency: state => getCurrency(state.locale),
    price: state => cnyAmount => formatPrice(cnyAmount, state.locale),
    // 当前语言对应的预估运费：{ regionKey, feeCny, note }；feeCny 为 0 表示包邮
    shipping: state => getShippingRate(state.locale),
  },
  actions: {
    setLocale(locale) {
      const next = supportedLocales.includes(locale) ? locale : 'zh-CN'
      this.locale = next
      localStorage.setItem('craftora-language', next)
    },
    // 启动时拉取汇率并缓存；force=true 可强制刷新
    async loadRates(force = false) {
      if (this.ratesLoaded && !force) return
      try {
        const list = await fetchExchangeRates()
        if (Array.isArray(list) && list.length) {
          this.rates = list
          setExchangeRates(list)
          localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(list))
        }
      } catch {
        // 拉取失败时沿用已缓存/已预热的汇率，价格仍可展示
      } finally {
        this.ratesLoaded = true
      }
    },
    // 启动时拉取运费并缓存；force=true 可强制刷新
    async loadShipping(force = false) {
      if (this.shippingLoaded && !force) return
      try {
        const list = await fetchShippingRates()
        if (Array.isArray(list) && list.length) {
          this.shippingRates = list
          setShippingRates(list)
          localStorage.setItem(SHIPPING_CACHE_KEY, JSON.stringify(list))
        }
      } catch {
        // 拉取失败时沿用已缓存/已预热的运费
      } finally {
        this.shippingLoaded = true
      }
    },
  },
})
