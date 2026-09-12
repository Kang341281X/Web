<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useAddressStore } from '../../stores/address'
import { useLanguageStore } from '../../stores/language'

const props = defineProps({
  visible: Boolean,
  // 传入地址对象表示编辑，null 表示新增
  address: { type: Object, default: null },
})
const emit = defineEmits(['update:visible', 'saved'])

const addressStore = useAddressStore()
const language = useLanguageStore()

const nameInput = ref(null)
const error = ref('')
const form = reactive({
  receiverName: '',
  receiverPhone: '',
  province: '',
  city: '',
  district: '',
  detailAddress: '',
  isDefault: false,
})

// 与后端 server/routes/customerAddress.js 的校验规则保持一致
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const MAX_DETAIL_LENGTH = 200

const isEdit = computed(() => !!props.address?.id)
// 省市区均为选填，长度靠 maxlength 限制，这里不需要额外文案
const isDefaultLocked = computed(() => isEdit.value && !!props.address?.is_default)

watch(() => props.visible, async visible => {
  if (!visible) return
  // 每次打开都按当前地址重置，避免残留上一次的输入与报错
  const item = props.address || {}
  Object.assign(form, {
    receiverName: item.receiver_name || '',
    receiverPhone: item.receiver_phone || '',
    province: item.province || '',
    city: item.city || '',
    district: item.district || '',
    detailAddress: item.detail_address || '',
    isDefault: !!item.is_default,
  })
  error.value = ''
  await nextTick()
  nameInput.value?.focus()
})

const close = () => emit('update:visible', false)

// 先在本地拦掉明显不合法的输入，减少一次无意义的请求
const validate = () => {
  if (!form.receiverName.trim()) return language.t('receiverNameRequired')
  if (!PHONE_PATTERN.test(form.receiverPhone.trim())) return language.t('phoneInvalid')
  if (!form.detailAddress.trim()) return language.t('detailAddressRequired')
  if (form.detailAddress.trim().length > MAX_DETAIL_LENGTH) return language.t('detailAddressTooLong')
  return ''
}

const submit = async () => {
  error.value = validate()
  if (error.value) return

  const result = isEdit.value
    ? await addressStore.update(props.address.id, form)
    : await addressStore.create(form)

  if (!result.success) {
    error.value = result.message
    return
  }
  emit('saved', result.data)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop" @click.self="close">
      <section class="address-modal" role="dialog" aria-modal="true" :aria-label="isEdit ? language.t('editAddress') : language.t('addAddress')">
        <button type="button" class="icon-button modal-close" :aria-label="language.t('close')" @click="close">×</button>
        <span class="eyebrow">CRAFTORA</span>
        <h2>{{ isEdit ? language.t('editAddress') : language.t('addAddress') }}</h2>
        <form @submit.prevent="submit">
          <label>{{ language.t('receiverName') }}<input ref="nameInput" v-model="form.receiverName" type="text" maxlength="50" autocomplete="name" /></label>
          <label>{{ language.t('receiverPhone') }}<input v-model="form.receiverPhone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" /></label>
          <div class="address-fields-3">
            <label>{{ language.t('province') }}<input v-model="form.province" type="text" maxlength="50" :placeholder="language.t('optional')" /></label>
            <label>{{ language.t('city') }}<input v-model="form.city" type="text" maxlength="50" :placeholder="language.t('optional')" /></label>
            <label>{{ language.t('district') }}<input v-model="form.district" type="text" maxlength="50" :placeholder="language.t('optional')" /></label>
          </div>
          <label>{{ language.t('detailAddress') }}<input v-model="form.detailAddress" type="text" maxlength="200" :placeholder="language.t('detailAddressPlaceholder')" /></label>
          <label class="address-check"><input v-model="form.isDefault" type="checkbox" :disabled="isDefaultLocked" />{{ language.t('setAsDefault') }}</label>
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <div class="address-modal-actions">
            <button type="button" class="button" @click="close">{{ language.t('cancel') }}</button>
            <button type="submit" class="button primary" :disabled="addressStore.saving">{{ addressStore.saving ? language.t('submitting') : language.t('saveChanges') }}</button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
