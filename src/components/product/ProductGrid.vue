<script setup>
import ProductCard from './ProductCard.vue'
defineProps({ products: Array })
</script>
<template><div class="product-grid"><ProductCard v-for="product in products" :key="product.id" :product="product" /></div></template>
