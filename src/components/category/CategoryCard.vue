<script setup>
import { useLanguageStore } from '../../stores/language'
defineProps({ category: Object })
const language = useLanguageStore()
</script>
<template><RouterLink :to="`/category/${category.id}`" class="category-card"><span class="category-icon">{{ category.icon }}</span><strong>{{ language.category(category.id) }}</strong><small>{{ language.t('explore') }}</small></RouterLink></template>
