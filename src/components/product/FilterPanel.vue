<script setup>
import { computed, ref, watch } from 'vue'
import { categories } from '../../data/categories'
import { getCurrency, parsePriceInput } from '../../data/currency'
import { useLanguageStore } from '../../stores/language'
import PanelSelect from './PanelSelect.vue'

const props = defineProps({ modelValue: Object })
const emit = defineEmits(['update:modelValue'])
const language = useLanguageStore()
const filters = ref({ ...props.modelValue })

watch(filters, value => emit('update:modelValue', { ...value }), { deep: true })
watch(() => props.modelValue, value => { filters.value = { ...value } }, { deep: true })

const categoryOptions = computed(() => categories.map(c => ({ value: c.id, label: language.category(c.id) })))
const categoryOrder = computed(() => categories.map(c => c.id))
const currency = computed(() => getCurrency(language.locale))

const clear = () => {
  filters.value = { category: 'all', minPriceInput: '', maxPriceInput: '', sale: false, isNew: false }
}

const onMinInput = () => {
  const min = parsePriceInput(filters.value.minPriceInput)
  const max = parsePriceInput(filters.value.maxPriceInput)
  if (min != null && max != null && min > max) {
    filters.value.maxPriceInput = filters.value.minPriceInput
  }
}

const onMaxInput = () => {
  const min = parsePriceInput(filters.value.minPriceInput)
  const max = parsePriceInput(filters.value.maxPriceInput)
  if (min != null && max != null && max < min) {
    filters.value.minPriceInput = filters.value.maxPriceInput
  }
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
              @input="onMinInput"
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
              @input="onMaxInput"
            />
          </div>
        </label>
      </div>
    </div>
    <label class="check-label"><input v-model="filters.sale" type="checkbox" /> {{ language.t('discount') }}</label>
    <label class="check-label"><input v-model="filters.isNew" type="checkbox" /> {{ language.t('newOnly') }}</label>
  </aside>
</template>
