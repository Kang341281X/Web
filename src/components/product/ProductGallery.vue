<script setup>
import { ref } from 'vue'
import AppImage from '../common/AppImage.vue'
const props = defineProps({ product: Object }); const active = ref(0)
</script>
<template><div class="gallery"><div class="gallery-main"><AppImage :src="product.images[active]" :alt="product.title" /></div><div class="gallery-thumbs"><button v-for="(image,index) in product.images" :key="image" :class="{ active: active === index }" @click="active=index"><AppImage :src="image" :alt="`${product.title} ${index+1}`" /></button></div></div></template>
