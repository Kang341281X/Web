<script setup>
import Header from './components/header/Header.vue'
import Footer from './components/footer/Footer.vue'
import MobileBottomNav from './components/common/MobileBottomNav.vue'
import LoginModal from './components/common/LoginModal.vue'
import BackToTop from './components/common/BackToTop.vue'
</script>
<template><Header /><main><RouterView /></main><Footer /><MobileBottomNav /><BackToTop /><LoginModal /></template>
