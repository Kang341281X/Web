import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 按表格所在区域的实时宽度分配各列，窄屏时保留列的可读下限并允许横向滚动。 */
export function useResponsiveTableWidths(containerRef, ratios, minWidths) {
  const widths = ref([...minWidths])
  let observer

  function update(width = containerRef.value?.clientWidth || 0) {
    if (!width) return

    const minTotal = minWidths.reduce((sum, value) => sum + value, 0)
    if (width <= minTotal) {
      widths.value = [...minWidths]
      return
    }

    const next = Array(ratios.length).fill(0)
    let remainingWidth = width
    let flexible = ratios.map((_, index) => index)
    while (flexible.length) {
      const ratioTotal = flexible.reduce((sum, index) => sum + ratios[index], 0)
      const belowMinimum = flexible.filter(index => remainingWidth * ratios[index] / ratioTotal < minWidths[index])
      if (!belowMinimum.length) {
        for (const index of flexible) next[index] = remainingWidth * ratios[index] / ratioTotal
        break
      }
      for (const index of belowMinimum) {
        next[index] = minWidths[index]
        remainingWidth -= minWidths[index]
      }
      flexible = flexible.filter(index => !belowMinimum.includes(index))
    }

    // Keep the final pixel on the last column so the column widths exactly fill the container.
    const rounded = next.map(Math.floor)
    const used = rounded.reduce((sum, value) => sum + value, 0)
    rounded[rounded.length - 1] += width - used
    widths.value = rounded
  }

  onMounted(() => {
    update()
    if (containerRef.value && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(entries => update(entries[0]?.contentRect.width))
      observer.observe(containerRef.value)
    }
  })

  onBeforeUnmount(() => observer?.disconnect())

  return widths
}
