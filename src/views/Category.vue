<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18nTitle } from '../composables/useI18nTitle'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import FilterPanel from '../components/product/FilterPanel.vue'
import SortSelect from '../components/product/SortSelect.vue'
import EmptyState from '../components/common/EmptyState.vue'

// 每页显示 60 个商品，超出部分自动分到后续页
const PAGE_SIZE = 60

const route = useRoute(), language = useLanguageStore()
const categoryName = computed(() => route.params.category)
const items = ref([])
const categories = ref([])
// 分类页标题：路由参数即分类名（由 CategoryNav / Header 等按 /category/${c.name} 生成）；
// App.vue 在 /category/ 前缀下不设置 document.title，避免被覆盖。
useI18nTitle(() => categoryName.value)
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const sort = ref('recommended')
const filters = ref({ category: null, minPriceInput: '', maxPriceInput: '' })
const appliedPrice = ref({ min: null, max: null })
// 总页数由接口返回的 pagination.total 推算，至少 1 页
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
// 「第 x / y 页」：文案里用 {page} / {total} 占位，这里统一替换，5 种语言都能正确组句
const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

// 分类页按当前路由分类筛选，价格区间在前端过滤（与商品列表页一致）
const filtered = computed(() => {
  const { min, max } = appliedPrice.value
  return items.value.filter(p =>
    (min == null || p.price >= min) &&
    (max == null || p.price <= max)
  )
})

async function load() {
  loading.value = true
  try {
    // categoryName is the category name (string slug from URL), find matching category
    const allCategories = await fetchCategories()
    categories.value = allCategories
    const cat = allCategories.find(c => c.name === categoryName.value)
    if (!cat) { items.value = []; total.value = 0; return }
    const { products, pagination } = await fetchProducts({ page: page.value, page_size: PAGE_SIZE, category_id: cat.id, sort: sort.value })
    items.value = products
    total.value = Number(pagination?.total) || products.length
  } catch (error) {
    console.error('Failed to load category products:', error)
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onApplyPrice(range) {
  appliedPrice.value = range
  page.value = 1
}

function onSelectCategory() {
  // 分类页已按路由锁定分类，此处不做跳转
}

// 翻页：重新请求对应 page 的数据，并把页面滚回顶部，不让用户停在上一页的列表底部
async function changePage(next) {
  page.value = Number(next) || 1
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await load()
}

// 切换分类时回到第 1 页，否则会拿着上一个分类的页码去请求新分类
watch(() => route.params.category, () => { page.value = 1; appliedPrice.value = { min: null, max: null }; filters.value = { category: null, minPriceInput: '', maxPriceInput: '' }; load() })
watch(sort, () => load())
onMounted(load)
</script>

<template>
  <section class="container page category-page">
    <div class="page-intro"><h1>{{ language.category(categoryName) }}</h1></div>
    <div class="catalog-toolbar">
      <button class="filter-toggle" @click="$refs.filter?.classList.toggle('open')">☷ {{ language.t('filters') }}</button>
      <p><strong>{{ total }}</strong> {{ language.t('items') }}</p>
      <SortSelect v-model="sort" />
    </div>
    <div class="catalog-layout">
      <div ref="filter">
        <FilterPanel v-model="filters" :categories="categories" @apply-price="onApplyPrice" @select-category="onSelectCategory" />
      </div>
      <ProductGridSkeleton v-if="loading" />
      <ProductGrid v-else-if="filtered.length" :products="filtered" />
      <EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ language.t('craftedDescription') }}</EmptyState>
    </div>

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
</template>