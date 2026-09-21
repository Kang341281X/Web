<script setup>
import { computed, onMounted, ref } from 'vue'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import CategoryCarousel from '../components/category/CategoryCarousel.vue'
import EmptyState from '../components/common/EmptyState.vue'

// 每页显示 60 个商品，超出部分自动分到后续页
const PAGE_SIZE = 60

const language = useLanguageStore()
const products = ref([])
const categories = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
// 总页数由接口返回的 pagination.total 推算，至少 1 页
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
// 「第 x / y 页」：文案里用 {page} / {total} 占位，这里统一替换，5 种语言都能正确组句
const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

async function load() {
  loading.value = true
  try {
    const { products: list, pagination } = await fetchProducts({ page: page.value, page_size: PAGE_SIZE })
    products.value = list
    total.value = Number(pagination?.total) || list.length
  } catch (error) {
    console.error('Failed to load home products:', error)
    products.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 翻页：重新请求对应 page 的数据，并把页面滚回顶部，不让用户停在上一页的列表底部
async function changePage(next) {
  page.value = Number(next) || 1
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await load()
}

onMounted(async () => {
  try {
    categories.value = await fetchCategories()
  } catch (error) {
    console.error('Failed to load categories:', error)
  }
  await load()
})
</script>
<template>
  <div class="home-page">
    <section class="hero container">
      <div class="hero-copy">
        <span class="eyebrow">{{ language.t('heroEyebrow') }}</span>
        <h1>{{ language.t('heroTitle') }}</h1>
        <p>{{ language.t('heroText') }}</p>
        <RouterLink class="button primary" to="/products">{{ language.t('explore') }} <span>&rarr;</span></RouterLink>
      </div>
      <img src="/assets/images/banners/craft-hero.svg" alt="Handcrafted pottery and flowers" fetchpriority="high" />
    </section>
    <CategoryCarousel :categories="categories" />
    <section class="feature-banner container">
      <img src="/assets/images/banners/studio-hero.svg" alt="Craft studio" />
      <div>
        <span class="eyebrow">{{ language.t('featureEyebrow') }}</span>
        <h2>{{ language.t('featureTitle') }}</h2>
        <p>{{ language.t('featureText') }}</p>
        <RouterLink to="/products" class="text-link">{{ language.t('explore') }} &rarr;</RouterLink>
      </div>
    </section>
    <section class="container section last-section">
      <div class="section-heading">
        <h2>{{ language.t('products') }}</h2>
        <p class="section-count">{{ total }} {{ language.t('items') }}</p>
      </div>
      <ProductGridSkeleton v-if="loading" />
      <ProductGrid v-else-if="products.length" :products="products" />
      <EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ language.t('craftedDescription') }}</EmptyState>
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
    </section>
  </div>
</template>
<style scoped>
.section-count { margin: 0; color: var(--muted); font-size: .86rem; font-weight: 600 }
</style>
