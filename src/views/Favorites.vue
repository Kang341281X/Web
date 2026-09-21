<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useFavoritesStore } from '../stores/favorites'
import { useLanguageStore } from '../stores/language'
import { fetchProduct } from '../services/publicApi'
import ProductGrid from '../components/product/ProductGrid.vue'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton.vue'
import EmptyState from '../components/common/EmptyState.vue'
const favorites = useFavoritesStore(), language = useLanguageStore()
const saved = ref([])
const loading = ref(false)

async function loadFavorites() {
  if (!favorites.ids.length) { saved.value = []; return }
  loading.value = true
  try {
    const results = await Promise.all(favorites.ids.map(id => fetchProduct(id).catch(() => null)))
    saved.value = results.filter(Boolean)
  } catch (error) {
    console.error('Failed to load favorites:', error)
    saved.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadFavorites)
watch(() => favorites.ids.length, loadFavorites)
</script>
<template><section class="container page"><div class="page-intro"><h1>{{ language.t('favorites') }}</h1></div><ProductGridSkeleton v-if="loading" /><ProductGrid v-else-if="saved.length" :products="saved" /><EmptyState v-else-if="!favorites.loading" icon="♡" :title="language.t('emptyFavorites')" :action="language.t('continueShopping')" /></section></template>
