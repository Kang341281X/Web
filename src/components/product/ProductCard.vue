<script setup>
import { computed } from 'vue'
import { useLanguageStore } from '../../stores/language'
import { productBadge, productTitle } from '../../data/translations'
import FavoriteButton from './FavoriteButton.vue'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ product: Object })
const language = useLanguageStore()

const title = computed(() => productTitle(props.product, language.locale))
const badge = computed(() => productBadge(props.product.badge, language.locale))

const isOnSale = computed(() => props.product.originalPrice > props.product.price)
const discountPercent = computed(() => {
  if (!isOnSale.value) return 0
  return Math.round((1 - props.product.price / props.product.originalPrice) * 100)
})

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
      <RouterLink :to="`/product/${product.id}`" class="product-title">{{ title }}</RouterLink>
      <div class="product-bottom">
        <strong>{{ language.price(product.price) }}</strong>
        <del v-if="isOnSale">{{ language.price(product.originalPrice) }}</del>
      </div>
      <p v-if="product.seller" class="product-seller">{{ product.seller }}</p>
    </div>
  </article>
</template>
