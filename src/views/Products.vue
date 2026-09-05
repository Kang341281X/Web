<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { toCny } from '../data/currency'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import FilterPanel from '../components/product/FilterPanel.vue'
import SortSelect from '../components/product/SortSelect.vue'
import EmptyState from '../components/common/EmptyState.vue'

const language = useLanguageStore()
const filters = ref({ category: null, minPriceInput: '', maxPriceInput: '', sale: false, isNew: false })
const sort = ref('recommended')
const appliedPrice = ref({ min: null, max: null })
const selectedCategory = ref(null)
const products = ref([])
const categories = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const priceBounds = computed(() => {
  const min = appliedPrice.value.min != null ? toCny(appliedPrice.value.min, language.locale) : null
  const max = appliedPrice.value.max != null ? toCny(appliedPrice.value.max, language.locale) : null
  return { minCny: min, maxCny: max }
})

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize.value, sort: sort.value }
    if (selectedCategory.value != null) params.category_id = selectedCategory.value
    if (filters.value.keyword) params.keyword = filters.value.keyword
    const { minCny, maxCny } = priceBounds.value
    if (minCny != null) params.min_price = minCny
    if (maxCny != null) params.max_price = maxCny
    const { products: list, pagination } = await fetchProducts(params)
    total.value = pagination.total
    // 客户端折扣筛选（后端无此字段筛选）
    let filtered = list
    if (filters.value.sale) filtered = filtered.filter(p => p.originalPrice > p.price)
    products.value = filtered
  } catch (error) {
    console.error('Failed to load products:', error)
    products.value = []
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => products.value)

function search() { page.value = 1; load() }

function onApplyPrice(event) {
  appliedPrice.value = { ...event }
  search()
}

function onSelectCategory(value) {
  selectedCategory.value = value
  search()
}

onMounted(async () => {
  try {
    categories.value = (await fetchCategories()).map(c => ({ ...c, icon: '✦' }))
  } catch (error) {
    console.error('Failed to load categories:', error)
  }
  await load()
})

watch(sort, () => search())
</script>
<template><section class="container page products-page"><div class="page-intro"><span class="eyebrow">{{ language.t('market') }}</span><h1>{{ language.t('products') }}</h1><p>{{ language.t('handmade') }} · {{ total }} {{ language.t('items') }}</p></div><div class="catalog-toolbar"><button class="filter-toggle" @click="$refs.filter?.classList.toggle('open')">☷ {{ language.t('filters') }}</button><p>{{ filtered.length }} {{ language.t('items') }}</p><SortSelect v-model="sort" /></div><div class="catalog-layout"><div ref="filter"><FilterPanel v-model="filters" :categories="categories" @apply-price="onApplyPrice" @select-category="onSelectCategory" /></div><ProductGrid v-if="filtered.length" :products="filtered" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ language.t('craftedDescription') }}</EmptyState></div></section></template>
