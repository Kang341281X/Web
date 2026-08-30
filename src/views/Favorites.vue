<script setup>
import { computed } from 'vue'
import { products } from '../data/products'
import { useFavoritesStore } from '../stores/favorites'
import { useLanguageStore } from '../stores/language'
import ProductGrid from '../components/product/ProductGrid.vue'
import EmptyState from '../components/common/EmptyState.vue'
const favorites = useFavoritesStore(), language = useLanguageStore(); const saved = computed(() => products.filter(p => favorites.ids.includes(p.id)))
</script>
<template><section class="container page"><div class="page-intro"><span class="eyebrow">{{ language.t('savedPieces') }}</span><h1>{{ language.t('favorites') }}</h1><p>{{ saved.length }} {{ language.t('items') }}</p></div><ProductGrid v-if="saved.length" :products="saved" /><EmptyState v-else icon="♡" :title="language.t('emptyFavorites')" :action="language.t('continueShopping')" /></section></template>
