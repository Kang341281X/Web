import { getCountries, getCountryCallingCode } from 'libphonenumber-js'

// Country rules are data: adding a country means adding one entry here.
const field = (key, en, zh, extra = {}) => ({ key, label: { en, zh }, ...extra })
const person = field('recipient_name', 'Full name', '收件人姓名', { required: true, max: 60, autocomplete: 'shipping name' })
const line1 = field('address_line1', 'Address line 1', '地址行 1', { required: true, max: 100, autocomplete: 'shipping address-line1' })
const line2 = field('address_line2', 'Address line 2', '地址行 2', { max: 100, autocomplete: 'shipping address-line2' })
const city = field('city', 'City / town', '城市', { required: true, max: 50, autocomplete: 'shipping address-level2' })
const postal = field('postal_code', 'Postal code', '邮政编码', { required: true, max: 16, autocomplete: 'shipping postal-code' })
const phone = field('phone', 'Phone', '电话', { required: true, autocomplete: 'shipping tel' })
const region = (en, zh, options, required = true) => field('state_code', en, zh, { required, options })
const state = (en, zh, pairs) => region(en, zh, pairs.map(([code, name]) => ({ code, name })))

const us = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['AA','Armed Forces Americas'],['AE','Armed Forces Europe'],['AP','Armed Forces Pacific']]
const ca = [['AB','Alberta'],['BC','British Columbia'],['MB','Manitoba'],['NB','New Brunswick'],['NL','Newfoundland and Labrador'],['NT','Northwest Territories'],['NS','Nova Scotia'],['NU','Nunavut'],['ON','Ontario'],['PE','Prince Edward Island'],['QC','Quebec'],['SK','Saskatchewan'],['YT','Yukon']]
const au = [['ACT','Australian Capital Territory'],['NSW','New South Wales'],['NT','Northern Territory'],['QLD','Queensland'],['SA','South Australia'],['TAS','Tasmania'],['VIC','Victoria'],['WA','Western Australia']]
const jp = [['JP-01','北海道'],['JP-02','青森県'],['JP-03','岩手県'],['JP-04','宮城県'],['JP-05','秋田県'],['JP-06','山形県'],['JP-07','福島県'],['JP-08','茨城県'],['JP-09','栃木県'],['JP-10','群馬県'],['JP-11','埼玉県'],['JP-12','千葉県'],['JP-13','東京都'],['JP-14','神奈川県'],['JP-15','新潟県'],['JP-16','富山県'],['JP-17','石川県'],['JP-18','福井県'],['JP-19','山梨県'],['JP-20','長野県'],['JP-21','岐阜県'],['JP-22','静岡県'],['JP-23','愛知県'],['JP-24','三重県'],['JP-25','滋賀県'],['JP-26','京都府'],['JP-27','大阪府'],['JP-28','兵庫県'],['JP-29','奈良県'],['JP-30','和歌山県'],['JP-31','鳥取県'],['JP-32','島根県'],['JP-33','岡山県'],['JP-34','広島県'],['JP-35','山口県'],['JP-36','徳島県'],['JP-37','香川県'],['JP-38','愛媛県'],['JP-39','高知県'],['JP-40','福岡県'],['JP-41','佐賀県'],['JP-42','長崎県'],['JP-43','熊本県'],['JP-44','大分県'],['JP-45','宮崎県'],['JP-46','鹿児島県'],['JP-47','沖縄県']]
const tw = ['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'].map(x=>({code:x,name:x}))
const countries = [
  { code:'US', names:{en:'United States',zh:'美国'}, dial:'+1', fields:[person,line1,line2,city,state('State','州',us),{...postal,label:{en:'ZIP code',zh:'邮政编码'},pattern:'^\\d{5}(-\\d{4})?$'},phone] },
  { code:'CA', names:{en:'Canada',zh:'加拿大'}, dial:'+1', fields:[person,line1,line2,city,state('Province','省',ca),{...postal,pattern:'^[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d$'},phone] },
  { code:'GB', names:{en:'United Kingdom',zh:'英国'}, dial:'+44', fields:[person,line1,line2,city,field('state_code','County (optional)','郡（可选）',{max:50}),{...postal,label:{en:'Postcode',zh:'邮政编码'},required:true,pattern:'^[A-Za-z0-9 ]{5,8}$'},phone] },
  { code:'DE', names:{en:'Germany',zh:'德国'}, dial:'+49', fields:[person,line1,{...postal,pattern:'^\\d{5}$'},city,phone] },
  { code:'FR', names:{en:'France',zh:'法国'}, dial:'+33', fields:[person,line1,{...postal,pattern:'^\\d{5}$'},city,phone] },
  { code:'AU', names:{en:'Australia',zh:'澳大利亚'}, dial:'+61', fields:[person,line1,line2,field('city','Suburb','郊区/城镇',{required:true,max:50}),state('State / territory','州/领地',au),{...postal,label:{en:'Postcode',zh:'邮政编码'},pattern:'^\\d{4}$'},phone] },
  { code:'JP', names:{en:'Japan',zh:'日本'}, dial:'+81', nameOrder:'family-first', fields:[person,{...postal,pattern:'^\\d{3}-?\\d{4}$'},state('Prefecture','都道府县',jp),city,line1,line2,phone] },
  { code:'KR', names:{en:'South Korea',zh:'韩国'}, dial:'+82', fields:[person,{...postal,pattern:'^\\d{5}$'},line1,line2,phone] },
  { code:'SG', names:{en:'Singapore',zh:'新加坡'}, dial:'+65', fields:[person,{...postal,pattern:'^\\d{6}$'},line1,line2,phone] },
  { code:'HK', names:{en:'Hong Kong','zh':'中国香港'}, dial:'+852', fields:[person,line1,line2,field('city','District','地区',{required:true,max:50}),state('Region','区域',[['HKI','Hong Kong Island'],['KLN','Kowloon'],['NT','New Territories']]),phone] },
  { code:'TW', names:{en:'Taiwan','zh':'中国台湾'}, dial:'+886', fields:[person,{...postal,required:false,pattern:'^\\d{3,6}$'},region('County / city','县市',tw),field('city','District / township','乡镇市区',{required:true,max:50}),line1,phone] },
  { code:'MO', names:{en:'Macao','zh':'中国澳门'}, dial:'+853', fields:[person,line1,line2,region('Area','区域',[['peninsula','澳门半岛'],['taipa','氹仔'],['coloane','路环']].map(([code,name])=>({code,name})),false),phone] },
  { code:'CN', names:{en:'China','zh':'中国大陆'}, dial:'+86', fields:[person,phone,field('region','Region','所在地区',{required:true}),field('detail_address','Detailed address','详细地址',{required:true,max:100,autocomplete:'shipping address-line1'}),{...postal,required:false,pattern:'^\\d{6}$'},field('label','Label','标签')] },
]

const names = new Intl.DisplayNames(['en'], { type:'region' })
const zhNames = new Intl.DisplayNames(['zh-CN'], { type:'region' })
const isoCodes = new Set(getCountries())
export const isIsoCountryCode = code => isoCodes.has(code)
export const SHIPPING_COUNTRIES = ['US','CA','GB','DE','FR','AU','JP','KR','SG','HK','TW','MO','CN']
export const ADDRESS_COUNTRIES = getCountries().sort().map(code => countries.find(x=>x.code===code) || ({code,names:{en:names.of(code),zh:zhNames.of(code)},dial:`+${getCountryCallingCode(code)}`}))
export function getCountryConfig(code) {
  return countries.find(country=>country.code===code) || {code,names:{en:names.of(code),zh:zhNames.of(code)},dial:`+${getCountryCallingCode(code)}`,fields:[person,line1,line2,city,field('state_code','State / region','州/省/地区',{required:false,max:50}),{...postal,required:false},phone]}
}
export const ADDRESS_COUNTRY_CONFIGS = countries
