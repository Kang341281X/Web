<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { products } from '../data/products'
import { useLanguageStore } from '../stores/language'
import ProductGrid from '../components/product/ProductGrid.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore(); const query = computed(() => String(route.query.q || '').trim().toLowerCase()); const results = computed(() => !query.value ? [] : products.filter(p => [p.title,p.description,p.category,p.seller,...p.tags].join(' ').toLowerCase().includes(query.value)))
</script>
<template><section class="container page"><div class="page-intro"><span class="eyebrow">{{ language.t('searchResults') }}</span><h1>{{ query ? `${language.t('resultFor')} “${query}”` : language.t('search') }}</h1><p v-if="query">{{ results.length }} {{ language.t('items') }}</p></div><ProductGrid v-if="results.length" :products="results" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ query ? language.t('craftedDescription') : language.t('searchPlaceholder') }}</EmptyState></section></template>
