import { ref } from 'vue'

// 顶部路由进度条的全局共享状态。
// 用模块级 ref 而不是 Pinia store：这是一次性的导航视觉反馈，不需要持久化 / devtools / 跨组件业务读写，
// 与 useIsMobile、useQuantityFeedback 等项目内轻量 composable 保持同一风格。
const active = ref(false)

// 导航开始 150ms 后才显示：同 chunk / 已缓存的快速导航不闪条
const SHOW_DELAY = 150
// 显示出来后至少停留 200ms：避免「刚冒头就消失」的突兀感
const MIN_SHOWN = 200
let showTimer = null
let hideTimer = null
let shownAt = 0

function start() {
  // 接管进度条：先取消上一次尚未执行的收起——快速连点导航时，被取消的那次导航
  // 可能已经通过 afterEach(failure) 调了 finish() 并排下了收起计时，不能让它把新导航的进度条收掉
  clearTimeout(hideTimer)
  clearTimeout(showTimer)
  showTimer = setTimeout(() => { active.value = true; shownAt = Date.now() }, SHOW_DELAY)
}

function finish() {
  clearTimeout(showTimer)
  // 还没到显示阈值导航就完成了：条从未出现，直接结束
  if (!active.value) return
  // 已经显示：保证最短展示时长后再收起
  const remaining = Math.max(0, MIN_SHOWN - (Date.now() - shownAt))
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { active.value = false }, remaining)
}

export function useRouteProgress() {
  return { active, start, finish }
}