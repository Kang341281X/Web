import { getCountryConfig } from '../data/address-countries'

// 省市区三个字段后端都是选填（见 server/routes/customerAddress.js），
// 因此拼接前要先过滤空值，避免出现多余空格。

// 省市区，例如「浙江省 杭州市 西湖区」
export function regionText(address) {
  if (!address) return ''
  if (address.country_code && address.country_code !== 'CN') return [address.address_line2, address.city, address.state_code, address.postal_code].filter(Boolean).join(' ')
  return [address.province, address.city, address.district].filter(Boolean).join(' ')
}

// 完整地址（单行展示），例如「浙江省 杭州市 西湖区 文一西路 100 号」
export function formatAddress(address) {
  if (!address) return ''
  if (address.country_code && address.country_code !== 'CN') return [address.address_line1 || address.detail_address, address.address_line2, address.city, address.state_code, address.postal_code, getCountryConfig(address.country_code).names.en].filter(Boolean).join(', ')
  return [regionText(address), address.address_line1 || address.detail_address].filter(Boolean).join(' ')
}

export function displayPhone(address) {
  const value=address?.phone_e164 || address?.receiver_phone || ''
  if(address?.country_code==='CN') { const national=value.replace(/^\+86/,'').replace(/\D/g,'');if(/^1[3-9]\d{9}$/.test(national))return national.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2') }
  return value
}
