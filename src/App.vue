<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from './stores/language'
import Header from './components/header/Header.vue'
import Footer from './components/footer/Footer.vue'
import MobileBottomNav from './components/common/MobileBottomNav.vue'
import LoginModal from './components/common/LoginModal.vue'
import BackToTop from './components/common/BackToTop.vue'

const route = useRoute()
const language = useLanguageStore()
// 后台管理路由不显示前台的 Header / Footer / 底部导航等组件
const isAdmin = computed(() => route.path.startsWith('/admin'))

// document.title 在路由切换 / 语言切换时统一刷新；统一后缀「 · Craftora」。
// 商品详情 / 分类页的标题依赖动态数据（product.title / category.name），由各页面在自己的 watch 里覆盖设置。
// 此处只在「非动态页」上设置，避免 watcher 互相覆盖又主动清空。
const SUFFIX = ' · Craftora'
// 仅列翻译文件里已存在的 key；找不到的路由直接 fallback 到 "Craftora"，避免拼出原始英文 key。
const STATIC_TITLES = { '/': 'home', '/products': 'products', '/search': 'search', '/favorites': 'favorites', '/cart': 'cart' }
const ADMIN_TITLES = { '/admin/login': 'signIn', '/admin': 'home', '/admin/products': 'products', '/admin/categories': 'categories', '/admin/reviews': 'reviews', '/admin/orders': 'myOrders', '/admin/intent-orders': 'myOrders', '/admin/customers': 'profile', '/admin/profile': 'profile' }
watch(
  [() => route.path, () => language.locale],
  () => {
    if (route.path.startsWith('/product/') || route.path.startsWith('/category/')) return
    const map = isAdmin.value ? ADMIN_TITLES : STATIC_TITLES
    const key = map[route.path]
    document.title = key ? `${language.t(key)}${SUFFIX}` : `Craftora${SUFFIX}`
  },
  { immediate: true }
)
</script>

<template>
  <template v-if="isAdmin">
    <RouterView />
  </template>
  <template v-else>
    <Header />
    <main><RouterView /></main>
    <Footer />
    <MobileBottomNav />
    <BackToTop />
    <LoginModal />
  </template>
</template>
