<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productBadge, productTitle } from '../../data/translations'
import FavoriteButton from './FavoriteButton.vue'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ product: Object })
const cart = useCartStore(), language = useLanguageStore(), added = ref(false)

const title = computed(() => productTitle(props.product, language.locale))
const badge = computed(() => productBadge(props.product.badge, language.locale))

const isOnSale = computed(() => props.product.originalPrice > props.product.price)
const discountPercent = computed(() => {
  if (!isOnSale.value) return 0
  return Math.round((1 - props.product.price / props.product.originalPrice) * 100)
})

const add = async () => {
  const result = await cart.add(props.product)
  if (!result.success) {
    // requiresLogin 时已由 store 弹出登录框，不再重复弹 error toast
    if (!result.requiresLogin) ElMessage.error(result.message)
    return
  }
  if (result.truncated) ElMessage.warning(result.message)
  added.value = true
  setTimeout(() => added.value = false, 1400)
}
</script>

<template>
  <article class="product-card">
    <RouterLink :to="`/product/${product.id}`" class="product-image">
      <AppImage :src="product.image" :alt="title"/>
      <!-- Discount corner badge (Etsy style) -->
      <span v-if="isOnSale" class="discount-corner">-{{ discountPercent }}%</span>
      <span v-else-if="product.badge" class="badge">{{ badge }}</span>
    </RouterLink>
    <FavoriteButton :product-id="product.id" />
    <div class="product-info">
      <!-- Shop name first -->
      <p class="product-seller">{{ product.seller }}</p>
      <!-- Title (max 2 lines) -->
      <RouterLink :to="`/product/${product.id}`" class="product-title">{{ title }}</RouterLink>
      <!-- Rating + review count -->
      <div class="rating">
        <span>★ {{ product.rating }}</span>
        <small>({{ product.reviewCount }})</small>
      </div>
      <!-- Price -->
      <div class="product-bottom">
        <div>
          <strong>{{ language.price(product.price) }}</strong>
          <del v-if="isOnSale">{{ language.price(product.originalPrice) }}</del>
        </div>
        <button class="quick-add" :aria-label="language.t('addCart')" @click="add">{{ added ? '✓' : '+' }}</button>
      </div>
    </div>
  </article>
</template>