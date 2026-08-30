<script setup>
defineProps({ src: String, alt: { type: String, default: '' } })
const fallback = '/assets/images/placeholders/product-placeholder.svg'
const onError = event => { if (event.target.src !== new URL(fallback, location.origin).href) event.target.src = fallback }
</script>
<template><img :src="src" :alt="alt" loading="lazy" @error="onError" /></template>
