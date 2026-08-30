<script setup>
import { computed, ref } from 'vue'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productBadge, productTitle } from '../../data/translations'
import FavoriteButton from './FavoriteButton.vue'
import AppImage from '../common/AppImage.vue'
const props = defineProps({ product: Object }); const cart = useCartStore(), language = useLanguageStore(), added = ref(false)
const title = computed(() => productTitle(props.product, language.locale))
const badge = computed(() => productBadge(props.product.badge, language.locale))
const add = () => { cart.add(props.product); added.value = true; setTimeout(() => added.value = false, 1400) }
</script>
<template><article class="product-card"><RouterLink :to="`/product/${product.id}`" class="product-image"><AppImage :src="product.image" :alt="title"/><span v-if="product.badge" class="badge">{{ badge }}</span><FavoriteButton :product-id="product.id" /></RouterLink><div class="product-info"><RouterLink :to="`/product/${product.id}`" class="product-title">{{ title }}</RouterLink><p class="product-seller">{{ product.seller }}</p><div class="rating"><span>★ {{ product.rating }}</span><small>({{ product.reviewCount }})</small></div><div class="product-bottom"><div><strong>{{ language.price(product.price) }}</strong><del>{{ language.price(product.originalPrice) }}</del></div><button class="quick-add" :aria-label="language.t('addCart')" @click="add">{{ added ? '✓' : '+' }}</button></div></div></article></template>
