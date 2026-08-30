<script setup>
import { categories } from '../../data/categories'
import { useLanguageStore } from '../../stores/language'
const language = useLanguageStore()
</script>
<template><nav class="category-nav" :aria-label="language.t('categories')"><RouterLink v-for="category in categories" :key="category.id" :to="category.id === 'all' ? '/products' : `/category/${category.id}`">{{ language.category(category.id) }}</RouterLink></nav></template>
