import { reactive } from 'vue'

// 汇率数据不再硬编码，改由后端接口 GET /api/public/exchange-rates（数据库表 exchange_rate）提供。
// stores/language.js 在应用启动时拉取并调用 setExchangeRates 写入这里；
// 用 reactive 包裹后，汇率变化会自动触发依赖它的价格计算与模板重新渲染。
export const currencyByLocale = reactive({})

const FALLBACK = { symbol: '', code: '', rateFromCny: 1 }

/** 用接口返回的汇率列表刷新本地映射，每项形如 { locale, currency_symbol, currency_code, rate_from_cny } */
export const setExchangeRates = list => {
  for (const item of list || []) {
    if (!item?.locale) continue
    currencyByLocale[item.locale] = {
      symbol: item.currency_symbol,
      code: item.currency_code,
      rateFromCny: Number(item.rate_from_cny),
    }
  }
}

export const getCurrency = locale => currencyByLocale[locale] || currencyByLocale.en || FALLBACK

/** Convert amount entered in display currency to CNY (product base currency). */
export const toCny = (amount, locale) => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) return null
  const { rateFromCny } = getCurrency(locale)
  return Math.round(value / rateFromCny)
}

export const parsePriceInput = value => {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export const formatPriceInput = (cnyAmount, locale) => {
  const { rateFromCny } = getCurrency(locale)
  const converted = cnyAmount * rateFromCny
  return Number.isInteger(converted) ? String(converted) : converted.toFixed(2)
}

/** Format a CNY amount into the display currency string for the given locale. */
export const formatPrice = (cnyAmount, locale) => {
  const { symbol, rateFromCny } = getCurrency(locale)
  const converted = cnyAmount * rateFromCny
  const display = Number.isInteger(converted) ? converted : converted.toFixed(2)
  return symbol + display
}
