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
let favoritesRequestId = 0

async function loadFavorites() {
  const requestId = ++favoritesRequestId
  if (!favorites.ids.length) { saved.value = []; loading.value = false; return }
  loading.value = true
  try {
    const results = await Promise.all(favorites.ids.map(id => fetchProduct(id).catch(() => null)))
    if (requestId !== favoritesRequestId) return
    saved.value = results.filter(Boolean)
  } catch (error) {
    if (requestId !== favoritesRequestId) return
    console.error('Failed to load favorites:', error)
    saved.value = []
  } finally {
    if (requestId === favoritesRequestId) loading.value = false
  }
}

onMounted(loadFavorites)
watch(() => favorites.ids.length, loadFavorites)
watch(() => language.locale, loadFavorites)
</script>
<template><section class="container page"><div class="page-intro"><h1>{{ language.t('favorites') }}</h1></div><ProductGridSkeleton v-if="loading" /><ProductGrid v-else-if="saved.length" :products="saved" /><EmptyState v-else-if="!favorites.loading" icon="♡" :title="language.t('emptyFavorites')" :action="language.t('continueShopping')" /></section></template>
