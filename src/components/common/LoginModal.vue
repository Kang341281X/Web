<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useCustomerStore } from '../../stores/customer'
import { useLanguageStore } from '../../stores/language'
import { useUserStore } from '../../stores/user'

const emit = defineEmits(['logged-in'])

const customer = useCustomerStore()
const language = useLanguageStore()
// 只复用 user store 的弹窗开关，前台登录态一律以 customer store 为准
const user = useUserStore()

const tab = ref('login')
const error = ref('')
const phoneInput = ref(null)
const form = reactive({ phone: '', password: '', nickname: '' })
const isRegister = computed(() => tab.value === 'register')

// 中国大陆手机号，与后端 server/utils/customer.js 的规则保持一致
const PHONE_PATTERN = /^1[3-9]\d{9}$/

// 每次打开都重置，避免残留上一次的输入与报错
watch(() => user.isLoginOpen, async visible => {
  if (!visible) return
  tab.value = 'login'
  Object.assign(form, { phone: '', password: '', nickname: '' })
  error.value = ''
  await nextTick()
  phoneInput.value?.focus()
})

const switchTab = value => {
  tab.value = value
  error.value = ''
}

// 先在本地拦掉明显不合法的输入，减少一次无意义的请求
const validate = () => {
  if (!PHONE_PATTERN.test(form.phone.trim())) return language.t('phoneInvalid')
  if (form.password.length < 6) return language.t('passwordTooShort')
  if (isRegister.value && form.nickname.trim().length > 50) return language.t('nicknameTooLong')
  return ''
}

const submit = async () => {
  error.value = validate()
  if (error.value) return

  const phone = form.phone.trim()
  const password = form.password

  if (isRegister.value) {
    const registered = await customer.register(phone, password, form.nickname.trim())
    if (!registered.success) {
      error.value = registered.message
      return
    }
  }

  // 注册接口不签发 token，注册成功后紧接着登录一次，让用户注册完即是登录态
  const result = await customer.login(phone, password)
  if (!result.success) {
    error.value = result.message
    return
  }

  user.closeLogin()
  // 游客购物车/收藏的合并已在 customer.login() 内完成（见 stores/customer.js）
  emit('logged-in', result.user)
}
</script>
<template>
  <Teleport to="body"><div v-if="user.isLoginOpen" class="modal-backdrop" @click.self="user.closeLogin()"><section class="login-modal" role="dialog" aria-modal="true" :aria-label="language.t('account')"><button class="icon-button modal-close" :aria-label="language.t('close')" @click="user.closeLogin()">×</button><span class="eyebrow">CRAFTORA</span>
    <div class="auth-tabs" role="tablist">
      <button type="button" role="tab" :class="{ active: tab === 'login' }" :aria-selected="tab === 'login'" @click="switchTab('login')">{{ language.t('login') }}</button>
      <button type="button" role="tab" :class="{ active: tab === 'register' }" :aria-selected="tab === 'register'" @click="switchTab('register')">{{ language.t('register') }}</button>
    </div>
    <h2>{{ isRegister ? language.t('registerTitle') : language.t('loginTitle') }}</h2>
    <p>{{ isRegister ? language.t('registerText') : language.t('loginText') }}</p>
    <form class="auth-form" @submit.prevent="submit">
      <label>{{ language.t('phone') }}<input ref="phoneInput" v-model="form.phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="username" :placeholder="language.t('phonePlaceholder')" /></label>
      <label>{{ language.t('password') }}<input v-model="form.password" type="password" maxlength="128" :autocomplete="isRegister ? 'new-password' : 'current-password'" :placeholder="language.t('passwordPlaceholder')" /></label>
      <label v-if="isRegister">{{ language.t('nickname') }}<input v-model="form.nickname" type="text" maxlength="50" autocomplete="nickname" :placeholder="language.t('nicknamePlaceholder')" /></label>
      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button class="button primary wide" type="submit" :disabled="customer.loading">{{ customer.loading ? language.t('submitting') : (isRegister ? language.t('register') : language.t('login')) }}</button>
    </form>
  </section></div></Teleport>
</template>
