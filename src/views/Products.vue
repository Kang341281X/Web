<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { toCny } from '../data/currency'
import { useLanguageStore } from '../stores/language'
import { useRoute } from 'vue-router'
import { fetchProducts } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import FilterPanel from '../components/product/FilterPanel.vue'
import EmptyState from '../components/common/EmptyState.vue'

// 每页显示 60 个商品，超出部分自动分到后续页
const PAGE_SIZE = 60

const language = useLanguageStore()
const route = useRoute()
const seller = computed(() => String(route.query.seller || '').trim())
const emptyTitle = computed(() => seller.value ? language.t('sellerEmpty') : language.t('noResults'))
const filters = ref({ category: null, minPriceInput: '', maxPriceInput: '', priceOrderInput: '' })
const sort = ref('recommended')
const appliedPrice = ref({ min: null, max: null, priceOrder: '' })
const products = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
let productsRequestId = 0
// 总页数由接口返回的 pagination.total 推算，至少 1 页
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
// 「第 x / y 页」：文案里用 {page} / {total} 占位，这里统一替换，5 种语言都能正确组句
const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

const priceBounds = computed(() => {
  const min = appliedPrice.value.min != null ? toCny(appliedPrice.value.min, language.locale) : null
  const max = appliedPrice.value.max != null ? toCny(appliedPrice.value.max, language.locale) : null
  return { minCny: min, maxCny: max }
})

async function load() {
  const requestId = ++productsRequestId
  loading.value = true
  try {
    const params = { page: page.value, page_size: PAGE_SIZE, sort: sort.value }
    if (filters.value.keyword) params.keyword = filters.value.keyword
    if (seller.value) params.seller = seller.value
    const { minCny, maxCny } = priceBounds.value
    if (minCny != null) params.min_price = minCny
    if (maxCny != null) params.max_price = maxCny
    // 第二种排列方式：选中价格方向时由价格主导，sort 退为同价商品的次序；未选时不传，完全按 sort 排列
    if (appliedPrice.value.priceOrder) params.price_order = appliedPrice.value.priceOrder
    const { products: list, pagination } = await fetchProducts(params)
    if (requestId !== productsRequestId) return
    total.value = pagination.total
    products.value = list
  } catch (error) {
    if (requestId !== productsRequestId) return
    console.error('Failed to load products:', error)
    products.value = []
    total.value = 0
  } finally {
    if (requestId === productsRequestId) loading.value = false
  }
}

const filtered = computed(() => products.value)

function search() { page.value = 1; load() }

// 翻页：重新请求对应 page 的数据，并把页面滚回顶部，不让用户停在上一页的列表底部
async function changePage(next) {
  page.value = Number(next) || 1
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await load()
}

function onApplyPrice(event) {
  appliedPrice.value = { ...event }
  search()
}

onMounted(load)

watch(sort, () => search())
watch(() => route.query.seller, () => { page.value = 1; load() })
</script>
<template>
  <section class="container page products-page">
    <button class="filter-toggle" @click="$refs.filter?.classList.toggle('open')">☷ {{ language.t('filters') }}</button>
    <div class="catalog-layout">
      <div ref="filter">
        <FilterPanel v-model="filters" v-model:sort="sort" @apply-price="onApplyPrice" />
      </div>
      <ProductGridSkeleton v-if="loading" />
      <ProductGrid v-else-if="filtered.length" :products="filtered" />
      <EmptyState v-else :title="emptyTitle" :action="language.t('continueShopping')">{{ language.t('craftedDescription') }}</EmptyState>
    </div>
    <div v-if="totalPages > 1" class="catalog-pagination">
      <el-pagination v-model:current-page="page" :page-size="PAGE_SIZE" :total="total" :pager-count="5" layout="prev, pager, next" background @current-change="changePage" />
      <p class="catalog-pagination__summary" aria-live="polite">{{ pageSummary }}</p>
    </div>
  </section>
</template>
