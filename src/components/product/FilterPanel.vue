<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { getCurrency, parsePriceInput } from '../../data/currency'
import { useLanguageStore } from '../../stores/language'
import PanelSelect from './PanelSelect.vue'

const props = defineProps({
  modelValue: Object,
  categories: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'applyPrice', 'selectCategory'])
const language = useLanguageStore()
const filters = ref({ ...props.modelValue })
const priceError = ref('')

let syncing = false
watch(filters, value => {
  if (syncing) return
  emit('update:modelValue', { ...value })
}, { deep: true })
watch(() => props.modelValue, async value => {
  syncing = true
  filters.value = { ...value }
  await nextTick()
  syncing = false
}, { deep: true })

const currency = computed(() => getCurrency(language.locale))

const categoryOptions = computed(() => {
  const allOption = { value: null, label: language.t('all') }
  const catOptions = props.categories.map(c => ({ value: c.id, label: c.name }))
  return [allOption, ...catOptions]
})
const categoryOrder = computed(() => [null, ...props.categories.map(c => c.id)])

const onCategoryChange = value => {
  filters.value.category = value
  emit('update:modelValue', { ...filters.value })
  emit('selectCategory', value)
}

const clear = () => {
  filters.value = { category: null, minPriceInput: '', maxPriceInput: '' }
  priceError.value = ''
  emit('applyPrice', { min: null, max: null })
  emit('selectCategory', null)
}

const applyPrice = () => {
  priceError.value = ''
  const rawMin = filters.value.minPriceInput
  const rawMax = filters.value.maxPriceInput
  const min = parsePriceInput(rawMin)
  const max = parsePriceInput(rawMax)

  // 检测无效值（负值或非数字）
  if ((rawMin !== '' && rawMin != null && min == null) || (rawMax !== '' && rawMax != null && max == null)) {
    priceError.value = language.t('priceErrorInvalid')
    return
  }
  // 检测最低价大于最高价
  if (min != null && max != null && min > max) {
    priceError.value = language.t('priceErrorMinGreater')
    return
  }
  emit('applyPrice', { min, max })
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
        :model-value="filters.category"
        :options="categoryOptions"
        :order="categoryOrder"
        :aria-label="language.t('category')"
        full-width
        @update:model-value="onCategoryChange"
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
      <p v-if="priceError" class="price-error">{{ priceError }}</p>
    </div>
  </aside>
</template>
