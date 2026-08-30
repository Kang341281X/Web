<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useLanguageStore } from '../../stores/language'

const visible = ref(false)
const language = useLanguageStore()
const updateVisibility = () => { visible.value = window.scrollY > 280 }
const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

onMounted(() => { updateVisibility(); window.addEventListener('scroll', updateVisibility, { passive: true }) })
onBeforeUnmount(() => window.removeEventListener('scroll', updateVisibility))
</script>

<template>
  <Transition name="back-to-top"><button v-show="visible" class="back-to-top" type="button" :aria-label="language.t('top')" @click="scrollToTop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 13 6-6 6 6M12 8v10"/></svg><span>{{ language.t('top') }}</span></button></Transition>
</template>
