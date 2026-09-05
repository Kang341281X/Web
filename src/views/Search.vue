<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../stores/language'
import { fetchProducts } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore()
const query = computed(() => String(route.query.q || '').trim())
const results = ref([])
const loading = ref(false)

async function search() {
  if (!query.value) { results.value = []; return }
  loading.value = true
  try {
    const { products } = await fetchProducts({ page: 1, page_size: 100, keyword: query.value })
    results.value = products
  } catch (error) {
    console.error('Search failed:', error)
    results.value = []
  } finally {
    loading.value = false
  }
}

onMounted(search)
watch(query, search)
</script>
<template><section class="container page"><div class="page-intro"><span class="eyebrow">{{ language.t('searchResults') }}</span><h1>{{ query ? `${language.t('resultFor')} "${query}"` : language.t('search') }}</h1><p v-if="query">{{ results.length }} {{ language.t('items') }}</p></div><ProductGrid v-if="results.length" :products="results" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ query ? language.t('craftedDescription') : language.t('searchPlaceholder') }}</EmptyState></section></template>
