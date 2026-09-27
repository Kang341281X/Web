<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
const product = ref(null); const related = ref([]); const quantity = ref(1); const added = ref(false); const loading = ref(false)
const title = computed(() => product.value ? productTitle(product.value, language.locale) : '')
// 商品详情页标题依赖当前商品的多语言标题，由本组件独立设置；
// App.vue 在 /product/ 前缀下不设置 document.title，避免被覆盖。
// 注意必须在 title 声明之后调用：useI18nTitle 内部的 watchEffect 会同步执行一次，
// 若放在 title 声明前会触发 TDZ 错误（Cannot access 'title' before initialization）。
useI18nTitle(() => title.value)
const description = computed(() => product.value ? productDescription(product.value, language.locale) : '')
const badge = computed(() => product.value ? productBadge(product.value.badge, language.locale) : '')
// 预估运费：数据来自后端 shipping_rate 表，按当前语言对应的区域取 fee_cny（人民币），0 表示包邮。
// 本站只按界面语言区分用户、不采集收货国家，因此只是近似估算，页面会注明以物流商核算为准。
const shipping = computed(() => language.shipping)
const shippingFree = computed(() => shipping.value.feeCny <= 0)
// 已知简化设计：店铺头像暂用店铺名首字母生成纯色圆块（shopInitial）兜底。
// 数据模型中没有「店铺头像」字段，seller 信息借用的是商品 brand/manufacturer 文本，
// 待「店铺」是否做成真正的多商户实体明确后再统一实现真实头像上传，勿在此重复调研。
const shopInitial = computed(() => (product.value?.seller || '?').trim().charAt(0).toUpperCase())
// 店铺入口：有真实 brand/manufacturer 时跳转到按 seller 筛选的商品列表，否则退化为普通列表
const shopTarget = computed(() => {
  const seller = product.value?.seller || ''
  const real = product.value?.brand || product.value?.manufacturer
  return real ? { path: '/products', query: { seller } } : '/products'
})

// 商品介绍「查看更多/收起」折叠：仅当文字超过约 5 行时显示按钮
const descExpanded = ref(false)
const descOverflow = ref(false)
const descEl = ref(null)
const reviewsEl = ref(null)

function measureDesc() {
  descExpanded.value = false
  descOverflow.value = false
  nextTick(() => {
    const el = descEl.value
    if (el && el.scrollHeight > el.clientHeight + 1) descOverflow.value = true
  })
}
watch(description, measureDesc)

// 点击评分区直接滚动到页内「买家评价」分区（评价不再是 Tab）
function scrollToReviews() {
  reviewsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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

// 加购会请求服务端，未登录时由 store 弹出登录框；失败或按库存截断时给出提示
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
watch(() => route.params.id, (id) => { if (id) { quantity.value = 1; loadProduct(id) } })
</script>
<template><section v-if="loading" class="container page detail-page" role="status" aria-busy="true" aria-label="加载中"><div class="breadcrumbs skeleton-shimmer" style="width:140px;height:14px" /><div class="detail-layout"><div class="detail-skeleton-gallery skeleton-shimmer" /><div class="detail-skeleton-info"><div class="skeleton-shimmer skeleton-line" style="width:30%" /><div class="skeleton-shimmer skeleton-line tall" style="width:75%" /><div class="skeleton-shimmer skeleton-line short" style="width:50%" /><div class="skeleton-shimmer skeleton-line short" style="width:40%" /><div class="skeleton-shimmer skeleton-line" style="width:90%" /><div class="skeleton-shimmer skeleton-line" style="width:85%" /><div class="skeleton-shimmer skeleton-line short" style="width:35%" /></div></div></section><section v-else-if="product" class="container page detail-page"><div class="breadcrumbs"><RouterLink to="/products">{{ language.t('products') }}</RouterLink><span>/</span><RouterLink :to="`/category/${product.category}`">{{ language.category(product.category) }}</RouterLink></div><div class="detail-layout"><ProductGallery :product="product" /><div class="detail-info"><RouterLink class="detail-shop" :to="shopTarget"><span class="shop-avatar">{{ shopInitial }}</span>{{ product.seller }}</RouterLink><span class="eyebrow" :class="{ 'eyebrow--customizable': product.isCustomizable }">{{ product.isCustomizable ? language.t('customizable') : (badge || language.t('handmade')) }}</span><h1>{{ title }}</h1><div class="detail-rating" role="button" tabindex="0" @click="scrollToReviews" @keydown.enter="scrollToReviews"><span class="star-icon">★</span>{{ product.rating }} <u>{{ product.reviewCount }} {{ language.t('reviewCountUnit') }}</u></div><div class="detail-price"><strong>{{ language.price(product.price) }}</strong><del v-if="product.originalPrice > product.price">{{ language.price(product.originalPrice) }}</del><span v-if="product.originalPrice > product.price" class="discount-badge">-{{ Math.round((1 - product.price / product.originalPrice) * 100) }}%</span></div><p class="stock">● {{ language.t('stock') }} {{ product.stock }} {{ language.t('items') }}</p><div class="purchase-row"><div class="quantity-control"><button @click="quantity=Math.max(1,quantity-1)">−</button><span>{{ quantity }}</span><button @click="quantity=Math.min(product.stock,quantity+1)">+</button></div><button class="button primary" @click="add">{{ added ? language.t('added') : language.t('addCart') }}</button><FavoriteButton :product-id="product.id" /></div><div class="detail-shipping"><p class="shipping-note">✦ {{ shippingFree ? language.t('shippingFree') : `${language.t('shippingEstimate')} ${language.price(shipping.feeCny)}` }}</p><p class="shipping-hint">{{ language.t('shippingEstimateHint') }}</p></div></div></div><section class="detail-sections"><section class="detail-section"><h2>{{ language.t('description') }}</h2><p ref="descEl" class="detail-desc" :class="{ 'is-clamped': !descExpanded }">{{ description }}</p><button v-if="descOverflow" type="button" class="text-button detail-more" @click="descExpanded = !descExpanded">{{ descExpanded ? language.t('showLess') : language.t('showMore') }}</button></section><section v-if="product.detail" class="detail-section"><h2>{{ language.t('details') }}</h2><p class="detail-text">{{ product.detail }}</p></section><section class="detail-section" ref="reviewsEl"><h2>{{ language.t('reviews') }}</h2><ProductReviews :product-id="product.id" @changed="refreshProductRating" /></section></section><section class="section related-section"><div class="section-heading"><h2>{{ language.t('related') }}</h2></div><ProductGrid :products="related" /></section></section><section v-else-if="!loading" class="container page"><EmptyState :title="language.t('productNotFound')" :action="language.t('backHome')" /></section></template>

<style scoped>
/* detail-shipping / shipping-hint styling handled by global main.css */
/* 商品详情（detail）为纯文本，用 pre-line 安全保留换行分段，不走 v-html，避免 XSS */
.detail-text { white-space: pre-line }
</style>
