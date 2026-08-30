<script setup>
import { computed } from 'vue'
import { useLanguageStore } from '../../stores/language'
import PanelSelect from './PanelSelect.vue'

const SORT_ORDER = ['recommended', 'popular', 'newest', 'rating']

const sort = defineModel({ type: String, default: 'recommended' })
const language = useLanguageStore()

const sortOptions = computed(() => [
  { value: 'recommended', label: language.t('recommended') },
  { value: 'popular', label: language.t('popularSort') },
  { value: 'newest', label: language.t('newest') },
  { value: 'rating', label: language.t('highestRating') }
])
</script>
<template>
  <div class="catalog-sort">
    <span class="catalog-sort-label">{{ language.t('sort') }}</span>
    <PanelSelect
      v-model="sort"
      :options="sortOptions"
      :order="SORT_ORDER"
      :aria-label="language.t('sort')"
    />
  </div>
</template>
