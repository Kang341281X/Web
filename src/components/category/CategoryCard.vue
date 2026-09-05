<script setup>
import { useLanguageStore } from '../../stores/language'
defineProps({ category: Object })
const language = useLanguageStore()
</script>
<template><RouterLink :to="`/category/${category.name}`" class="category-card"><span class="category-icon">{{ category.icon || '✦' }}</span><strong>{{ category.name }}</strong><small>{{ language.t('explore') }}</small></RouterLink></template>
