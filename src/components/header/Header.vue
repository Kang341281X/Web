<script setup>
import { computed, ref } from 'vue'
import { useCartStore } from '../../stores/cart'
import { useCustomerStore } from '../../stores/customer'
import { useFavoritesStore } from '../../stores/favorites'
import { useLanguageStore } from '../../stores/language'
import { useUserStore } from '../../stores/user'
import { categories } from '../../data/categories'
import AccountMenu from './AccountMenu.vue'
import SearchBar from './SearchBar.vue'
import LanguageSelector from './LanguageSelector.vue'
import CategoryNav from './CategoryNav.vue'
const cart = useCartStore(), favorites = useFavoritesStore(), language = useLanguageStore(), user = useUserStore(), customer = useCustomerStore(); const menuOpen = ref(false)
const cartCount = computed(() => cart.count)
// 未登录时点「登录」打开弹窗；移动端抽屉里点击后一并收起抽屉
const openLogin = () => { menuOpen.value = false; user.openLogin() }
const signOut = () => { menuOpen.value = false; customer.logout() }
</script>
<template>
  <header class="site-header"><div class="header-main container">
    <button class="menu-button icon-button" aria-label="Open menu" @click="menuOpen = true">☰</button>
    <RouterLink to="/" class="logo" aria-label="Craftora home"><span>✦</span>craftora</RouterLink>
    <div class="desktop-search"><SearchBar /></div>
    <nav class="header-actions" :aria-label="language.t('account')">
      <AccountMenu v-if="customer.isLoggedIn" />
      <button v-else class="header-action" @click="openLogin"><span class="header-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4.1 3.35-6.15 7.5-6.15S18.7 15.9 19.5 20"/></svg></span><span>{{ language.t('login') }}</span></button>
      <RouterLink to="/favorites" class="header-action" :aria-label="language.t('favorites')"><span class="header-action-icon">♡<b v-if="favorites.ids.length">{{ favorites.ids.length }}</b></span><span>{{ language.t('favorites') }}</span></RouterLink>
      <RouterLink to="/cart" class="header-action" :aria-label="language.t('cart')"><span class="header-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 11h-11z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg><b v-if="cartCount">{{ cartCount }}</b></span><span>{{ language.t('cart') }}</span></RouterLink>
      <LanguageSelector />
    </nav>
  </div><div class="mobile-search container"><SearchBar /></div><CategoryNav /></header>
  <Teleport to="body"><div v-if="menuOpen" class="drawer-overlay" @click.self="menuOpen = false"><aside class="mobile-drawer"><button class="icon-button" aria-label="Close menu" @click="menuOpen = false">×</button><RouterLink to="/" class="logo" @click="menuOpen=false"><span>✦</span>craftora</RouterLink><p class="drawer-label">{{ language.t('categories') }}</p><RouterLink v-for="c in categories" :key="c.id" :to="c.id === 'all' ? '/products' : `/category/${c.id}`" @click="menuOpen=false">{{ c.icon }} {{ language.category(c.id) }}</RouterLink><hr/><template v-if="customer.isLoggedIn"><p class="drawer-label">{{ language.t('account') }}</p><RouterLink to="/account" @click="menuOpen=false">👤 {{ language.t('profile') }}</RouterLink><RouterLink to="/orders" @click="menuOpen=false">📦 {{ language.t('myOrders') }}</RouterLink><RouterLink to="/account/addresses" @click="menuOpen=false">📍 {{ language.t('addressList') }}</RouterLink><button @click="signOut">{{ language.t('logout') }}</button></template><button v-else @click="openLogin">{{ language.t('login') }}</button><RouterLink to="/favorites" @click="menuOpen=false">♡ {{ language.t('favorites') }}</RouterLink><RouterLink to="/cart" @click="menuOpen=false">🛒 {{ language.t('cart') }}</RouterLink><div class="drawer-language"><LanguageSelector /></div></aside></div></Teleport>
</template>
