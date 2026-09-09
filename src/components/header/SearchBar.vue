<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useLanguageStore } from '../../stores/language'
import { products } from '../../data/products'
import { productTitle } from '../../data/translations'
import AppImage from '../common/AppImage.vue'

const router = useRouter(), route = useRoute(), language = useLanguageStore()
const query = ref('')
const root = ref(null), inputRef = ref(null), open = ref(false), showAllHistory = ref(false)
const optionRefs = ref([])
const popoverStyle = ref({})
const history = ref(JSON.parse(localStorage.getItem('craftora-search-history') || '[]'))

const syncQueryFromRoute = () => {
  if (route.path === '/search') query.value = String(route.query.q || '')
}
syncQueryFromRoute()
watch(() => [route.path, route.query.q], syncQueryFromRoute)

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const suggestions = computed(() => {
  if (!normalizedQuery.value) return []
  return products.filter(product => [productTitle(product, language.locale), product.title, product.description, product.category, product.seller, ...product.tags].join(' ').toLowerCase().includes(normalizedQuery.value)).slice(0, 5)
})
const visibleHistory = computed(() => showAllHistory.value ? history.value : history.value.slice(0, 5))
const keyboardOptions = computed(() => normalizedQuery.value
  ? suggestions.value.map(product => ({ type: 'product', value: product }))
  : visibleHistory.value.map(item => ({ type: 'history', value: item })))
const showPopover = computed(() => open.value && (suggestions.value.length || (!normalizedQuery.value && history.value.length)))
const hasOptions = computed(() => showPopover.value && keyboardOptions.value.length > 0)
const activeIndex = ref(-1)
const instanceId = Math.random().toString(36).slice(2, 9)
const listboxId = `search-listbox-${instanceId}`
const activeOptionId = computed(() => activeIndex.value >= 0 ? `search-option-${instanceId}-${activeIndex.value}` : undefined)
const setOptionRef = (el, index) => { el ? optionRefs.value[index] = el : delete optionRefs.value[index] }
const optionId = index => `search-option-${instanceId}-${index}`

const updatePopoverPosition = async () => {
  await nextTick()
  if (!root.value) return
  const rect = root.value.getBoundingClientRect()
  popoverStyle.value = {
    top: `${rect.bottom + (window.innerWidth <= 760 ? 7 : 9)}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`
  }
}

const scrollActiveIntoView = async () => {
  if (activeIndex.value < 0) return
  await nextTick()
  optionRefs.value[activeIndex.value]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

const persistHistory = () => localStorage.setItem('craftora-search-history', JSON.stringify(history.value))
const saveHistory = value => {
  const item = value.trim()
  if (!item) return
  history.value = [item, ...history.value.filter(record => record.toLowerCase() !== item.toLowerCase())].slice(0, 50)
  persistHistory()
}
const submit = () => {
  if (!query.value.trim()) return
  saveHistory(query.value)
  open.value = false
  activeIndex.value = -1
  router.push({ path: '/search', query: { q: query.value.trim() } })
}
const useHistory = item => { query.value = item; submit() }
const useSuggestion = product => {
  query.value = productTitle(product, language.locale)
  saveHistory(query.value)
  open.value = false
  activeIndex.value = -1
  router.push(`/product/${product.id}`)
}
const removeHistory = item => {
  const removedIndex = visibleHistory.value.indexOf(item)
  history.value = history.value.filter(record => record !== item)
  persistHistory()
  if (history.value.length <= 5) showAllHistory.value = false
  if (removedIndex === -1) return
  if (activeIndex.value === removedIndex) activeIndex.value = -1
  else if (activeIndex.value > removedIndex) activeIndex.value--
}
const moveSelection = direction => {
  if (!open.value) open.value = true
  const count = keyboardOptions.value.length
  if (!count) return
  if (activeIndex.value === -1) {
    if (direction === 1) activeIndex.value = 0
    return
  }
  const next = activeIndex.value + direction
  if (next < 0) activeIndex.value = -1
  else if (next >= count) activeIndex.value = count - 1
  else activeIndex.value = next
}
const selectActive = () => {
  const option = keyboardOptions.value[activeIndex.value]
  if (!option) return submit()
  option.type === 'product' ? useSuggestion(option.value) : useHistory(option.value)
}
const clearQuery = () => {
  query.value = ''
  activeIndex.value = -1
  open.value = true
  inputRef.value?.focus()
}
const onInput = () => {
  open.value = true
  updatePopoverPosition()
}
const closeOnOutside = event => {
  if (root.value && !root.value.contains(event.target)) {
    const popover = document.getElementById(listboxId)
    if (popover?.contains(event.target)) return
    open.value = false
    activeIndex.value = -1
  }
}

watch(showPopover, visible => { if (visible) updatePopoverPosition() })
watch(() => [normalizedQuery.value, showAllHistory.value], () => { activeIndex.value = -1; optionRefs.value = [] })
watch(activeIndex, index => { if (index >= 0) scrollActiveIntoView() })

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside)
  window.addEventListener('resize', updatePopoverPosition)
  window.addEventListener('scroll', updatePopoverPosition, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  window.removeEventListener('resize', updatePopoverPosition)
  window.removeEventListener('scroll', updatePopoverPosition, true)
})
</script>
<template>
  <form ref="root" class="search-bar" role="search" @submit.prevent="submit">
    <input
      ref="inputRef"
      v-model="query"
      role="combobox"
      :placeholder="language.t('searchPlaceholder')"
      :aria-label="language.t('search')"
      :aria-expanded="hasOptions"
      :aria-controls="hasOptions ? listboxId : undefined"
      :aria-activedescendant="activeOptionId"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      enterkeyhint="search"
      @focus="open = true; updatePopoverPosition()"
      @input="onInput"
      @keydown.esc="open = false; activeIndex = -1"
      @keydown.down.prevent="moveSelection(1)"
      @keydown.up.prevent="moveSelection(-1)"
      @keydown.enter.prevent="selectActive"
    />
    <button
      v-if="query"
      type="button"
      class="search-clear"
      :aria-label="language.t('clearSearch')"
      @click="clearQuery"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <button type="submit" class="search-submit" :aria-label="language.t('search')">⌕</button>
    <Teleport to="body">
      <section
        v-if="showPopover"
        :id="listboxId"
        class="search-popover search-popover-floating"
        :style="popoverStyle"
        role="listbox"
        :aria-label="normalizedQuery ? language.t('searchSuggestions') : language.t('recentSearches')"
      >
        <template v-if="normalizedQuery && suggestions.length">
          <p class="search-popover-label">{{ language.t('searchSuggestions') }}</p>
          <button
            v-for="(product, index) in suggestions"
            :id="optionId(index)"
            :key="product.id"
            :ref="el => setOptionRef(el, index)"
            type="button"
            role="option"
            class="search-option product-option"
            :class="{ 'keyboard-active': activeIndex === index }"
            :aria-selected="activeIndex === index"
            @click="useSuggestion(product)"
          >
            <AppImage :src="product.image" :alt="productTitle(product, language.locale)" />
            <span><b>{{ productTitle(product, language.locale) }}</b><small>{{ product.seller }}</small></span>
            <i>→</i>
          </button>
        </template>
        <template v-else-if="!normalizedQuery && history.length">
          <p class="search-popover-label">{{ language.t('recentSearches') }}</p>
          <div class="history-list">
            <div
              v-for="(item, index) in visibleHistory"
              :id="optionId(index)"
              :key="item"
              :ref="el => setOptionRef(el, index)"
              role="option"
              class="history-option"
              :class="{ 'keyboard-active': activeIndex === index }"
              :aria-selected="activeIndex === index"
            >
              <button type="button" @click="useHistory(item)"><span>⌕</span>{{ item }}</button>
              <button type="button" class="remove-history" :aria-label="language.t('removeSearch')" @click.stop="removeHistory(item)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
          <button v-if="history.length > 5" type="button" class="history-toggle" @click="showAllHistory = !showAllHistory">{{ showAllHistory ? language.t('collapseSearches') : language.t('showAllSearches') }}</button>
        </template>
      </section>
    </Teleport>
  </form>
</template>
