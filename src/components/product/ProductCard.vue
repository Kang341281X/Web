<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productBadge, productTitle } from '../../data/translations'
import FavoriteButton from './FavoriteButton.vue'
import AppImage from '../common/AppImage.vue'
const props = defineProps({ product: Object }); const cart = useCartStore(), language = useLanguageStore(), added = ref(false)
const title = computed(() => productTitle(props.product, language.locale))
const badge = computed(() => productBadge(props.product.badge, language.locale))
// 登录态下加购会请求服务端，失败或按库存截断时给出提示；游客仍是纯本地操作
const add = async () => {
  const result = await cart.add(props.product)
  if (!result.success) { ElMessage.error(result.message); return }
  if (result.truncated) ElMessage.warning(result.message)
  added.value = true
  setTimeout(() => added.value = false, 1400)
}
</script>
<template><article class="product-card"><RouterLink :to="`/product/${product.id}`" class="product-image"><AppImage :src="product.image" :alt="title"/><span v-if="product.badge" class="badge">{{ badge }}</span><FavoriteButton :product-id="product.id" /></RouterLink><div class="product-info"><RouterLink :to="`/product/${product.id}`" class="product-title">{{ title }}</RouterLink><p class="product-seller">{{ product.seller }}</p><div class="rating"><span>★ {{ product.rating }}</span><small>({{ product.reviewCount }})</small></div><div class="product-bottom"><div><strong>{{ language.price(product.price) }}</strong><del>{{ language.price(product.originalPrice) }}</del></div><button class="quick-add" :aria-label="language.t('addCart')" @click="add">{{ added ? '✓' : '+' }}</button></div></div></article></template>
