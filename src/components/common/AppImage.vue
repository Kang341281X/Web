<script setup>
import { onImgError, resolve } from '../../utils/image'
defineProps({ src: String, alt: { type: String, default: '' } })
</script>
<template><img :src="resolve(src)" :alt="alt" loading="lazy" @error="onImgError" /></template>
