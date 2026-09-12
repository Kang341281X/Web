import { reactive } from 'vue'

// 运费数据来自后端 GET /api/public/shipping-rates（数据库表 shipping_rate），
// 不再写死在前端。本站只按界面语言区分用户、不采集具体收货国家，
// 所以按「语言分组」做近似估算：locale → 区域 → fee_cny（人民币）。
// 用 reactive 包裹后，后台调整运费或切换语言都会自动重新计算展示。
export const shippingByLocale = reactive({})

const FALLBACK = { regionKey: 'OTHER', feeCny: 0, note: '' }

/** 用接口返回的运费列表刷新本地映射，每项形如 { region_key, locale, fee_cny, note } */
export const setShippingRates = list => {
  for (const item of list || []) {
    if (!item?.locale) continue
    shippingByLocale[item.locale] = {
      regionKey: item.region_key,
      feeCny: Number(item.fee_cny),
      note: item.note || '',
    }
  }
}

export const getShippingRate = locale => shippingByLocale[locale] || shippingByLocale.en || FALLBACK
