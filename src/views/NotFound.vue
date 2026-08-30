<script setup>import { useLanguageStore } from '../stores/language'; import EmptyState from '../components/common/EmptyState.vue'; const language=useLanguageStore()</script>
<template><section class="container page"><EmptyState icon="404" :title="language.t('productNotFound')" :action="language.t('backHome')" /></section></template>
