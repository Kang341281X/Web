<script setup>
import { computed, ref } from 'vue'
import { languageOptions } from '../../data/translations'
import { useDropdown } from '../../composables/useDropdown'
import { useLanguageStore } from '../../stores/language'

const language = useLanguageStore()
const root = ref(null)
const { open, toggle } = useDropdown(root)

const orderedOptions = computed(() => {
  const current = languageOptions.find(([code]) => code === language.locale)
  return current ? [current, ...languageOptions.filter(([code]) => code !== language.locale)] : languageOptions
})
const choose = locale => {
  language.setLocale(locale)
  open.value = false
}
</script>
<template>
  <div ref="root" class="language-menu">
    <button class="header-action language-trigger" type="button" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
      <span class="header-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/></svg></span>
      <span>{{ language.t('language') }}</span>
    </button>
    <Transition name="language-popover">
      <ul v-if="open" class="language-options" role="listbox" aria-label="Language">
        <li v-for="[code, label] in orderedOptions" :key="code">
          <button type="button" :class="{ active: language.locale === code }" @click="choose(code)">
            <span>{{ label }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
