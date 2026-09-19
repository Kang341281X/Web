<script setup>
import { useCartStore } from '../../stores/cart'; import { useLanguageStore } from '../../stores/language'
import { useCustomerStore } from '../../stores/customer'; import { useUserStore } from '../../stores/user'
const cart = useCartStore(), language = useLanguageStore(), customer = useCustomerStore(), user = useUserStore()
</script>
<template><nav class="bottom-nav"><RouterLink to="/">⌂<span>{{ language.t('home') }}</span></RouterLink><RouterLink to="/products">⌘<span>{{ language.t('categories') }}</span></RouterLink><!-- 账户入口替代"搜索"：移动端页头已有搜索框；未登录点按打开登录弹窗（LoginModal 挂在 App.vue），登录后进个人中心 --><RouterLink v-if="customer.isLoggedIn" to="/account">👤<span>{{ language.t('account') }}</span></RouterLink><button v-else type="button" @click="user.openLogin()">👤<span>{{ language.t('login') }}</span></button><RouterLink to="/favorites">♡<span>{{ language.t('favorites') }}</span></RouterLink><RouterLink to="/cart" class="bottom-cart">🛒<i v-if="cart.count">{{ cart.count }}</i><span>{{ language.t('cart') }}</span></RouterLink></nav></template>
