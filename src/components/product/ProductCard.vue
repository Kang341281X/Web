<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productBadge, productTitle } from '../../data/translations'
import { useQuantityFeedback } from '../../composables/useQuantityFeedback'
import FavoriteButton from './FavoriteButton.vue'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ product: Object })
const language = useLanguageStore()
const cart = useCartStore()
const { handle: handleQuantityFeedback } = useQuantityFeedback()

const title = computed(() => productTitle(props.product, language.locale))
const badge = computed(() => productBadge(props.product.badge, language.locale))

const isOnSale = computed(() => props.product.originalPrice > props.product.price)
const discountPercent = computed(() => {
  if (!isOnSale.value) return 0
  return Math.round((1 - props.product.price / props.product.originalPrice) * 100)
})

// 卡片上的快捷加购：未登录时 cart store 会自行弹登录框，失败 / 截断提示与详情页共用同一套
const adding = ref(false)
const added = ref(false)
async function addToCart() {
  if (adding.value || added.value) return
  adding.value = true
  try {
    const result = await cart.add(props.product, 1)
    handleQuantityFeedback(result)
    if (!result.success) return
    ElMessage.success(language.t('cartSuccess'))
    added.value = true
    setTimeout(() => { added.value = false }, 1500)
  } finally {
    adding.value = false
  }
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
    <div class="product-actions">
      <button
        type="button"
        class="cart-button"
        :class="{ added }"
        :disabled="Number(product.stock) === 0"
        :aria-label="added ? language.t('added') : language.t('addCart')"
        :title="language.t('addCart')"
        @click.stop="addToCart"
      >
        <svg v-if="!added" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 4h2.2l2.3 10.2h9.9L20 7H6.1"/>
          <circle cx="9.5" cy="19" r="1.4"/>
          <circle cx="17" cy="19" r="1.4"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 12.5l4.5 4.5 10-10"/>
        </svg>
      </button>
      <FavoriteButton :product-id="product.id" />
    </div>
    <div class="product-info">
      <RouterLink :to="`/product/${product.id}`" class="product-title">{{ title }}</RouterLink>
      <div class="product-bottom">
        <strong>{{ language.price(product.price) }}</strong>
        <del v-if="isOnSale">{{ language.price(product.originalPrice) }}</del>
      </div>
    </div>
  </article>
</template>
