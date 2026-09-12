<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { resolve } from '../utils/image'
import { useCustomerStore } from '../stores/customer'
import { useLanguageStore } from '../stores/language'
import { useUserStore } from '../stores/user'

const router = useRouter()
const customer = useCustomerStore()
const language = useLanguageStore()
// 未登录时复用前台登录弹窗（与 Header 上的入口一致），不再另做一套登录页
const user = useUserStore()

const form = reactive({ nickname: '', email: '' })
const password = reactive({ current: '', next: '', confirm: '' })
const notes = reactive({ profile: null, password: null })
const saving = reactive({ profile: false, password: false, avatar: false })

const avatarPreview = computed(() => resolve(customer.avatarUrl))

// 与后端 server/utils/customer.js 的规则保持一致
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

const syncForm = () => {
  form.nickname = customer.profile?.nickname || ''
  form.email = customer.profile?.email || ''
}

const setNote = (key, type, text) => { notes[key] = { type, text } }

onMounted(async () => {
  // 顾客登录态由页面内部判断：未登录回首页并唤起登录弹窗
  if (!customer.isLoggedIn) {
    user.openLogin()
    await router.replace('/')
    return
  }

  syncForm()
  // 本地缓存的资料可能已过期（例如在别处改过头像），进页面时拉一次最新数据
  const result = await customer.fetchProfile()
  if (result.success) return syncForm()
  if (customer.isLoggedIn) setNote('profile', 'error', result.message)
  else {
    user.openLogin()
    await router.replace('/')
  }
})

const saveProfile = async () => {
  const nickname = form.nickname.trim()
  const email = form.email.trim()
  if (nickname.length > 50) return setNote('profile', 'error', language.t('nicknameTooLong'))
  if (email && !EMAIL_PATTERN.test(email)) return setNote('profile', 'error', language.t('emailInvalid'))

  saving.profile = true
  const result = await customer.updateProfile({ nickname, email })
  saving.profile = false

  if (!result.success) return setNote('profile', 'error', result.message)
  syncForm()
  setNote('profile', 'success', language.t('profileSaved'))
}

const changePassword = async () => {
  if (!password.current) return setNote('password', 'error', language.t('currentPasswordRequired'))
  if (password.next.length < 6) return setNote('password', 'error', language.t('passwordTooShort'))
  if (password.next.length > 128) return setNote('password', 'error', language.t('passwordTooLong'))
  if (password.next !== password.confirm) return setNote('password', 'error', language.t('passwordMismatch'))
  if (password.next === password.current) return setNote('password', 'error', language.t('passwordSameAsCurrent'))

  saving.password = true
  const result = await customer.changePassword(password.current, password.next)
  saving.password = false

  if (!result.success) return setNote('password', 'error', result.message)
  Object.assign(password, { current: '', next: '', confirm: '' })
  setNote('password', 'success', language.t('passwordUpdated'))
}

// 直接上传选中的图片：类型与大小由后端 server/utils/customer.js 再校验一次
const onAvatarPick = async event => {
  const file = event.target.files?.[0]
  // 清空 value，否则连续选择同一张图不会再触发 change
  event.target.value = ''
  if (!file) return
  if (file.size > MAX_AVATAR_SIZE) return setNote('profile', 'error', language.t('avatarTooLarge'))

  saving.avatar = true
  const result = await customer.updateProfile({ avatar: file })
  saving.avatar = false

  if (!result.success) return setNote('profile', 'error', result.message)
  setNote('profile', 'success', language.t('avatarUpdated'))
}
</script>
<template>
  <section v-if="customer.isLoggedIn" class="container page account-page">
    <div class="page-intro">
      <span class="eyebrow">{{ language.t('account') }}</span>
      <h1>{{ language.t('profile') }}</h1>
      <p>{{ language.t('profileText') }}</p>
    </div>

    <div class="account-layout">
      <article class="account-card account-identity">
        <img class="account-avatar-lg" :src="avatarPreview" :alt="customer.displayName" />
        <strong class="account-identity-name">{{ customer.displayName }}</strong>
        <span class="account-identity-phone">{{ language.t('phone') }} {{ customer.profile?.phone }}</span>
        <label class="button account-upload">{{ saving.avatar ? language.t('submitting') : language.t('changeAvatar') }}<input type="file" accept=".jpg,.jpeg,.png,.bmp,.webp" :disabled="saving.avatar" @change="onAvatarPick" /></label>
        <small class="account-hint">{{ language.t('avatarHint') }}</small>
      </article>

      <article class="account-card">
        <h2>{{ language.t('profileInfo') }}</h2>
        <form class="account-form" @submit.prevent="saveProfile">
          <label>{{ language.t('nickname') }}<input v-model="form.nickname" type="text" maxlength="50" autocomplete="nickname" :placeholder="language.t('nicknamePlaceholder')" /></label>
          <label>{{ language.t('email') }}<input v-model="form.email" type="email" autocomplete="email" :placeholder="language.t('emailPlaceholder')" /></label>
          <p v-if="notes.profile" class="account-note" :class="notes.profile.type" role="status">{{ notes.profile.text }}</p>
          <button class="button primary" type="submit" :disabled="saving.profile">{{ saving.profile ? language.t('submitting') : language.t('saveChanges') }}</button>
        </form>
      </article>

      <article class="account-card">
        <h2>{{ language.t('security') }}</h2>
        <form class="account-form" @submit.prevent="changePassword">
          <label>{{ language.t('currentPassword') }}<input v-model="password.current" type="password" maxlength="128" autocomplete="current-password" /></label>
          <label>{{ language.t('newPassword') }}<input v-model="password.next" type="password" maxlength="128" autocomplete="new-password" :placeholder="language.t('passwordHint')" /></label>
          <label>{{ language.t('confirmPassword') }}<input v-model="password.confirm" type="password" maxlength="128" autocomplete="new-password" /></label>
          <p v-if="notes.password" class="account-note" :class="notes.password.type" role="status">{{ notes.password.text }}</p>
          <button class="button primary" type="submit" :disabled="saving.password">{{ saving.password ? language.t('submitting') : language.t('saveChanges') }}</button>
        </form>
      </article>

      <!-- 收货地址是列表 + 弹窗的重内容模块，单独一页承载（/account/addresses） -->
      <RouterLink class="account-card account-address" to="/account/addresses">
        <h2>{{ language.t('addressList') }}</h2>
        <p>{{ language.t('addressEntryText') }}</p>
        <span class="button">{{ language.t('manageAddress') }}</span>
      </RouterLink>
    </div>
  </section>
</template>
