<script setup>
import { computed, ref } from 'vue'
import { products } from '../data/products'
import { toCny } from '../data/currency'
import { useLanguageStore } from '../stores/language'
import ProductGrid from '../components/product/ProductGrid.vue'
import FilterPanel from '../components/product/FilterPanel.vue'
import SortSelect from '../components/product/SortSelect.vue'
import EmptyState from '../components/common/EmptyState.vue'

const language = useLanguageStore()
const filters = ref({ category: 'all', minPriceInput: '', maxPriceInput: '', sale: false, isNew: false })
const sort = ref('recommended')
const appliedPrice = ref({ min: null, max: null })

const priceBounds = computed(() => {
  const min = appliedPrice.value.min != null ? toCny(appliedPrice.value.min, language.locale) : null
  const max = appliedPrice.value.max != null ? toCny(appliedPrice.value.max, language.locale) : null
  return { minCny: min, maxCny: max }
})

const filtered = computed(() => {
  const { minCny, maxCny } = priceBounds.value
  let items = products.filter(p =>
    (filters.value.category === 'all' || p.category === filters.value.category) &&
    (minCny == null || p.price >= minCny) &&
    (maxCny == null || p.price <= maxCny) &&
    (!filters.value.sale || p.originalPrice > p.price) &&
    (!filters.value.isNew || p.badge === '新品')
  )
  return [...items].sort((a, b) =>
    sort.value === 'popular' ? b.sales - a.sales :
    sort.value === 'newest' ? b.createdAt - a.createdAt :
    sort.value === 'rating' ? b.rating - a.rating : 0
  )
})
</script>
<template><section class="container page products-page"><div class="page-intro"><span class="eyebrow">{{ language.t('market') }}</span><h1>{{ language.t('products') }}</h1><p>{{ language.t('handmade') }} · {{ products.length }} {{ language.t('items') }}</p></div><div class="catalog-toolbar"><button class="filter-toggle" @click="$refs.filter?.classList.toggle('open')">☷ {{ language.t('filters') }}</button><p>{{ filtered.length }} {{ language.t('items') }}</p><SortSelect v-model="sort" /></div><div class="catalog-layout"><div ref="filter"><FilterPanel v-model="filters" @apply-price="appliedPrice = $event" /></div><ProductGrid v-if="filtered.length" :products="filtered" /><EmptyState v-else :title="language.t('noResults')" :action="language.t('continueShopping')">{{ language.t('craftedDescription') }}</EmptyState></div></section></template>
