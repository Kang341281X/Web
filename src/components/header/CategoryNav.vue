<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '../../stores/language'
import { fetchCategories } from '../../services/publicApi'
const language = useLanguageStore()
const route = useRoute()
const categories = ref([{ id: 'all', name: '全部', icon: '✦' }])
const activeCategoryId = computed(() => route.path === '/products' ? 'all' : route.params.category || '')

onMounted(async () => {
  try {
    const cats = await fetchCategories()
    categories.value = [{ id: 'all', name: '全部', icon: '✦' }, ...cats.map(c => ({ ...c, icon: '✦' }))]
  } catch (error) {
    console.error('Failed to load categories:', error)
  }
})
</script>
<template><nav class="category-nav" :aria-label="language.t('categories')"><RouterLink v-for="category in categories" :key="category.id" :class="{ 'is-current': String(activeCategoryId) === String(category.id === 'all' ? 'all' : category.name) }" :aria-current="String(activeCategoryId) === String(category.id === 'all' ? 'all' : category.name) ? 'page' : undefined" :to="category.id === 'all' ? '/products' : `/category/${category.name}`">{{ category.id === 'all' ? language.t('all') : category.name }}</RouterLink></nav></template>
