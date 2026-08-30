<script setup>
defineProps({ icon: { type: String, default: '✦' }, title: String, action: String })
</script>
<template>
  <section class="empty-state"><div class="empty-icon">{{ icon }}</div><h2>{{ title }}</h2><p><slot /></p><RouterLink v-if="action" class="button primary" to="/products">{{ action }}</RouterLink></section>
</template>
