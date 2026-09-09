<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import AppImage from '../common/AppImage.vue'

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
          <span class="eyebrow">精选分类</span>
          <h2>分类</h2>
        </div>
      </div>
      <div
        class="category-carousel"
        @mouseenter="handleEnter"
        @mouseleave="handleLeave"
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
  color: var(--accent, #b07d56);
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
  background: #f1ebe3;
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
  color: #2d2d2d;
}

/* 响应式：移动端调整卡片数量 */
@media (max-width: 768px) {
  .category-carousel-track {
    --card-w: calc((100% - 2 * 18px) / 3);
  }
}
</style>
