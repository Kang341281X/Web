export const currencyByLocale = {
  'zh-CN': { symbol: '¥', code: 'CNY', rateFromCny: 1 },
  'zh-TW': { symbol: 'NT$', code: 'TWD', rateFromCny: 4.4 },
  en: { symbol: '$', code: 'USD', rateFromCny: 0.14 },
  ja: { symbol: '¥', code: 'JPY', rateFromCny: 20.5 },
  ko: { symbol: '₩', code: 'KRW', rateFromCny: 190 },
  es: { symbol: '€', code: 'EUR', rateFromCny: 0.13 }
}

export const getCurrency = locale => currencyByLocale[locale] || currencyByLocale.en

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
