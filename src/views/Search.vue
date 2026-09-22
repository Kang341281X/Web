<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../stores/language'
import { fetchProducts } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import EmptyState from '../components/common/EmptyState.vue'

// 每页显示 60 个商品，超出部分自动分到后续页
const PAGE_SIZE = 60

const route = useRoute(), language = useLanguageStore()
const query = computed(() => String(route.query.q || '').trim())
const results = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
// 总页数由接口返回的 pagination.total 推算，至少 1 页
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
// 「第 x / y 页」：文案里用 {page} / {total} 占位，这里统一替换，5 种语言都能正确组句
const pageSummary = computed(() => language.t('pageSummary')
  .replace('{page}', String(page.value))
  .replace('{total}', String(totalPages.value)))

// 输入防抖：停顿 350ms 后才真正发请求，避免每敲一个字符都打一次接口。
// 与 SearchBar.vue 的联想输入共用同一套「setTimeout + 自增序号」手写模式，不引入新依赖。
const SEARCH_DEBOUNCE = 350
let searchTimer = null
// 自增请求序号：每次发请求都带一个，响应回来时只认「当前最新一次」，
// 慢响应若晚于更新的请求到达，这次响应直接作废，不写 results/total
let latestToken = 0

async function search() {
  const token = ++latestToken
  if (!query.value) { results.value = []; total.value = 0; loading.value = false; return }
  loading.value = true
  try {
    const { products, pagination } = await fetchProducts({ page: page.value, page_size: PAGE_SIZE, keyword: query.value })
    if (token !== latestToken) return // 已有更新的请求发出，这次响应作废
    results.value = products
    total.value = Number(pagination?.total) || products.length
  } catch (error) {
    if (token !== latestToken) return
    console.error('Search failed:', error)
    results.value = []
    total.value = 0
  } finally {
    if (token === latestToken) loading.value = false
  }
}

// 翻页：重新请求对应 page 的数据并滚回顶部，让用户明确知道自己在第几页。
// 翻页直接调 search()，不经过防抖——用户点击分页后应当立即响应
async function changePage(next) {
  page.value = Number(next) || 1
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await search()
}

// 换关键词后回到第 1 页，否则可能停在新结果范围之外的页码上。
// 关键词变化走 350ms 防抖；同时立刻作废在途请求并清掉待发的旧防抖，
// 保证「快速输入后立刻清空」时：清空分支同步清结果、旧响应被序号拦截，不会残留上一次的搜索内容。
watch(query, () => {
  clearTimeout(searchTimer)
  latestToken++ // 立刻作废在途请求，防止防抖窗口内旧响应写入已变化的关键词结果
  page.value = 1
  if (!query.value) {
    // 清空关键词：结果立即清掉，不等防抖
    results.value = []
    total.value = 0
    loading.value = false
    return
  }
  searchTimer = setTimeout(search, SEARCH_DEBOUNCE)
})
onMounted(search)
</script>

<template>
  <section class="container page">
    <div class="page-intro">
      <span class="eyebrow">{{ language.t('searchResults') }}</span>
      <h1>{{ query ? `${language.t('resultFor')} "${query}"` : language.t('search') }}</h1>
      <p v-if="query">{{ total }} {{ language.t('items') }}</p>
    </div>
    <ProductGridSkeleton v-if="loading" />
    <ProductGrid v-else-if="results.length" :products="results" />
    <EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ query ? language.t('craftedDescription') : language.t('searchPlaceholder') }}</EmptyState>

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
