<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { products } from '../data/products'
import { useLanguageStore } from '../stores/language'
import ProductGrid from '../components/product/ProductGrid.vue'
import EmptyState from '../components/common/EmptyState.vue'
const route = useRoute(), language = useLanguageStore(); const category = computed(() => route.params.category); const items = computed(() => products.filter(p => p.category === category.value))
</script>
<template><section class="container page"><div class="page-intro"><span class="eyebrow">{{ language.t('category') }}</span><h1>{{ language.category(category) }}</h1><p>{{ items.length }} {{ language.t('items') }} · {{ language.t('handmade') }}</p></div><ProductGrid v-if="items.length" :products="items" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')" /></section></template>
