<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { ADDRESS_COUNTRIES, getCountryConfig } from '../../data/address-countries'
import { loadChinaDivisions, normalizeDivisionCode, parseChinaAddress } from '../../utils/chinaAddress'
import { useAddressStore } from '../../stores/address'
import { useLanguageStore } from '../../stores/language'

const props=defineProps({visible:Boolean,address:{type:Object,default:null}})
const emit=defineEmits(['update:visible','saved'])
const store=useAddressStore(),language=useLanguageStore()
const isEnglish=computed(()=>String(language.locale).startsWith('en'))
function inferDefaultCountry(){
  const locale=(navigator.language||'').toUpperCase().replace('_','-').split('-')
  const candidate=locale.at(-1)
  return ADDRESS_COUNTRIES.some(country=>country.code===candidate)?candidate:'CN'
}
const countryLabel=country=>country.names[isEnglish.value?'en':'zh'] || country.names.en
const form=reactive({countryCode:'CN',recipientName:'',phone:'',phoneDial:'+86',phoneNumber:'',addressLine1:'',addressLine2:'',city:'',stateCode:'',postalCode:'',province:'',district:'',regionCodes:{},label:'',customLabel:'',deliveryInstructions:'',isDefault:false})
const touched=reactive({}),errors=reactive({})
const regions=ref([])
const activeConfig=computed(()=>getCountryConfig(form.countryCode))
const panelVisible=ref(false),pasteText=ref(''),modal=ref(null),firstInput=ref(null)
const manualRegion=ref(false)
const cnRegion=computed(()=>form.countryCode==='CN')
const provinceChoices=computed(()=>regions.value)
const selectedProvince=computed(()=>regions.value.find(item=>normalizeDivisionCode(item.code,'province')===form.regionCodes.province) || null)
const cityChoices=computed(()=>selectedProvince.value?.children || [])
const selectedCity=computed(()=>cityChoices.value.find(item=>normalizeDivisionCode(item.code,'city')===form.regionCodes.city) || null)
const districtChoices=computed(()=>selectedCity.value?.children || [])
const regionSummary=computed(()=>[form.province,form.city,form.district].filter(Boolean).join(' '))
const regionError=computed(()=>errors.region || '')
const fullPhone=computed(()=>`${form.phoneDial}${form.phoneNumber.replace(/[^\d]/g,'')}`)
const isEdit=computed(()=>!!props.address?.id)
const fieldError=key=>errors[key] || ''
const labelFor=item=>item.label[isEnglish.value?'en':'zh'] || item.label.en

function clearCountrySpecific(){
  form.addressLine2='';form.city='';form.stateCode='';form.postalCode='';form.province='';form.district='';form.regionCodes={};
  Object.keys(touched).forEach(key=>delete touched[key]);Object.keys(errors).forEach(key=>delete errors[key])
}
function changeCountry(){
  clearCountrySpecific();manualRegion.value=false;form.phoneDial=activeConfig.value.dial
  if(!form.phoneNumber) form.phoneDial=activeConfig.value.dial
}
function validation(item){
  const formKey={recipient_name:'recipientName',address_line1:'addressLine1',address_line2:'addressLine2',state_code:'stateCode',postal_code:'postalCode'}[item.key] || item.key
  const value=String(form[formKey] ?? '').trim()
  if(item.required && !value) return isEnglish.value?`${labelFor(item)} is required`:`请填写${labelFor(item)}`
  if(value && item.pattern && !new RegExp(item.pattern,'i').test(value)) return isEnglish.value?`Enter a valid ${labelFor(item)}`:`${labelFor(item)}格式不正确`
  if(value && item.max && value.length>item.max) return isEnglish.value?`${labelFor(item)} is too long`:`${labelFor(item)}不能超过 ${item.max} 个字符`
  return ''
}
function validateOne(key){
  if(key==='region'){errors.region=regionSummary.value? '':(isEnglish.value?'Choose a province and city':'请选择所在省市');return errors.region}
  if(key==='phone'){
    const number=parsePhoneNumberFromString(fullPhone.value,form.countryCode)
    errors.phone=!number?.isValid()?(isEnglish.value?'Enter a valid phone number':'请输入有效的电话号码'):''
    if(form.countryCode==='CN' && number?.country==='CN' && !/^1[3-9]\d{9}$/.test(number.nationalNumber)) errors.phone='请输入有效的 11 位手机号'
    return errors.phone
  }
  const item=activeConfig.value.fields.find(field=>field.key===key)
  if(item) errors[key]=validation(item)
  return errors[key] || ''
}
function blurField(key){touched[key]=true;validateOne(key)}
async function submit(){
  Object.keys(errors).forEach(key=>delete errors[key])
  const keys=activeConfig.value.fields.filter(item=>item.key!=='label').map(item=>item.key)
  if(cnRegion.value) keys.push('region')
  keys.forEach(key=>{touched[key]=true;validateOne(key)})
  const first=keys.find(key=>errors[key])
  if(first){await nextTick();modal.value?.querySelector(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] button`)?.focus();return}
  const result=await (isEdit.value?store.update(props.address.id,toPayload()):store.create(toPayload()))
  if(!result.success){errors.form=result.message;return}
  emit('saved',result.data);emit('update:visible',false)
}
function toPayload(){
  const parsed=parsePhoneNumberFromString(fullPhone.value,form.countryCode)
  return {...form,phone:parsed?.number || fullPhone.value,label:form.label==='custom'?form.customLabel:form.label,isDefault:form.isDefault,regionCodes:form.regionCodes}
}
function selectProvince(code){
  const item=regions.value.find(row=>normalizeDivisionCode(row.code,'province')===code)
  form.province=item?.name||'';form.city='';form.district='';form.regionCodes={province:code,city:'',district:''};validateOne('region')
}
function selectCity(code){
  const item=cityChoices.value.find(row=>normalizeDivisionCode(row.code,'city')===code)
  form.city=item?.name||'';form.district='';form.regionCodes.city=code;form.regionCodes.district='';validateOne('region')
}
function selectDistrict(code){
  const item=districtChoices.value.find(row=>row.code===code)
  form.district=item?.name||'';form.regionCodes.district=code;panelVisible.value=false;validateOne('region')
}
function toggleManualRegion(){manualRegion.value=!manualRegion.value;if(manualRegion.value)form.regionCodes={}}
async function pasteAddress(){
  regions.value=await loadChinaDivisions()
  const parsed=await parseChinaAddress(pasteText.value)
  if(!parsed)return
  if(parsed.recipientName)form.recipientName=parsed.recipientName
  if(parsed.phone){form.phoneNumber=parsed.phone;form.phoneDial='+86'}
  if(parsed.province){form.province=parsed.province;form.city=parsed.city;form.district=parsed.district;form.regionCodes=parsed.regionCodes}
  if(parsed.addressLine1)form.addressLine1=parsed.addressLine1
  pasteText.value='';validateOne('region')
}
function close(){emit('update:visible',false)}
function onKeydown(event){
  if(event.key==='Escape')close()
  if(event.key==='Tab'&&!panelVisible.value){
    const focusable=[...modal.value.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    const first=focusable[0],last=focusable.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
}
async function openRegionPanel(){regions.value=await loadChinaDivisions();panelVisible.value=true}

watch(()=>props.visible,async shown=>{
  if(!shown)return
  const a=props.address||{}
  const code=a.country_code||inferDefaultCountry();const config=getCountryConfig(code)
  Object.assign(form,{countryCode:code,recipientName:a.recipient_name||a.receiver_name||'',phone:a.phone_e164||a.receiver_phone||'',phoneDial:config.dial,phoneNumber:'',addressLine1:a.address_line1||a.detail_address||'',addressLine2:a.address_line2||'',city:a.city||'',stateCode:a.state_code||a.province||'',postalCode:a.postal_code||'',province:a.province||'',district:a.district||'',regionCodes:typeof a.region_codes==='string'?JSON.parse(a.region_codes||'{}'):a.region_codes||{},label:a.label||'',customLabel:a.label||'',deliveryInstructions:a.delivery_instructions||'',isDefault:!!a.is_default})
  const number=parsePhoneNumberFromString(form.phone,code)
  if(number){form.phoneDial=`+${number.countryCallingCode}`;form.phoneNumber=number.nationalNumber}
  else {form.phoneDial=config.dial;form.phoneNumber=form.phone.replace(/\D/g,'')}
  Object.keys(errors).forEach(key=>delete errors[key]);Object.keys(touched).forEach(key=>delete touched[key]);
  await nextTick();firstInput.value?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="address-overlay" @click.self="close" @keydown="onKeydown">
      <section ref="modal" class="address-dialog" role="dialog" aria-modal="true" :aria-label="isEdit?'编辑地址':'添加新地址'" tabindex="-1">
        <header class="address-dialog__head"><h2>{{ isEdit?(isEnglish?'Edit address':'编辑地址'):(isEnglish?'Add address':'添加新地址') }}</h2><button type="button" :aria-label="isEnglish?'Close':'关闭'" @click="close">×</button></header>
        <form class="address-dialog__body" @submit.prevent="submit">
          <label class="address-field address-field--full"><span>{{ isEnglish?'Country / region':'国家/地区' }} <b>*</b></span><select ref="firstInput" v-model="form.countryCode" autocomplete="shipping country" @change="changeCountry"><option v-for="country in ADDRESS_COUNTRIES" :key="country.code" :value="country.code">{{ countryLabel(country) }}</option></select></label>
          <div v-if="cnRegion" class="paste-address"><label for="paste-address">{{ isEnglish?'Paste an address to fill fields':'粘贴地址，自动识别' }}</label><div><input id="paste-address" v-model="pasteText" :placeholder="isEnglish?'Name, phone, province, city, district, street':'张三 13800138000 广东省深圳市南山区科技南路 8 号'" @paste="event=>setTimeout(pasteAddress,0)"/><button type="button" @click="pasteAddress">{{ isEnglish?'Parse':'识别' }}</button></div></div>
          <template v-for="item in activeConfig.fields" :key="item.key">
            <label v-if="item.key==='recipient_name'" class="address-field address-field--full" :data-field="item.key"><span>{{ labelFor(item) }} <b v-if="item.required">*</b></span><input v-model="form.recipientName" :maxlength="item.max" :autocomplete="item.autocomplete" :placeholder="activeConfig.nameOrder==='family-first'?'姓在前':' '" :aria-describedby="fieldError(item.key)?`error-${item.key}`:undefined" :aria-invalid="Boolean(fieldError(item.key))" @blur="blurField(item.key)"/><small v-if="touched[item.key]&&fieldError(item.key)" :id="`error-${item.key}`" class="address-error">{{ fieldError(item.key) }}</small></label>
            <div v-else-if="item.key==='phone'" class="address-field" :class="{ 'address-field--full':cnRegion }" data-field="phone"><span>{{ labelFor(item) }} <b>*</b></span><div class="phone-input"><select v-model="form.phoneDial" aria-label="电话区号"><option :value="activeConfig.dial">{{ activeConfig.dial }}</option><option v-for="country in ADDRESS_COUNTRIES" :key="country.code" :value="`+${country.dial.replace('+','')}`">{{ countryLabel(country) }} +{{ country.dial.replace('+','') }}</option></select><input v-model="form.phoneNumber" type="tel" autocomplete="shipping tel" :aria-describedby="fieldError('phone')?'error-phone':undefined" :aria-invalid="Boolean(fieldError('phone'))" @blur="blurField('phone')"/></div><small v-if="touched.phone&&fieldError('phone')" id="error-phone" class="address-error">{{ fieldError('phone') }}</small></div>
            <div v-else-if="item.key==='region'" class="address-field address-field--full" data-field="region"><span>{{ labelFor(item) }} <b>*</b></span><button v-if="!manualRegion" type="button" class="region-trigger" aria-haspopup="dialog" :aria-describedby="regionError?'error-region':undefined" @click="openRegionPanel">{{ regionSummary||(isEnglish?'Choose province and city':'请选择省 / 市 / 区县') }}</button><div v-else class="manual-region"><input v-model="form.province" :aria-label="isEnglish?'Province / region':'省 / 直辖市'" :placeholder="isEnglish?'Province / region':'省 / 直辖市'"/><input v-model="form.city" :aria-label="isEnglish?'City':'市'" :placeholder="isEnglish?'City':'市'"/><input v-model="form.district" :aria-label="isEnglish?'District (optional)':'区 / 县（可选）'" :placeholder="isEnglish?'District (optional)':'区 / 县（可选）'"/></div><button type="button" class="region-manual-toggle" @click="toggleManualRegion">{{ manualRegion?(isEnglish?'Choose a region':'选择行政区'):(isEnglish?'Enter region manually':'手动输入地区（支持拼音/英文）') }}</button><small v-if="touched.region&&regionError" id="error-region" class="address-error">{{ regionError }}</small></div>
            <label v-else-if="item.key==='label'" class="address-field"><span>{{ labelFor(item) }}</span><div class="address-chips"><button v-for="tag in ['家','公司','学校']" :key="tag" type="button" :class="{active:form.label===tag}" @click="form.label=tag">{{ tag }}</button><button type="button" :class="{active:form.label==='custom'}" @click="form.label='custom'">自定义</button><input v-if="form.label==='custom'" v-model="form.customLabel" maxlength="10" aria-label="自定义标签"/></div></label>
            <label v-else class="address-field" :class="{ 'address-field--full':['address_line1','address_line2','detail_address'].includes(item.key) }" :data-field="item.key"><span>{{ labelFor(item) }} <b v-if="item.required">*</b></span><select v-if="item.options" v-model="form[item.key==='state_code'?'stateCode':item.key]" :aria-describedby="fieldError(item.key)?`error-${item.key}`:undefined" :aria-invalid="Boolean(fieldError(item.key))" @blur="blurField(item.key)"><option value="">{{ isEnglish?'Select':'请选择' }}</option><option v-for="option in item.options" :key="option.code" :value="option.code">{{ option.name }}</option></select><input v-else v-model="form[item.key==='detail_address'?'addressLine1':item.key==='address_line1'?'addressLine1':item.key==='address_line2'?'addressLine2':item.key==='postal_code'?'postalCode':item.key==='state_code'?'stateCode':item.key]" :maxlength="item.max||100" :autocomplete="item.autocomplete" :inputmode="item.key==='postal_code'?'text':undefined" :placeholder="item.example||''" :aria-describedby="fieldError(item.key)?`error-${item.key}`:undefined" :aria-invalid="Boolean(fieldError(item.key))" @blur="blurField(item.key)"/><small v-if="touched[item.key]&&fieldError(item.key)" :id="`error-${item.key}`" class="address-error">{{ fieldError(item.key) }}</small></label>
          </template>
          <label class="address-field address-field--full"><span>{{ isEnglish?'Delivery instructions':'配送备注' }}</span><textarea v-model="form.deliveryInstructions" maxlength="200" rows="2" placeholder="如门禁码、送货时间"/></label>
          <label class="address-default address-field--full"><input v-model="form.isDefault" type="checkbox"/>{{ isEnglish?'Set as default address':'设为默认收货地址' }}</label>
          <p v-if="errors.form" class="address-error" role="alert">{{ errors.form }}</p>
        </form>
        <footer class="address-dialog__foot"><button type="button" class="address-secondary" @click="close">{{ isEnglish?'Cancel':'取消' }}</button><button type="button" class="address-primary" :disabled="store.saving" @click="submit">{{ store.saving?'保存中…':'保存地址' }}</button></footer>
        <div v-if="panelVisible" class="region-overlay" @click.self="panelVisible=false"><section class="region-panel" role="dialog" aria-modal="true" :aria-label="isEnglish?'Choose region':'选择所在地区'"><header><strong>{{ isEnglish?'Choose region':'选择所在地区' }}</strong><button type="button" @click="panelVisible=false">×</button></header><div class="region-selects"><label>{{ isEnglish?'Province / region':'省/直辖市' }}<select :value="form.regionCodes.province||''" @change="selectProvince($event.target.value)"><option value="">{{ isEnglish?'Select':'请选择' }}</option><option v-for="item in provinceChoices" :key="item.code" :value="normalizeDivisionCode(item.code,'province')">{{ item.name }}</option></select></label><label>{{ isEnglish?'City':'市' }}<select :value="form.regionCodes.city||''" :disabled="!cityChoices.length" @change="selectCity($event.target.value)"><option value="">{{ isEnglish?'Select':'请选择' }}</option><option v-for="item in cityChoices" :key="item.code" :value="normalizeDivisionCode(item.code,'city')">{{ item.name }}</option></select></label><label>{{ isEnglish?'District / county':'区/县' }}<select :value="form.regionCodes.district||''" :disabled="!districtChoices.length" @change="selectDistrict($event.target.value)"><option value="">{{ districtChoices.length?(isEnglish?'Select':'请选择'):(isEnglish?'No district required':'该城市无需选择区县') }}</option><option v-for="item in districtChoices" :key="item.code" :value="item.code">{{ item.name }}</option></select></label></div><footer><button type="button" class="address-primary" @click="panelVisible=false">{{ isEnglish?'Done':'完成选择' }}</button></footer></section></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.address-overlay,.region-overlay { position:fixed; inset:0; z-index:3000; display:grid; place-items:center; padding:20px; background:rgba(15,18,22,.44); font-family:system-ui,-apple-system,"Segoe UI",sans-serif }
.address-dialog { --address-bg:#fff; --address-ink:#181a1c; --address-line:#d9dde1; width:min(100%,500px); max-height:min(90vh,800px); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--address-line); border-radius:16px; background:var(--address-bg); color:var(--address-ink); box-shadow:0 20px 60px #0003 }
.address-dialog__head,.address-dialog__foot { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--address-line) }
.address-dialog__head h2 { margin:0; font-size:19px }
.address-dialog__head button,.region-panel header button { border:0; background:none; color:inherit; font-size:24px; cursor:pointer }
.address-dialog__body { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; overflow:auto; padding:18px 20px }
.address-field--full { grid-column:1/-1 }
.address-field { display:grid; gap:6px; font-size:13px; font-weight:600 }
.address-field b { color:#d34242 }
.address-field input,.address-field select,.address-field textarea,.region-trigger,.phone-input { width:100%; min-width:0; height:42px; padding:0 11px; border:1px solid var(--address-line); border-radius:8px; background:var(--address-bg); color:var(--address-ink); font:inherit; font-weight:400 }
.address-field textarea { height:auto; min-height:70px; padding:9px; resize:vertical }
.address-field input:focus,.address-field select:focus,.address-field textarea:focus,.region-trigger:focus { outline:0; border-color:#777; box-shadow:0 0 0 3px #84909a22 }
.phone-input { display:flex; overflow:hidden; padding:0 }
.phone-input select { width:110px; flex:none; border:0; border-right:1px solid var(--address-line); border-radius:0 }
.phone-input input { border:0 }
.address-error { color:#c53030; font-size:12px; font-weight:400 }
.region-trigger { text-align:left; cursor:pointer }
.address-dialog__foot { justify-content:flex-end; gap:10px; border-top:1px solid var(--address-line); border-bottom:0 }
.address-primary,.address-secondary,.paste-address button { height:40px; padding:0 16px; border-radius:8px; font:inherit; cursor:pointer }
.address-primary { border:1px solid #17191b; background:#17191b; color:#fff }
.address-primary:disabled { opacity:.6 }
.address-secondary { border:1px solid var(--address-line); background:transparent; color:inherit }
.address-default { display:flex; align-items:center; gap:9px; font-size:13px }
.address-chips { display:flex; flex-wrap:wrap; gap:7px }
.address-chips button { padding:6px 12px; border:1px solid var(--address-line); border-radius:99px; background:transparent; color:inherit; cursor:pointer }
.address-chips button.active { border-color:#272a2d; background:#272a2d; color:#fff }
.address-chips input { width:100px }
.paste-address { display:grid; gap:7px; padding:11px; border-radius:9px; background:#f5f6f7; font-size:13px }
.paste-address div { display:flex; gap:7px }
.paste-address input { height:38px; min-width:0; flex:1; padding:0 9px; border:1px solid var(--address-line); border-radius:7px }
.paste-address button { height:38px; border:0; background:#242628; color:#fff }
.region-manual { display:grid; gap:6px }
.region-manual-toggle { justify-self:start; padding:0; border:0; background:none; color:#58616a; font:inherit; font-size:12px; text-decoration:underline; cursor:pointer }
.region-overlay { z-index:1 }
.region-panel { width:min(100%,450px); padding:17px; border-radius:14px; background:#fff; color:#181a1c; box-shadow:0 16px 44px #0003 }
.region-panel header,.region-panel footer { display:flex; align-items:center; justify-content:space-between }
.region-selects { display:grid; gap:12px; margin:16px 0 }
.region-selects label { display:grid; gap:5px; font-size:13px }
.region-selects select { height:42px; padding:0 10px; border:1px solid #d9dde1; border-radius:7px; background:#fff; color:#161718 }
.region-panel footer { justify-content:flex-end }
@media(prefers-color-scheme:dark) { .address-dialog { --address-bg:#1c1e20; --address-ink:#f2f3f4; --address-line:#42464a }.address-primary { border-color:#f1f2f3; background:#f1f2f3; color:#17191b }.address-chips button.active { background:#eceeef; color:#17191b }.paste-address { background:#272a2d }.region-panel { background:#1c1e20; color:#f2f3f4 }.region-selects select { border-color:#42464a; background:#1c1e20; color:#f2f3f4 }.region-manual-toggle { color:#bec4c9 } }
@media(max-width:600px) { .address-overlay { align-items:end; padding:0 }.address-dialog { width:100%; max-height:94vh; max-height:94dvh; border-radius:16px 16px 0 0 }.address-dialog__body { grid-template-columns:1fr; padding-bottom: 8px }.address-field--full { grid-column:1 }.region-overlay { align-items:end; padding:0 }.region-panel { width:100%; padding-bottom:max(18px,env(safe-area-inset-bottom)); border-radius:16px 16px 0 0 }.address-dialog__foot { padding-bottom:max(16px,env(safe-area-inset-bottom)) } }
/* 手机端：字段字号 16px（iOS 聚焦不放大）、输入与按钮统一 44px 触控高度 */
@media(max-width:600px) {
  .address-field input, .address-field select, .address-field textarea, .region-trigger, .phone-input { height:44px; font-size:16px }
  .address-field textarea { height:auto; min-height:76px }
  .address-dialog__head button { width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0 }
  .address-primary, .address-secondary { height:44px }
  .paste-address input, .paste-address button { height:44px; font-size:16px }
  .address-chips button { min-height:44px; padding:8px 14px }
  .address-chips input { height:44px; font-size:16px }
  .region-selects select { height:44px; font-size:16px }
  .region-manual input { height:44px; font-size:16px }
  .region-manual-toggle { min-height:44px }
  .region-panel header button { width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0 }
}
</style>
