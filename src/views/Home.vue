<script setup>
import { computed, onMounted, ref } from 'vue'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import CategoryCard from '../components/category/CategoryCard.vue'
const language = useLanguageStore()
const allProducts = ref([])
const categories = ref([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const { products } = await fetchProducts({ page: 1, page_size: 20 })
    allProducts.value = products
    categories.value = (await fetchCategories()).map(c => ({ ...c, icon: '✦' }))
  } catch (error) {
    console.error('Failed to load home data:', error)
  } finally {
    loading.value = false
  }
})

const popular = computed(() => allProducts.value.slice(0, 5))
const trending = computed(() => allProducts.value.slice(5, 10))
const newProducts = computed(() => allProducts.value.slice(10, 15))
const offers = computed(() => allProducts.value.slice(15, 20))
</script>
<template><div class="home-page"><section class="hero container"><div class="hero-copy"><span class="eyebrow">{{ language.t('heroEyebrow') }}</span><h1>{{ language.t('heroTitle') }}</h1><p>{{ language.t('heroText') }}</p><RouterLink class="button primary" to="/products">{{ language.t('explore') }} <span>→</span></RouterLink></div><img src="/assets/images/banners/craft-hero.svg" alt="Handcrafted pottery and flowers" fetchpriority="high" /></section><section class="container section"><div class="section-heading"><h2>{{ language.t('trending') }}</h2><RouterLink to="/products">{{ language.t('viewAll') }} →</RouterLink></div><ProductGrid :products="trending" /></section><section class="container section"><div class="section-heading"><h2>{{ language.t('newArrivals') }}</h2><RouterLink to="/products">{{ language.t('viewAll') }} →</RouterLink></div><ProductGrid :products="newProducts" /></section><section class="container section"><div class="section-heading"><div><span class="eyebrow">{{ language.t('details') }}</span><h2>{{ language.t('categories') }}</h2></div><RouterLink to="/products">{{ language.t('viewAll') }} →</RouterLink></div><div class="category-grid"><CategoryCard v-for="category in categories" :key="category.id" :category="category" /></div></section><section class="feature-banner container"><img src="/assets/images/banners/studio-hero.svg" alt="Craft studio" /><div><span class="eyebrow">{{ language.t('featureEyebrow') }}</span><h2>{{ language.t('featureTitle') }}</h2><p>{{ language.t('featureText') }}</p><RouterLink to="/products" class="text-link">{{ language.t('explore') }} →</RouterLink></div></section><section class="container section"><div class="section-heading"><h2>{{ language.t('popular') }}</h2><RouterLink to="/products">{{ language.t('viewAll') }} →</RouterLink></div><ProductGrid :products="popular" /></section><section class="container section last-section"><div class="section-heading"><h2>{{ language.t('specialOffers') }}</h2><RouterLink to="/products">{{ language.t('viewAll') }} →</RouterLink></div><ProductGrid :products="offers" /></section></div></template>
