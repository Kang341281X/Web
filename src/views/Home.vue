<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useLanguageStore } from '../stores/language'
import { fetchProducts } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import EmptyState from '../components/common/EmptyState.vue'

const PAGE_SIZE = 60

const language = useLanguageStore()
const products = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
let productsRequestId = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

// Build full two-row collections from the sales, rating, price, and date fields already returned by the API.
const curatedSections = computed(() => {
  const list = products.value
  const bestSelling = [...list].sort((a, b) => (b.sales || 0) - (a.sales || 0))
  const topRated = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0))
  const offers = [...list]
    .filter(product => product.originalPrice > product.price)
    .sort((a, b) => (1 - b.price / b.originalPrice) - (1 - a.price / a.originalPrice))
  const newArrivals = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return [
    { title: language.t('bestSelling'), products: bestSelling.slice(0, 8) },
    { title: language.t('topRated'), products: topRated.slice(0, 8) },
    { title: language.t('specialOffers'), products: offers.slice(0, 8) },
    { title: language.t('newArrivals'), products: newArrivals.slice(0, 8) }
  ].filter(section => section.products.length === 8)
})

async function load() {
  const requestId = ++productsRequestId
  loading.value = true
  try {
    const { products: list, pagination } = await fetchProducts({ page: page.value, page_size: PAGE_SIZE })
    if (requestId !== productsRequestId) return
    products.value = list
    total.value = Number(pagination?.total) || list.length
  } catch (error) {
    if (requestId !== productsRequestId) return
    console.error('Failed to load home products:', error)
    products.value = []
    total.value = 0
  } finally {
    if (requestId === productsRequestId) loading.value = false
  }
}

async function changePage(next) {
  page.value = Number(next) || 1
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await load()
}

onMounted(load)

watch(() => language.locale, () => { page.value = 1; load() })
</script>

<template>
  <div class="home-page">
    <!-- Hero Banner -->
    <section class="hero container">
      <div class="hero-copy">
        <span class="eyebrow">{{ language.t('heroEyebrow') }}</span>
        <h1>{{ language.t('heroTitle') }}</h1>
        <p>{{ language.t('heroText') }}</p>
        <RouterLink class="button primary" to="/products">{{ language.t('explore') }} <span>&rarr;</span></RouterLink>
      </div>
      <img src="/assets/images/banners/craft-hero.svg" alt="Handcrafted pottery and flowers" fetchpriority="high" />
    </section>

    <!-- Curated Collection Sections -->
    <template v-if="!loading">
      <section
        v-for="(section, idx) in curatedSections"
        :key="idx"
        class="container curated-section"
      >
        <div class="section-heading">
          <h2>{{ section.title }}</h2>
          <RouterLink to="/products" class="text-link">{{ language.t('explore') }} &rarr;</RouterLink>
        </div>
        <ProductGrid :products="section.products" />
      </section>

      <EmptyState
        v-if="!products.length"
        :title="language.t('noResults')"
        :action="language.t('continueShopping')"
      >{{ language.t('craftedDescription') }}</EmptyState>
    </template>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="container">
      <ProductGridSkeleton v-for="n in 2" :key="n" style="margin-bottom:32px" />
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="catalog-pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        :pager-count="5"
        layout="prev, pager, next"
        background
        @current-change="changePage"
      />
      <p class="catalog-pagination__summary" aria-live="polite">{{ pageSummary }}</p>
    </div>
  </div>
</template>

<style scoped>
.curated-section {
  padding-top: 40px;
}

.curated-section:first-of-type {
  padding-top: 24px;
}

</style>
