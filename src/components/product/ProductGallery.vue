<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ product: { type: Object, default: null } })

const AUTOPLAY_MS = 5000
const PLACEHOLDER = '/assets/images/placeholders/product-placeholder.svg'
// 尊重系统「减弱动态效果」偏好：不自动轮播（避免诱导性动画）
const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const images = computed(() => {
  const list = props.product?.images
  return Array.isArray(list) && list.length ? list : [PLACEHOLDER]
})
const count = computed(() => images.value.length)
const title = computed(() => props.product?.title || '')
const active = ref(0)
const isPaused = ref(false)
let timer = null

function stopAuto() {
  if (timer) { clearInterval(timer); timer = null }
}
function startAuto() {
  stopAuto()
  if (count.value > 1 && !reduceMotion && !isPaused.value) timer = setInterval(next, AUTOPLAY_MS)
}
function restart() {
  startAuto()
}
function manualGo(index) {
  active.value = Math.min(Math.max(index, 0), count.value - 1)
  restart() // 手动切换后重置 5 秒计时，避免刚切完又被自动轮播打断
}
function next() { if (count.value > 1) manualGo((active.value + 1) % count.value) }
function prev() { if (count.value > 1) manualGo((active.value - 1 + count.value) % count.value) }
function pauseAuto() { isPaused.value = true; stopAuto() }
function resumeAuto() { isPaused.value = false; startAuto() }

// 移动端横向滑动切换（简单手势，不引入第三方库）
let touchStart = null
function onTouchStart(event) {
  pauseAuto()
  const t = event.touches[0]
  touchStart = { x: t.clientX, y: t.clientY }
}
function onTouchEnd(event) {
  if (touchStart) {
    const t = event.changedTouches[0]
    const dx = t.clientX - touchStart.x
    const dy = t.clientY - touchStart.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) (dx < 0 ? next() : prev())
    touchStart = null
  }
  resumeAuto()
}

// 商品切换（详情页路由变化复用同一实例时）或 images 变化后回到第一张并重开轮播
watch(images, () => { active.value = 0; isPaused.value = false; restart() }, { immediate: true })

onUnmounted(stopAuto)
</script>
<template>
  <div class="gallery" @mouseenter="pauseAuto" @mouseleave="resumeAuto" @focusin="pauseAuto" @focusout="resumeAuto">
    <div
      class="gallery-main"
      role="group"
      :aria-label="`${title} 图片`"
      :aria-roledescription="count > 1 ? '图片轮播' : undefined"
      :tabindex="count > 1 ? 0 : -1"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @touchcancel.passive="onTouchEnd"
      @keydown.left.prevent="prev"
      @keydown.right.prevent="next"
    >
      <Transition name="gallery-fade" mode="out-in">
        <AppImage class="gallery-slide" :key="active" :src="images[active]" :alt="count > 1 ? `${title} ${active + 1}` : title" />
      </Transition>
    </div>
    <div v-if="count > 1" class="gallery-thumbs">
      <button type="button" class="gallery-arrow gallery-arrow--prev" aria-label="上一张图片" @click="prev">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div class="gallery-thumbs__track">
        <button v-for="(image, index) in images" :key="image || index" type="button" class="gallery-thumb" :class="{ active: index === active }" :aria-label="`查看第 ${index + 1} 张图片`" :aria-current="index === active ? 'true' : undefined" @click="manualGo(index)">
          <AppImage :src="image" :alt="`${title} ${index + 1}`" />
        </button>
      </div>
      <button type="button" class="gallery-arrow gallery-arrow--next" aria-label="下一张图片" @click="next">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  </div>
</template>
