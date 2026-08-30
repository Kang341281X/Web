import { defineStore } from 'pinia'
import { getCurrency, formatPrice } from '../data/currency'
import { translations, categoryNames } from '../data/translations'
export const useLanguageStore = defineStore('language', {
  state: () => ({ locale: localStorage.getItem('craftora-language') || 'zh-CN' }),
  getters: {
    t: state => key => translations[state.locale]?.[key] || translations.en[key] || key,
    category: state => id => (categoryNames[state.locale] || categoryNames.en)[id] || categoryNames.en[id] || id,
    currency: state => getCurrency(state.locale),
    price: state => cnyAmount => formatPrice(cnyAmount, state.locale)
  },
  actions: { setLocale(locale) { this.locale = locale; localStorage.setItem('craftora-language', locale) } }
})
