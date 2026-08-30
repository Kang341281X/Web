import { onBeforeUnmount, onMounted, ref } from 'vue'

const dropdowns = new Map()
let listenerReady = false

const ensureListener = () => {
  if (listenerReady || typeof document === 'undefined') return
  listenerReady = true
  document.addEventListener('pointerdown', event => {
    dropdowns.forEach(({ root, open }) => {
      if (!open.value || !root.value) return
      if (!root.value.contains(event.target)) open.value = false
    })
  }, true)
}

export function useDropdown(root) {
  const open = ref(false)
  const id = Symbol('dropdown')

  const toggle = () => {
    if (!open.value) {
      dropdowns.forEach((entry, otherId) => {
        if (otherId !== id) entry.open.value = false
      })
    }
    open.value = !open.value
  }
  const close = () => { open.value = false }

  onMounted(() => {
    ensureListener()
    dropdowns.set(id, { root, open })
  })
  onBeforeUnmount(() => {
    dropdowns.delete(id)
  })

  return { open, toggle, close }
}
