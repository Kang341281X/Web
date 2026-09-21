<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../stores/language'
import { useCartStore } from '../stores/cart'
import { productBadge, productTitle, productDescription } from '../data/translations'
import { fetchProduct, fetchProducts } from '../services/publicApi'
import { useQuantityFeedback } from '../composables/useQuantityFeedback'
import { useI18nTitle } from '../composables/useI18nTitle'
import ProductGallery from '../components/product/ProductGallery.vue'
import ProductGrid from '../components/product/ProductGrid.vue'
import FavoriteButton from '../components/product/FavoriteButton.vue'
import ProductReviews from '../components/product/ProductReviews.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore(), cart = useCartStore()
const product = ref(null); const related = ref([]); const quantity = ref(1); const added = ref(false); const activeTab = ref('description'); const loading = ref(false)
// 商品详情页标题依赖当前商品的多语言标题，由本组件独立设置；
// App.vue 在 /product/ 前缀下不设置 document.title，避免被覆盖。
useI18nTitle(() => title.value)
const title = computed(() => product.value ? productTitle(product.value, language.locale) : '')
const description = computed(() => product.value ? productDescription(product.value, language.locale) : '')
const badge = computed(() => product.value ? productBadge(product.value.badge, language.locale) : '')
// 预估运费：数据来自后端 shipping_rate 表，按当前语言对应的区域取 fee_cny（人民币），0 表示包邮。
// 本站只按界面语言区分用户、不采集收货国家，因此只是近似估算，页面会注明以物流商核算为准。
const shipping = computed(() => language.shipping)
const shippingFree = computed(() => shipping.value.feeCny <= 0)

async function loadProduct(id) {
  loading.value = true
  try {
    product.value = await fetchProduct(id)
    // 加载相关商品（同分类）
    const { products } = await fetchProducts({ page: 1, page_size: 5, category_id: product.value.categoryId })
    related.value = products.filter(p => p.id !== Number(id)).slice(0, 4)
  } catch (error) {
    console.error('Failed to load product:', error)
    product.value = null
  } finally {
    loading.value = false
  }
}

// 评价发布/修改/删除后商品评分与评论数会变（后端重算 product.rating / review_count），
// 这里只重新取一次商品并替换这两个字段：不重跑 loadProduct，避免连带重新请求相关商品，
// 也不整体替换 product.value，避免顶部评分以外的地方闪一下。
async function refreshProductRating() {
  if (!product.value) return
  try {
    const latest = await fetchProduct(product.value.id)
    // 用最新值覆盖，避免请求返回期间又发生一次评价变更时拿到更旧的数据
    product.value = { ...product.value, rating: latest.rating, reviewCount: latest.reviewCount }
  } catch (error) {
    console.error('Failed to refresh product rating:', error)
  }
}

// 登录态下加购会请求服务端，失败或按库存截断时给出提示；游客仍是纯本地操作
// 失败 / 截断 toast 文案与购物车页对齐（见 composables/useQuantityFeedback.js）
const { handle: handleQuantityFeedback } = useQuantityFeedback()
const add = async () => {
  if (!product.value) return
  const result = await cart.add(product.value, quantity.value)
  handleQuantityFeedback(result)
  if (!result.success) return
  added.value = true
  setTimeout(() => { added.value = false }, 1500)
}

onMounted(() => loadProduct(route.params.id))
watch(() => route.params.id, (id) => { if (id) { quantity.value = 1; activeTab.value = 'description'; loadProduct(id) } })
</script>
<template><section v-if="loading" class="container page detail-page" role="status" aria-busy="true" aria-label="加载中"><div class="breadcrumbs skeleton-shimmer" style="width:140px;height:14px" /><div class="detail-layout"><div class="detail-skeleton-gallery skeleton-shimmer" /><div class="detail-skeleton-info"><div class="skeleton-shimmer skeleton-line" style="width:30%" /><div class="skeleton-shimmer skeleton-line tall" style="width:75%" /><div class="skeleton-shimmer skeleton-line short" style="width:50%" /><div class="skeleton-shimmer skeleton-line short" style="width:40%" /><div class="skeleton-shimmer skeleton-line" style="width:90%" /><div class="skeleton-shimmer skeleton-line" style="width:85%" /><div class="skeleton-shimmer skeleton-line short" style="width:35%" /></div></div></section><section v-else-if="product" class="container page detail-page"><div class="breadcrumbs"><RouterLink to="/products">{{ language.t('products') }}</RouterLink><span>/</span><RouterLink :to="`/category/${product.category}`">{{ language.category(product.category) }}</RouterLink></div><div class="detail-layout"><ProductGallery :product="product" /><div class="detail-info"><span class="eyebrow" :class="{ 'eyebrow--customizable': product.isCustomizable }">{{ product.isCustomizable ? language.t('customizable') : (badge || language.t('handmade')) }}</span><h1>{{ title }}</h1><p class="detail-seller">{{ language.t('seller') }} · {{ product.seller }}</p><div class="detail-rating">★ {{ product.rating }} <u>{{ product.reviewCount }} {{ language.t('reviewCountUnit') }}</u></div><div class="detail-price"><strong>{{ language.price(product.price) }}</strong><del v-if="product.originalPrice > product.price">{{ language.price(product.originalPrice) }}</del><span v-if="product.originalPrice > product.price">{{ language.t('save') }} {{ language.price(product.originalPrice-product.price) }}</span></div><p class="detail-description">{{ description }}</p><p class="stock">● {{ language.t('stock') }} {{ product.stock }} {{ language.t('items') }}</p><div class="purchase-row"><div class="quantity-control"><button @click="quantity=Math.max(1,quantity-1)">−</button><span>{{ quantity }}</span><button @click="quantity=Math.min(product.stock,quantity+1)">+</button></div><button class="button primary" @click="add">{{ added ? language.t('added') : language.t('addCart') }}</button><FavoriteButton :product-id="product.id" /></div><div class="detail-shipping"><p class="shipping-note">✦ {{ shippingFree ? language.t('shippingFree') : `${language.t('shippingEstimate')} ${language.price(shipping.feeCny)}` }}</p><p class="shipping-hint">{{ language.t('shippingEstimateHint') }}</p></div></div></div><section class="detail-tabs"><div class="tab-list"><button v-for="tab in ['description','specifications','shipping','reviews']" :key="tab" :class="{active:activeTab===tab}" @click="activeTab=tab">{{ language.t(tab) }}</button></div><div class="tab-content"><p v-if="activeTab==='description'">{{ description }}</p><p v-else-if="activeTab==='specifications'">{{ language.t('detailSpecs') }}</p><p v-else-if="activeTab==='shipping'">{{ language.t('detailShipping') }}</p><ProductReviews v-else :product-id="product.id" @changed="refreshProductRating" /></div></section><section class="section related-section"><div class="section-heading"><h2>{{ language.t('related') }}</h2></div><ProductGrid :products="related" /></section></section><section v-else-if="!loading" class="container page"><EmptyState :title="language.t('productNotFound')" :action="language.t('backHome')" /></section></template>

<style scoped>
.detail-shipping { display: flex; flex-direction: column; gap: 4px }
.shipping-hint { margin: 0; font-size: 12px; color: #909399 }
</style>
