<script setup>
import { computed, ref, watch } from 'vue'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ product: { type: Object, default: null } })

const PLACEHOLDER = '/assets/images/placeholders/product-placeholder.svg'
// 尊重系统「减弱动态效果」偏好：悬停放大镜属于动态效果，此偏好下禁用
const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const images = computed(() => {
  const list = props.product?.images
  return Array.isArray(list) && list.length ? list : [PLACEHOLDER]
})
const count = computed(() => images.value.length)
const title = computed(() => props.product?.title || '')
const active = ref(0)

// 桌面端主图悬停放大镜：鼠标位置决定放大中心，跟随鼠标位移（transform-origin 百分比）
const zooming = ref(false)
const zoomX = ref(50)
const zoomY = ref(50)
const zoomStyle = computed(() => ({ '--zoom-x': `${zoomX.value}%`, '--zoom-y': `${zoomY.value}%` }))

function updateZoom(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  zoomX.value = ((event.clientX - rect.left) / rect.width) * 100
  zoomY.value = ((event.clientY - rect.top) / rect.height) * 100
}
function onMainEnter(event) {
  if (reduceMotion) return
  zooming.value = true
  updateZoom(event)
}
function onMainMove(event) {
  if (!zooming.value) return
  updateZoom(event)
}
function onMainLeave() { zooming.value = false }

// 完全手动切换：缩略图点击 / 箭头 / 键盘左右键共同驱动，无自动轮播
function manualGo(index) { active.value = Math.min(Math.max(index, 0), count.value - 1) }
function next() { if (count.value > 1) active.value = (active.value + 1) % count.value }
function prev() { if (count.value > 1) active.value = (active.value - 1 + count.value) % count.value }

// 移动端私图横向滑动切换（简单手势，不引入第三方库）
let touchStart = null
function onTouchStart(event) {
  const t = event.touches[0]
  touchStart = { x: t.clientX, y: t.clientY }
}
function onTouchEnd(event) {
  if (!touchStart) return
  const t = event.changedTouches[0]
  const dx = t.clientX - touchStart.x
  const dy = t.clientY - touchStart.y
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) (dx < 0 ? next() : prev())
  touchStart = null
}

// 商品切换（详情页路由变化复用同一实例时）或 images 变化后回到第一张
watch(images, () => { active.value = 0 }, { immediate: true })
</script>

<template>
  <div class="gallery">
    <div
      class="gallery-main"
      :class="{ 'is-zooming': zooming }"
      :style="zoomStyle"
      role="group"
      :aria-label="`${title} 图片`"
      :aria-roledescription="count > 1 ? '图片集' : undefined"
      :tabindex="count > 1 ? 0 : -1"
      @mousemove="onMainMove"
      @mouseenter="onMainEnter"
      @mouseleave="onMainLeave"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @touchcancel.passive="onTouchEnd"
      @keydown.left.prevent="prev"
      @keydown.right.prevent="next"
    >
      <Transition name="gallery-fade" mode="out-in">
        <AppImage class="gallery-slide" :key="active" :src="images[active]" :alt="count > 1 ? `${title} ${active + 1}` : title" />
      </Transition>
      <button v-if="count > 1" type="button" class="gallery-arrow gallery-arrow--prev" aria-label="上一张图片" @click="prev">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <button v-if="count > 1" type="button" class="gallery-arrow gallery-arrow--next" aria-label="下一张图片" @click="next">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
    <div v-if="count > 1" class="gallery-thumbs">
      <button
        v-for="(image, index) in images"
        :key="image || index"
        type="button"
        class="gallery-thumb"
        :class="{ active: index === active }"
        :aria-label="`查看第 ${index + 1} 张图片`"
        :aria-current="index === active ? 'true' : undefined"
        @click="manualGo(index)"
      >
        <AppImage :src="image" :alt="`${title} ${index + 1}`" />
      </button>
    </div>
  </div>
</template>