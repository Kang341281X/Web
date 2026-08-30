<script setup>
import { useCartStore } from '../../stores/cart'; import { useLanguageStore } from '../../stores/language'
const cart = useCartStore(), language = useLanguageStore()
</script>
<template><nav class="bottom-nav"><RouterLink to="/">⌂<span>{{ language.t('home') }}</span></RouterLink><RouterLink to="/products">⌘<span>{{ language.t('categories') }}</span></RouterLink><RouterLink to="/search">⌕<span>{{ language.t('search') }}</span></RouterLink><RouterLink to="/favorites">♡<span>{{ language.t('favorites') }}</span></RouterLink><RouterLink to="/cart" class="bottom-cart">🛒<i v-if="cart.count">{{ cart.count }}</i><span>{{ language.t('cart') }}</span></RouterLink></nav></template>
