<script setup>
import { computed, ref } from 'vue'
import { useCartStore } from '../stores/cart'
import { useLanguageStore } from '../stores/language'
import EmptyState from '../components/common/EmptyState.vue'
import AppImage from '../components/common/AppImage.vue'
import CheckoutDialog from '../components/common/CheckoutDialog.vue'
import { productTitle } from '../data/translations'
const cart = useCartStore(), language = useLanguageStore()
const checkoutVisible = ref(false)

// 运费与 ProductDetail.vue 共用同一份数据（src/data/shipping.js + language.shipping getter），
// 不再硬编码「满 299 免邮」之类的临时规则。feeCny 即 shipping_rate 表的 fee_cny，0 表示包邮。
// 此处只读取展示，不二次校验后端，后端 createCustomerOrder 仍会再次校验 >= 0。
const shipping = computed(() => language.shipping)
const shippingFee = computed(() => shipping.value.feeCny || 0)
const shippingFree = computed(() => shippingFee.value <= 0)
const total = computed(() => cart.subtotal + shippingFee.value)
</script>

<template>
  <section class="container page cart-page">
    <div class="page-intro">
      <span class="eyebrow">{{ language.t('yourSelection') }}</span>
      <h1>{{ language.t('cart') }}</h1>
    </div>
    <EmptyState
      v-if="!cart.items.length && !cart.loading"
      icon="🛒"
      :title="language.t('emptyCart')"
      :action="language.t('continueShopping')"
    />
    <div v-else class="cart-layout">
      <div class="cart-list">
        <article v-for="item in cart.items" :key="item.product.id" class="cart-item">
          <RouterLink :to="`/product/${item.product.id}`">
            <AppImage :src="item.product.image" :alt="productTitle(item.product, language.locale)" />
          </RouterLink>
          <div class="cart-item-copy">
            <RouterLink :to="`/product/${item.product.id}`">{{ productTitle(item.product, language.locale) }}</RouterLink>
            <p>{{ item.product.seller }}</p>
            <strong>{{ language.price(item.product.price) }}</strong>
            <div class="quantity-control">
              <button aria-label="decrease" @click="cart.setQuantity(item.product.id,item.quantity-1)">−</button>
              <span>{{ item.quantity }}</span>
              <button aria-label="increase" @click="cart.setQuantity(item.product.id,item.quantity+1)">+</button>
            </div>
            <button class="text-button" @click="cart.remove(item.product.id)">{{ language.t('remove') }}</button>
          </div>
          <strong class="cart-line-price">{{ language.price(item.product.price * item.quantity) }}</strong>
        </article>
      </div>
      <aside class="order-summary">
        <h2>{{ language.t('total') }}</h2>
        <div>
          <span>{{ language.t('subtotal') }}</span>
          <b>{{ language.price(cart.subtotal) }}</b>
        </div>
        <div>
          <span>{{ language.t('shippingEstimate') }}</span>
          <b>{{ shippingFree ? language.t('shippingFree') : language.price(shippingFee) }}</b>
        </div>
        <p v-if="!shippingFree" class="cart-shipping-hint">{{ language.t('shippingEstimateHint') }}</p>
        <div class="grand-total">
          <span>{{ language.t('total') }}</span>
          <strong>{{ language.price(total) }}</strong>
        </div>
        <button class="button primary wide" @click="checkoutVisible = true">{{ language.t('checkout') }}</button>
        <button class="text-button" @click="cart.clear">{{ language.t('clearCart') }}</button>
      </aside>
    </div>
    <CheckoutDialog v-model:visible="checkoutVisible" :shipping-fee="shippingFee" />
  </section>
</template>

<style scoped>
/* 与「预计运费」一行错开的灰色小提示，避免与右侧金额重叠 */
.cart-shipping-hint { margin: -6px 0 8px; font-size: 12px; color: #909399 }
</style>