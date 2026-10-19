const normalize = value => String(value || '').replace(/[\s,，、;；]/g, '')
let divisionsPromise
export function loadChinaDivisions(){divisionsPromise ||= import('../data/china-regions.json', { with: { type: 'json' } }).then(module=>module.default);return divisionsPromise}

export async function parseChinaAddress(input) {
  const source = String(input || '').trim()
  if (!source) return null
  const regions = await loadChinaDivisions()
  let rest = source.replace(/(?:收货人|姓名|地址|收件地址)\s*[:：]?/g,' ')
  const phoneMatch = rest.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/)
  const phone = phoneMatch?.[0]?.replace(/\D/g, '').replace(/^86(?=1[3-9])/, '') || ''
  if (phoneMatch) rest = rest.replace(phoneMatch[0], ' ')
  let recipientName = ''
  const first = rest.trim().match(/^([\u3400-\u9fff]{2,6})(?=\s|[,，]|(?:省|市|自治区|特别行政区))/)
  if (first && !/(省|市|区|县|自治州|地区)$/.test(first[1])) { recipientName = first[1]; rest = rest.replace(first[0], ' ') }
  const compact = normalize(rest)
  let province = [...regions].sort((a,b)=>b.name.length-a.name.length).find(item=>compact.includes(normalize(item.name)))
  if(province){
    const provinceAt=compact.indexOf(normalize(province.name))
    const possibleName=compact.slice(0,provinceAt)
    if(/^[\u3400-\u9fff]{2,6}$/.test(possibleName))recipientName=possibleName
  }
  let city = null, district = null
  if (province) {
    const provinceAt = compact.indexOf(normalize(province.name))
    const afterProvince = compact.slice(provinceAt + normalize(province.name).length)
    const cities = province.children || []
    city = [...cities].sort((a,b)=>b.name.length-a.name.length).find(item=>afterProvince.includes(normalize(item.name))) || null
    if (city) {
      const cityAt = afterProvince.indexOf(normalize(city.name))
      const afterCity = afterProvince.slice(cityAt + normalize(city.name).length)
      district = [...(city.children || [])].sort((a,b)=>b.name.length-a.name.length).find(item=>afterCity.includes(normalize(item.name))) || null
    }
  }
  // Accommodate abbreviated paste such as "深圳市南山区" when province is implied.
  if (!province) {
    for (const item of regions) {
      const hit = (item.children || []).find(candidate => compact.includes(normalize(candidate.name)))
      if (hit) { province = item; city = hit; break }
    }
  }
  const addressLine = rest.replace(recipientName, '').replace(phoneMatch?.[0] || '', '').trim()
  const regionNames = [province?.name, city?.name, district?.name].filter(Boolean)
  const withoutRegion = regionNames.reduce((value, name)=>value.replace(name,''), addressLine).replace(/[\s,，、;；]+/g,' ').trim()
  return { recipientName, phone, province:province?.name || '', city:city?.name || '', district:district?.name || '', regionCodes:{ province:province?.code ? `${province.code}0000`.slice(0,6) : '', city:city?.code ? `${city.code}00`.slice(0,6) : '', district:district?.code || '' }, addressLine1:withoutRegion || addressLine, matched:!!province }
}

export function normalizeDivisionCode(code, level) {
  const value=String(code || '')
  if (value.length===6) return value
  if (level==='province') return `${value}0000`.slice(0,6)
  if (level==='city') return `${value}00`.slice(0,6)
  return value
}
