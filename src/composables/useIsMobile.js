import { onUnmounted, ref } from 'vue'

/**
 * 移动端断点检测（默认 ≤768px，与 AdminLayout 移动端抽屉的断点口径一致）。
 * matchMedia + change 事件实时响应宽度跨界，不轮询 window.innerWidth；
 * 必须在组件 setup 中调用，组件卸载时自动移除监听。
 */
export function useIsMobile(maxWidth = 768) {
  const query = window.matchMedia(`(max-width: ${maxWidth}px)`)
  const isMobile = ref(query.matches)
  const onChange = e => { isMobile.value = e.matches }
  query.addEventListener('change', onChange)
  onUnmounted(() => query.removeEventListener('change', onChange))
  return isMobile
}
