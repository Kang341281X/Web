<script setup>
import { computed, ref, watch } from 'vue'
import { categories } from '../../data/categories'
import { getCurrency, parsePriceInput } from '../../data/currency'
import { useLanguageStore } from '../../stores/language'
import PanelSelect from './PanelSelect.vue'

const props = defineProps({ modelValue: Object })
const emit = defineEmits(['update:modelValue', 'applyPrice'])
const language = useLanguageStore()
const filters = ref({ ...props.modelValue })

watch(filters, value => emit('update:modelValue', { ...value }), { deep: true })
watch(() => props.modelValue, value => { filters.value = { ...value } }, { deep: true })

const categoryOptions = computed(() => categories.map(c => ({ value: c.id, label: language.category(c.id) })))
const categoryOrder = computed(() => categories.map(c => c.id))
const currency = computed(() => getCurrency(language.locale))

const clear = () => {
  filters.value = { category: 'all', minPriceInput: '', maxPriceInput: '', sale: false, isNew: false }
  emit('applyPrice', { min: null, max: null })
}

const applyPrice = () => {
  const min = parsePriceInput(filters.value.minPriceInput)
  const max = parsePriceInput(filters.value.maxPriceInput)
  let finalMin = min
  let finalMax = max
  if (min != null && max != null && min > max) {
    finalMin = max
    finalMax = min
    filters.value.minPriceInput = finalMin != null ? String(finalMin) : ''
    filters.value.maxPriceInput = finalMax != null ? String(finalMax) : ''
  }
  emit('applyPrice', { min: finalMin, max: finalMax })
}
</script>
<template>
  <aside class="filter-panel">
    <div class="filter-heading">
      <h3>{{ language.t('filters') }}</h3>
      <button @click="clear">{{ language.t('clear') }}</button>
    </div>
    <label class="filter-field">
      <span>{{ language.t('category') }}</span>
      <PanelSelect
        v-model="filters.category"
        :options="categoryOptions"
        :order="categoryOrder"
        :aria-label="language.t('category')"
        full-width
      />
    </label>
    <div class="filter-field filter-price">
      <span>{{ language.t('priceRange') }}</span>
      <div class="price-input-grid">
        <label class="price-input-field">
          <small>{{ language.t('minPriceLabel') }}</small>
          <div class="price-input-wrap">
            <span class="price-input-symbol">{{ currency.symbol }}</span>
            <input
              v-model="filters.minPriceInput"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :placeholder="language.t('priceInputPlaceholder')"
            />
          </div>
        </label>
        <label class="price-input-field">
          <small>{{ language.t('maxPriceLabel') }}</small>
          <div class="price-input-wrap">
            <span class="price-input-symbol">{{ currency.symbol }}</span>
            <input
              v-model="filters.maxPriceInput"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :placeholder="language.t('priceInputPlaceholder')"
            />
          </div>
        </label>
      </div>
      <button class="price-confirm-button" type="button" @click="applyPrice">{{ language.t('confirmPrice') }}</button>
    </div>
    <label class="check-label"><input v-model="filters.sale" type="checkbox" /> {{ language.t('discount') }}</label>
    <label class="check-label"><input v-model="filters.isNew" type="checkbox" /> {{ language.t('newOnly') }}</label>
  </aside>
</template>
