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
// 通用错误（网络异常、后端未指明字段的失败）显示在表单底部；
// 能定位到具体字段的错误放进 fieldErrors，紧跟对应标签显示，避免用户在一堆输入框里找问题。
const error = ref('')
const fieldErrors = reactive({ username: '', phone: '', password: '', confirmPassword: '', email: '', captcha: '' })
const usernameInput = ref(null)
const form = reactive({ username: '', phone: '', password: '', confirmPassword: '', email: '' })
// 图形验证码：id 由后端签发（一次性），image 是 data URI，直接交给 <img src>
const captcha = reactive({ id: '', image: '', text: '', loading: false })
const isRegister = computed(() => tab.value === 'register')

// 与后端 server/utils/customer.js 的规则保持一致
// 用户名：4-20 位字母 / 数字 / 下划线；手机号：中国大陆 11 位（仅注册时填写，不用于登录）
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/
const PHONE_PATTERN = /^1[3-9]\d{9}$/
// 与后端 normalizeEmail 的 EMAIL_PATTERN 对齐；邮箱选填，为空时不校验
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

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
  Object.assign(form, { username: '', phone: '', password: '', confirmPassword: '', email: '' })
  error.value = ''
  refreshCaptcha()
  await nextTick()
  usernameInput.value?.focus()
})

const switchTab = value => {
  tab.value = value
  clearFieldErrors()
}

const clearFieldErrors = () => {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  error.value = ''
}

// 用户一开始改动输入就清掉旧提示：错误只针对上一次提交，不该一直粘在输入框旁
watch(form, clearFieldErrors, { deep: true })
watch(() => captcha.text, () => { fieldErrors.captcha = '' })

// 先在本地拦掉明显不合法的输入，减少一次无意义的请求；一次把所有问题都标出来
const validate = () => {
  clearFieldErrors()
  let valid = true
  if (!USERNAME_PATTERN.test(form.username.trim())) {
    fieldErrors.username = language.t('usernameInvalid')
    valid = false
  }
  // 手机号只在注册时填写：它是账号的内部唯一标识，不再作为登录账号
  if (isRegister.value && !PHONE_PATTERN.test(form.phone.trim())) {
    fieldErrors.phone = language.t('phoneInvalid')
    valid = false
  }
  if (form.password.length < 6) {
    fieldErrors.password = language.t('passwordTooShort')
    valid = false
  }
  if (isRegister.value) {
    // 确认密码必填：与密码不一致即报错（只在前端校验，不提交给后端）
    if (form.confirmPassword !== form.password) {
      fieldErrors.confirmPassword = language.t('registerPasswordMismatch')
      valid = false
    }
    // 邮箱选填：填了才校验格式，规则与后端 normalizeEmail 对齐
    const email = form.email.trim()
    if (email && !EMAIL_PATTERN.test(email)) {
      fieldErrors.email = language.t('emailInvalid')
      valid = false
    }
  }
  // 验证码只用于登录：注册不校验验证码（后端注册即登录、直接签发 token），
  // 注册页签下根本不显示验证码，也就不需要填写
  if (!isRegister.value && !captcha.text.trim()) {
    fieldErrors.captcha = language.t('captchaRequired')
    valid = false
  }
  return valid
}

const submit = async () => {
  if (!validate()) return

  const username = form.username.trim()
  const password = form.password

  // 注册：后端注册即登录（直接签发 token），全程不需要验证码
  if (isRegister.value) {
    // 邮箱选填：为空时不传该字段，由后端按「未填写」处理
    const email = form.email.trim()
    const registered = await customer.register({
      username,
      phone: form.phone.trim(),
      password,
      ...(email ? { email } : {}),
    })
    if (!registered.success) {
      // 后端能指明冲突字段（用户名 / 手机号已被占用）时就地提示，并按当前语言取文案；
      // 其余失败（网络异常等）无法归属到具体输入框，仍走底部通用提示
      const fieldMessages = { username: 'usernameTaken', phone: 'phoneTaken' }
      const messageKey = fieldMessages[registered.field]
      if (messageKey) fieldErrors[registered.field] = language.t(messageKey)
      else error.value = registered.message
      return
    }

    user.closeLogin()
    // 游客购物车/收藏的合并已在 customer.register() 内完成（见 stores/customer.js）
    emit('logged-in', registered.user)
    return
  }

  // 登录：必须携带验证码
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
  <Teleport to="body"><div v-if="user.isLoginOpen" class="modal-backdrop" @click.self="user.closeLogin()"><section class="login-modal" role="dialog" aria-modal="true" :aria-label="language.t('account')"><button class="icon-button modal-close" :aria-label="language.t('close')" @click="user.closeLogin()">×</button><span class="eyebrow">{{ language.t('brand.name') }}</span>
    <div class="auth-tabs" role="tablist">
      <button type="button" role="tab" :class="{ active: tab === 'login' }" :aria-selected="tab === 'login'" @click="switchTab('login')">{{ language.t('login') }}</button>
      <button type="button" role="tab" :class="{ active: tab === 'register' }" :aria-selected="tab === 'register'" @click="switchTab('register')">{{ language.t('register') }}</button>
    </div>
    <form class="auth-form" @submit.prevent="submit">
      <label>{{ language.t('username') }}<span v-if="fieldErrors.username" class="auth-field-error" role="alert">{{ fieldErrors.username }}</span><input ref="usernameInput" v-model="form.username" type="text" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" :class="{ invalid: fieldErrors.username }" :placeholder="language.t('usernamePlaceholder')" /><small v-if="isRegister" class="auth-hint">{{ language.t('usernameHint') }}</small></label>
      <label v-if="isRegister">{{ language.t('phone') }}<span v-if="fieldErrors.phone" class="auth-field-error" role="alert">{{ fieldErrors.phone }}</span><input v-model="form.phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" :class="{ invalid: fieldErrors.phone }" :placeholder="language.t('phonePlaceholder')" /></label>
      <label>{{ language.t('password') }}<span v-if="fieldErrors.password" class="auth-field-error" role="alert">{{ fieldErrors.password }}</span><input v-model="form.password" type="password" maxlength="128" :autocomplete="isRegister ? 'new-password' : 'current-password'" :class="{ invalid: fieldErrors.password }" :placeholder="language.t('passwordPlaceholder')" /></label>
      <label v-if="isRegister">{{ language.t('registerConfirmPassword') }}<span v-if="fieldErrors.confirmPassword" class="auth-field-error" role="alert">{{ fieldErrors.confirmPassword }}</span><input v-model="form.confirmPassword" type="password" maxlength="128" autocomplete="new-password" :class="{ invalid: fieldErrors.confirmPassword }" :placeholder="language.t('registerConfirmPasswordPlaceholder')" /></label>
      <label v-if="isRegister">{{ language.t('email') }}<span v-if="fieldErrors.email" class="auth-field-error" role="alert">{{ fieldErrors.email }}</span><input v-model="form.email" type="email" autocomplete="email" spellcheck="false" :class="{ invalid: fieldErrors.email }" :placeholder="language.t('registerEmailPlaceholder')" /></label>
      <label v-if="!isRegister">{{ language.t('captcha') }}<span v-if="fieldErrors.captcha" class="auth-field-error" role="alert">{{ fieldErrors.captcha }}</span><span class="auth-captcha"><input v-model="captcha.text" type="text" maxlength="8" autocomplete="off" autocapitalize="off" spellcheck="false" :class="{ invalid: fieldErrors.captcha }" :placeholder="language.t('captchaPlaceholder')" /><img v-if="captcha.image" class="auth-captcha-image" :src="captcha.image" :alt="language.t('captcha')" :title="language.t('captchaRefresh')" @click="refreshCaptcha" /><button v-else type="button" class="auth-captcha-image auth-captcha-retry" :disabled="captcha.loading" @click="refreshCaptcha">{{ captcha.loading ? language.t('loading') : language.t('captchaLoadFailed') }}</button></span></label>
      <div v-if="!isRegister" class="auth-captcha-actions"><button type="button" :disabled="captcha.loading" @click="refreshCaptcha">{{ language.t('captchaRefresh') }}</button></div>
      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button class="button primary wide" type="submit" :disabled="customer.loading">{{ customer.loading ? language.t('submitting') : (isRegister ? language.t('register') : language.t('login')) }}</button>
    </form>
  </section></div></Teleport>
</template>

<style scoped>
.auth-hint { display: block; margin-top: 4px; font-size: 12px; color: #909399 }
/* 字段级错误：紧跟标签文字显示，不占额外一行，也不把问题堆到表单底部 */
.auth-field-error { margin-left: 6px; font-size: 12px; font-weight: 400; color: #b3261e; line-height: 1.5 }
.auth-form input.invalid { border-color: #b3261e }
.auth-form input.invalid:focus { outline-color: #b3261e }
</style>
