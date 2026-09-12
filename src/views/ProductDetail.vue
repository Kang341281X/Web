<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useLanguageStore } from '../stores/language'
import { useCartStore } from '../stores/cart'
import { productBadge, productTitle, productDescription } from '../data/translations'
import { fetchProduct, fetchProducts } from '../services/publicApi'
import ProductGallery from '../components/product/ProductGallery.vue'
import ProductGrid from '../components/product/ProductGrid.vue'
import FavoriteButton from '../components/product/FavoriteButton.vue'
import ProductReviews from '../components/product/ProductReviews.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore(), cart = useCartStore()
const product = ref(null); const related = ref([]); const quantity = ref(1); const added = ref(false); const activeTab = ref('description'); const loading = ref(false)
const title = computed(() => product.value ? productTitle(product.value, language.locale) : '')
const description = computed(() => product.value ? productDescription(product.value, language.locale) : '')
const badge = computed(() => product.value ? productBadge(product.value.badge, language.locale) : '')

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

// 登录态下加购会请求服务端，失败或按库存截断时给出提示；游客仍是纯本地操作
const add = async () => {
  if (!product.value) return
  const result = await cart.add(product.value, quantity.value)
  if (!result.success) { ElMessage.error(result.message); return }
  if (result.truncated) ElMessage.warning(result.message)
  added.value = true
  setTimeout(() => { added.value = false }, 1500)
}

onMounted(() => loadProduct(route.params.id))
watch(() => route.params.id, (id) => { if (id) { quantity.value = 1; activeTab.value = 'description'; loadProduct(id) } })
</script>
<template><section v-if="product" class="container page detail-page"><div class="breadcrumbs"><RouterLink to="/products">{{ language.t('products') }}</RouterLink><span>/</span><RouterLink :to="`/category/${product.category}`">{{ language.category(product.category) }}</RouterLink></div><div class="detail-layout"><ProductGallery :product="product" /><div class="detail-info"><span class="eyebrow" :class="{ 'eyebrow--customizable': product.isCustomizable }">{{ product.isCustomizable ? language.t('customizable') : (badge || language.t('handmade')) }}</span><h1>{{ title }}</h1><p class="detail-seller">{{ language.t('seller') }} · {{ product.seller }}</p><div class="detail-rating">★ {{ product.rating }} <u>{{ product.reviewCount }} {{ language.t('reviewCountUnit') }}</u></div><div class="detail-price"><strong>{{ language.price(product.price) }}</strong><del v-if="product.originalPrice > product.price">{{ language.price(product.originalPrice) }}</del><span v-if="product.originalPrice > product.price">{{ language.t('save') }} {{ language.price(product.originalPrice-product.price) }}</span></div><p class="detail-description">{{ description }}</p><p class="stock">● {{ language.t('stock') }} {{ product.stock }} {{ language.t('items') }}</p><div class="purchase-row"><div class="quantity-control"><button @click="quantity=Math.max(1,quantity-1)">−</button><span>{{ quantity }}</span><button @click="quantity=Math.min(product.stock,quantity+1)">+</button></div><button class="button primary" @click="add">{{ added ? language.t('added') : language.t('addCart') }}</button><FavoriteButton :product-id="product.id" /></div><p class="shipping-note">✦ {{ language.t('freeShipping') }}</p></div></div><section class="detail-tabs"><div class="tab-list"><button v-for="tab in ['description','specifications','shipping','reviews']" :key="tab" :class="{active:activeTab===tab}" @click="activeTab=tab">{{ language.t(tab) }}</button></div><div class="tab-content"><p v-if="activeTab==='description'">{{ description }}</p><p v-else-if="activeTab==='specifications'">{{ language.t('detailSpecs') }}</p><p v-else-if="activeTab==='shipping'">{{ language.t('detailShipping') }}</p><ProductReviews v-else :product-id="product.id" /></div></section><section class="section related-section"><div class="section-heading"><h2>{{ language.t('related') }}</h2></div><ProductGrid :products="related" /></section></section><section v-else-if="!loading" class="container page"><EmptyState :title="language.t('productNotFound')" :action="language.t('backHome')" /></section></template>
