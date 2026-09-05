<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../stores/language'
import { fetchProducts, fetchCategories } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore()
const categoryName = computed(() => route.params.category)
const items = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    // categoryName is the category name (string slug from URL), find matching category
    const categories = await fetchCategories()
    const cat = categories.find(c => c.name === categoryName.value)
    if (!cat) { items.value = []; return }
    const { products } = await fetchProducts({ page: 1, page_size: 100, category_id: cat.id })
    items.value = products
  } catch (error) {
    console.error('Failed to load category products:', error)
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params.category, load)
</script>
<template><section class="container page"><div class="page-intro"><span class="eyebrow">{{ language.t('category') }}</span><h1>{{ language.category(categoryName) }}</h1><p>{{ items.length }} {{ language.t('items') }} · {{ language.t('handmade') }}</p></div><ProductGrid v-if="items.length" :products="items" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')" /></section></template>
