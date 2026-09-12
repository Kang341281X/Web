<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useCustomerStore } from '../../stores/customer'
import { useLanguageStore } from '../../stores/language'
import { useUserStore } from '../../stores/user'
import { fetchCustomerCaptcha } from '../../services/captcha'

const emit = defineEmits(['logged-in'])

const customer = useCustomerStore()
const language = useLanguageStore()
// 只复用 user store 的弹窗开关，前台登录态一律以 customer store 为准
const user = useUserStore()

const tab = ref('login')
const error = ref('')
const usernameInput = ref(null)
const form = reactive({ username: '', phone: '', password: '', nickname: '' })
// 图形验证码：id 由后端签发（一次性），image 是 data URI，直接交给 <img src>
const captcha = reactive({ id: '', image: '', text: '', loading: false })
const isRegister = computed(() => tab.value === 'register')

// 与后端 server/utils/customer.js 的规则保持一致
// 用户名：4-20 位字母 / 数字 / 下划线；手机号：中国大陆 11 位（仅注册时填写，不用于登录）
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/
const PHONE_PATTERN = /^1[3-9]\d{9}$/

// 换一张验证码。失败时把 image 置空，界面会退化成「点击重试」，而不是留着一张已作废的旧图让人白填。
const refreshCaptcha = async () => {
  captcha.loading = true
  captcha.text = ''
  try {
    const data = await fetchCustomerCaptcha()
    captcha.id = data.captchaId
    captcha.image = data.image
  } catch {
    captcha.id = ''
    captcha.image = ''
  } finally {
    captcha.loading = false
  }
}

// 每次打开都重置表单并取一张新验证码，避免残留上一次的输入与报错
watch(() => user.isLoginOpen, async visible => {
  if (!visible) return
  tab.value = 'login'
  Object.assign(form, { username: '', phone: '', password: '', nickname: '' })
  error.value = ''
  refreshCaptcha()
  await nextTick()
  usernameInput.value?.focus()
})

const switchTab = value => {
  tab.value = value
  error.value = ''
}

// 先在本地拦掉明显不合法的输入，减少一次无意义的请求
const validate = () => {
  if (!USERNAME_PATTERN.test(form.username.trim())) return language.t('usernameInvalid')
  // 手机号只在注册时填写：它是账号的内部唯一标识，不再作为登录账号
  if (isRegister.value && !PHONE_PATTERN.test(form.phone.trim())) return language.t('phoneInvalid')
  if (form.password.length < 6) return language.t('passwordTooShort')
  if (isRegister.value && form.nickname.trim().length > 50) return language.t('nicknameTooLong')
  // 注册接口本身不校验验证码，但注册成功后紧接着会调用登录接口，那条链路需要它；
  // 所以两个 tab 都要求填写，避免用户填完注册信息才被验证码拦下。
  if (!captcha.text.trim()) return language.t('captchaRequired')
  return ''
}

const submit = async () => {
  error.value = validate()
  if (error.value) return

  const username = form.username.trim()
  const password = form.password

  if (isRegister.value) {
    const registered = await customer.register({
      username,
      phone: form.phone.trim(),
      password,
      nickname: form.nickname.trim(),
    })
    if (!registered.success) {
      // 注册接口不校验验证码，此时它还没被消耗，保留用户已填的字符，不让人白输一遍
      error.value = registered.message
      return
    }
  }

  // 注册接口不签发 token，注册成功后紧接着登录一次，让用户注册完即是登录态
  const result = await customer.login(username, password, {
    captchaId: captcha.id,
    captchaText: captcha.text.trim(),
  })
  if (!result.success) {
    error.value = result.message
    // 验证码是一次性的：这次请求不管因为什么失败，后端都已经把它作废了（密码错也算），
    // 所以必须换一张新的让用户重填——否则用户改完密码再提交，只会得到「验证码错误或已过期」。
    refreshCaptcha()
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
      <label>{{ language.t('username') }}<input ref="usernameInput" v-model="form.username" type="text" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" :placeholder="language.t('usernamePlaceholder')" /><small v-if="isRegister" class="auth-hint">{{ language.t('usernameHint') }}</small></label>
      <label v-if="isRegister">{{ language.t('phone') }}<input v-model="form.phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" :placeholder="language.t('phonePlaceholder')" /></label>
      <label>{{ language.t('password') }}<input v-model="form.password" type="password" maxlength="128" :autocomplete="isRegister ? 'new-password' : 'current-password'" :placeholder="language.t('passwordPlaceholder')" /></label>
      <label v-if="isRegister">{{ language.t('nickname') }}<input v-model="form.nickname" type="text" maxlength="50" autocomplete="nickname" :placeholder="language.t('nicknamePlaceholder')" /></label>
      <label>{{ language.t('captcha') }}<span class="auth-captcha"><input v-model="captcha.text" type="text" maxlength="8" autocomplete="off" autocapitalize="off" spellcheck="false" :placeholder="language.t('captchaPlaceholder')" /><img v-if="captcha.image" class="auth-captcha-image" :src="captcha.image" :alt="language.t('captcha')" :title="language.t('captchaRefresh')" @click="refreshCaptcha" /><button v-else type="button" class="auth-captcha-image auth-captcha-retry" :disabled="captcha.loading" @click="refreshCaptcha">{{ captcha.loading ? language.t('loading') : language.t('captchaLoadFailed') }}</button></span></label>
      <div class="auth-captcha-actions"><button type="button" :disabled="captcha.loading" @click="refreshCaptcha">{{ language.t('captchaRefresh') }}</button></div>
      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button class="button primary wide" type="submit" :disabled="customer.loading">{{ customer.loading ? language.t('submitting') : (isRegister ? language.t('register') : language.t('login')) }}</button>
    </form>
  </section></div></Teleport>
</template>

<style scoped>
.auth-hint { display: block; margin-top: 4px; font-size: 12px; color: #909399 }
</style>
