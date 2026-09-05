<script setup>
import { computed, ref } from 'vue'
import { useDropdown } from '../../composables/useDropdown'

const props = defineProps({
  modelValue: { type: [String, Number], default: null, validator: () => true },
  options: { type: Array, required: true },
  order: { type: Array, default: null },
  ariaLabel: { type: String, default: '' },
  fullWidth: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const { open, toggle } = useDropdown(root)

const orderedOptions = computed(() => {
  const current = props.options.find(option => option.value === props.modelValue)
  if (!current) return props.options
  const rest = props.order
    ? props.order.filter(value => value !== props.modelValue).map(value => props.options.find(option => option.value === value)).filter(Boolean)
    : props.options.filter(option => option.value !== props.modelValue)
  return [current, ...rest]
})
const currentLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? '')

const choose = value => {
  open.value = false
  emit('update:modelValue', value)
}
</script>
<template>
  <div ref="root" class="panel-select language-menu" :class="{ 'panel-select-full': fullWidth }">
    <button
      class="panel-select-trigger"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <span>{{ currentLabel }}</span>
    </button>
    <Transition name="language-popover">
      <ul v-if="open" class="language-options panel-select-options" role="listbox" :aria-label="ariaLabel">
        <li v-for="option in orderedOptions" :key="option.value">
          <button type="button" :class="{ active: modelValue === option.value }" @click="choose(option.value)">
            <span>{{ option.label }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
