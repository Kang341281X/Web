<script setup>
import { ref } from 'vue'
import { useDropdown } from '../../composables/useDropdown'
import { useCustomerStore } from '../../stores/customer'
import { useLanguageStore } from '../../stores/language'

const customer = useCustomerStore()
const language = useLanguageStore()
const root = ref(null)
const { open, toggle, close } = useDropdown(root)

// 退出登录后由 Header 自动切回「登录」按钮
const signOut = () => {
  close()
  customer.logout()
}
</script>

<template>
  <div ref="root" class="account-menu">
    <button class="header-action account-trigger" type="button" aria-haspopup="menu" :aria-expanded="open" :aria-label="language.t('account')" @click="toggle">
      <span class="header-action-icon">
        <img v-if="customer.avatarUrl" :src="customer.avatarUrl" :alt="customer.displayName" class="account-avatar" />
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4.1 3.35-6.15 7.5-6.15S18.7 15.9 19.5 20"/></svg>
      </span>
      <span class="account-name">{{ customer.displayName }}</span>
    </button>
    <Transition name="language-popover">
      <ul v-if="open" class="account-options" role="menu">
        <li class="account-summary">
          <span class="account-summary-name">{{ customer.displayName }}</span>
          <span class="account-summary-phone">{{ customer.profile?.phone }}</span>
        </li>
        <li><RouterLink to="/account" role="menuitem" @click="close">{{ language.t('profile') }}</RouterLink></li>
        <li><RouterLink to="/orders" role="menuitem" @click="close">{{ language.t('myOrders') }}</RouterLink></li>
        <li><button type="button" role="menuitem" @click="signOut">{{ language.t('logout') }}</button></li>
      </ul>
    </Transition>
  </div>
</template>
