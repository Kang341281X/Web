<script setup>
import { computed, onMounted, ref } from 'vue'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import EmptyState from '../components/common/EmptyState.vue'

const PAGE_SIZE = 60

const language = useLanguageStore()
const products = ref([])
const categories = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

// Group products by category for curated sections
const curatedSections = computed(() => {
  const sections = []
  const categoryMap = new Map()
  products.value.forEach(product => {
    const cat = product.category || 'Other'
    if (!categoryMap.has(cat)) categoryMap.set(cat, [])
    categoryMap.get(cat).push(product)
  })
  categoryMap.forEach((items, category) => {
    if (items.length >= 2) {
      sections.push({ title: language.category(category) || category, products: items.slice(0, 5) })
    }
  })
  // If only 1 section or no grouping, show all as one curated section
  if (sections.length <= 1) {
    return products.value.length > 0
      ? [{ title: language.t('featured') || 'Editor\'s Picks', products: products.value.slice(0, 10) }]
      : []
  }
  return sections.slice(0, 4) // Max 4 curated sections
})

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

    <!-- Category Quick-Entry Horizontal Row -->
    <section v-if="categories.length" class="container etsy-categories">
      <div class="section-heading">
        <h2>{{ language.t('categories') || 'Shop by Category' }}</h2>
      </div>
      <div class="etsy-category-row">
        <RouterLink
          v-for="cat in categories.slice(0, 8)"
          :key="cat.id"
          :to="`/category/${cat.name}`"
          class="etsy-category-chip"
        >
          <span class="etsy-category-icon">{{ cat.icon || '✦' }}</span>
          <span>{{ cat.name }}</span>
        </RouterLink>
      </div>
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
.etsy-categories {
  padding: 28px 0 12px;
}

.etsy-category-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: none;
}

.etsy-category-row::-webkit-scrollbar {
  display: none;
}

.etsy-category-chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--paper);
  color: var(--ink);
  font-size: .85rem;
  font-weight: 500;
  transition: border-color .18s, background .18s, box-shadow .18s;
  white-space: nowrap;
}

.etsy-category-chip:hover {
  border-color: var(--ink);
  background: var(--cream);
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
}

.etsy-category-icon {
  font-size: 1.1rem;
  color: var(--clay);
}

.curated-section {
  padding-top: 40px;
}

.curated-section:first-of-type {
  padding-top: 24px;
}
</style>