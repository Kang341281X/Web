<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AddressManager from '../components/address/AddressManager.vue'
import { useCustomerStore } from '../stores/customer'
import { useLanguageStore } from '../stores/language'
import { useUserStore } from '../stores/user'

const router = useRouter()
const customer = useCustomerStore()
const language = useLanguageStore()
// 未登录时复用前台登录弹窗（与 Header、个人中心一致），不再另做一套登录页
const user = useUserStore()

onMounted(async () => {
  if (customer.isLoggedIn) return
  user.openLogin()
  await router.replace('/')
})

// token 失效时拦截器已清空登录态，这里与个人中心保持一致：回首页并唤起登录弹窗
const onLoadError = async () => {
  if (customer.isLoggedIn) return
  user.openLogin()
  await router.replace('/')
}
</script>

<template>
  <section v-if="customer.isLoggedIn" class="container page">
    <div class="page-intro">
      <span class="eyebrow">{{ language.t('account') }}</span>
      <h1>{{ language.t('addressList') }}</h1>
      <p>{{ language.t('addressText') }}</p>
    </div>

    <AddressManager @load-error="onLoadError" />

    <p class="address-back"><RouterLink class="text-button" to="/account">{{ language.t('profile') }}</RouterLink></p>
  </section>
</template>
