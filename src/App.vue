<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Header from './components/header/Header.vue'
import Footer from './components/footer/Footer.vue'
import MobileBottomNav from './components/common/MobileBottomNav.vue'
import LoginModal from './components/common/LoginModal.vue'
import BackToTop from './components/common/BackToTop.vue'

const route = useRoute()
// 后台管理路由不显示前台的 Header / Footer / 底部导航等组件
const isAdmin = computed(() => route.path.startsWith('/admin'))
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
