<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useLanguageStore } from '../../stores/language'
import AppImage from '../common/AppImage.vue'

const language = useLanguageStore()

const props = defineProps({
  categories: { type: Array, default: () => [] },
})

// 参与轮播的分类：顶级分类（parent_id=0），按 sort_order 升序；未上传图片的分类自动显示统一占位图
const carouselList = computed(() =>
  props.categories
    .filter(c => !c.parent_id)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
)

// 少于 5 个时静态展示，不滚动
const shouldCarousel = computed(() => carouselList.value.length >= 5)

// 复制一份用于无缝循环
const displayList = computed(() =>
  shouldCarousel.value ? [...carouselList.value, ...carouselList.value] : carouselList.value
)

const trackRef = ref(null)
const offset = ref(0)
let stepCount = 0 // 已走过的步数
let timer = null
let isPaused = false
// 触摸滑动：记录起始坐标与起始位移，拖动时暂停自动轮播，松手后吸附到最近卡片
let touchStartX = 0
let touchStartY = 0
let touchStartOffset = 0
let dragging = false

function stepForward() {
  if (isPaused || !trackRef.value || !shouldCarousel.value) return
  const track = trackRef.value
  const firstCard = track.firstElementChild
  if (!firstCard) return
  const stepWidth = firstCard.offsetWidth + 18 // card-w + gap
  const originalCount = carouselList.value.length

  stepCount++
  offset.value -= stepWidth

  // 走完一轮原始列表数量时，瞬间重置回 0（无动画）
  if (stepCount >= originalCount) {
    // 先用动画走完这一步
    track.style.transition = 'transform 1s ease'
    track.style.transform = `translateX(${offset.value}px)`
    // 1s 动画结束后瞬间重置
    clearTimeout(stepForward._resetTimer)
    stepForward._resetTimer = setTimeout(() => {
      offset.value = 0
      stepCount = 0
      track.style.transition = 'none'
      track.style.transform = 'translateX(0)'
    }, 1050)
    return
  }

  // 正常切换：1s 动画
  track.style.transition = 'transform 1s ease'
  track.style.transform = `translateX(${offset.value}px)`
}

function startTimer() {
  stopTimer()
  if (!shouldCarousel.value) return
  // 静止 3s + 切换 1s = 4s 一个周期
  timer = setInterval(stepForward, 4000)
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
  clearTimeout(stepForward._resetTimer)
}

function handleEnter() { isPaused = true }
function handleLeave() { isPaused = false }

// 单张卡片步进宽度（卡片宽 + 间距），供触摸吸附与自动轮播共用
function getStepWidth() {
  const track = trackRef.value
  if (!track || !track.firstElementChild) return 0
  return track.firstElementChild.offsetWidth + 18
}

function onTouchStart(e) {
  if (!shouldCarousel.value || !trackRef.value || !e.touches.length) return
  isPaused = true
  dragging = true
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  touchStartOffset = offset.value
  trackRef.value.style.transition = 'none'
}
function onTouchMove(e) {
  if (!dragging || !trackRef.value || !e.touches.length) return
  const dx = e.touches[0].clientX - touchStartX
  const dy = e.touches[0].clientY - touchStartY
  // 横向意图明显时阻止页面纵向滚动，让手势专注切换分类
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) e.preventDefault()
  offset.value = touchStartOffset + dx
  trackRef.value.style.transform = `translateX(${offset.value}px)`
}
function onTouchEnd() {
  if (!dragging) return
  dragging = false
  const track = trackRef.value
  const stepWidth = getStepWidth()
  const originalCount = carouselList.value.length
  if (!track || !stepWidth || originalCount < 1) { isPaused = false; return }
  // 松手后吸附到最近的一张卡片，并把 stepCount 对齐，保证后续自动轮播无缝衔接
  const nearest = Math.max(0, Math.min(originalCount - 1, Math.round(-offset.value / stepWidth)))
  offset.value = -nearest * stepWidth
  stepCount = nearest
  track.style.transition = 'transform .35s ease'
  track.style.transform = `translateX(${offset.value}px)`
  // 短暂停顿后恢复自动轮播
  setTimeout(() => { isPaused = false }, 1600)
}

// 数据变化时重置
watch(() => props.categories, () => {
  offset.value = 0
  stepCount = 0
  if (trackRef.value) {
    trackRef.value.style.transition = 'none'
    trackRef.value.style.transform = 'translateX(0)'
  }
  nextTick(() => { stopTimer(); startTimer() })
}, { flush: 'post' })

onMounted(() => { startTimer() })
onUnmounted(() => { stopTimer() })
</script>

<template>
  <section v-if="displayList.length" class="category-carousel-section">
    <div class="container">
      <div class="section-heading">
        <div>
          <span class="eyebrow">{{ language.t('featuredCategoriesEyebrow') }}</span>
          <h2>{{ language.t('categories') }}</h2>
        </div>
      </div>
      <div
        class="category-carousel"
        @mouseenter="handleEnter"
        @mouseleave="handleLeave"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <div ref="trackRef" class="category-carousel-track" :class="{ 'is-static': !shouldCarousel }">
          <RouterLink
            v-for="(cat, idx) in displayList"
            :key="idx"
            :to="`/category/${cat.name}`"
            class="category-carousel-card"
          >
            <div class="category-carousel-image">
              <AppImage :src="cat.image_url" :alt="cat.name" />
            </div>
            <div class="category-carousel-label">
              <strong>{{ cat.name }}</strong>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.category-carousel-section {
  padding: 40px 0;
  overflow: hidden;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.section-heading .eyebrow {
  display: block;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--clay);
  margin-bottom: 4px;
}
.section-heading h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}
.category-carousel {
  overflow: hidden;
  width: 100%;
}
.category-carousel-track {
  display: flex;
  gap: 18px;
  width: max-content;
  will-change: transform;
  /* PC端5个卡片，基于视口宽度计算单卡宽度 */
  --card-w: calc((min(1220px, 100vw - 48px) - 4 * 18px) / 5);
}
/* 静态展示时撑满容器 */
.category-carousel-track.is-static {
  width: 100%;
  justify-content: center;
}
.category-carousel-card {
  flex-shrink: 0;
  width: var(--card-w);
  text-decoration: none;
  color: inherit;
  transition: opacity 0.2s;
}
.category-carousel-card:hover {
  opacity: 0.85;
}
.category-carousel-image {
  width: var(--card-w);
  /* 1:2 比例：高度 = 宽度 × 2 */
  height: calc(var(--card-w) * 2);
  border-radius: 2px;
  overflow: hidden;
  background: var(--cream);
}
.category-carousel-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.category-carousel-label {
  text-align: center;
  margin-top: 10px;
  font-size: 14px;
}
.category-carousel-label strong {
  color: var(--ink);
}

/* 响应式：移动端调整卡片数量 */
@media (max-width: 768px) {
  .category-carousel-track {
    --card-w: calc((100% - 2 * 18px) / 3);
  }
}
</style>
