<script setup>
// 列表页加载占位：复用 .product-grid 布局，渲染 N 个骨架卡片（默认 8 个，与首页/分类页 1 页商品数对齐）。
// 与 EmptyState 配合使用：loading=true 时显示本组件；loading=false 且数据为空时才显示 EmptyState。
defineProps({ count: { type: Number, default: 8 } })
</script>

<template>
  <div class="product-grid" role="status" aria-busy="true" aria-label="加载中">
    <div v-for="n in count" :key="n" class="product-skeleton-card" aria-hidden="true">
      <div class="skeleton-shimmer skeleton-image" />
      <div class="skeleton-shimmer skeleton-line" style="width: 78%" />
      <div class="skeleton-shimmer skeleton-line short" style="width: 42%" />
      <div class="skeleton-shimmer skeleton-line" style="width: 56%" />
    </div>
  </div>
</template>