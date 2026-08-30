<script setup>
import { computed } from 'vue'
import { useFavoritesStore } from '../../stores/favorites'
import { useLanguageStore } from '../../stores/language'
const props = defineProps({ productId: Number }); const favorites = useFavoritesStore(), language = useLanguageStore(); const saved = computed(() => favorites.has(props.productId))
</script>
<template><button class="favorite-button" :class="{ saved }" :aria-label="saved ? language.t('favoriteRemoved') : language.t('favoriteAdded')" @click.prevent.stop="favorites.toggle(productId)">{{ saved ? '♥' : '♡' }}</button></template>
