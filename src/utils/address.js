// 省市区三个字段后端都是选填（见 server/routes/customerAddress.js），
// 因此拼接前要先过滤空值，避免出现多余空格。

// 省市区，例如「浙江省 杭州市 西湖区」
export function regionText(address) {
  if (!address) return ''
  return [address.province, address.city, address.district].filter(Boolean).join(' ')
}

// 完整地址（单行展示），例如「浙江省 杭州市 西湖区 文一西路 100 号」
export function formatAddress(address) {
  if (!address) return ''
  return [regionText(address), address.detail_address].filter(Boolean).join(' ')
}
