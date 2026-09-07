<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  categories: { type: Array, default: () => [] },
})

// 复制两份用于无缝循环
const displayList = computed(() => {
  const list = props.categories.filter(c => !c.parent_id)
  return list.length > 0 ? [...list, ...list] : []
})

const trackRef = ref(null)
const offset = ref(0)
let timer = null
let isPaused = false

function stepForward() {
  if (isPaused || !trackRef.value) return
  const track = trackRef.value
  const stepWidth = track.firstElementChild
    ? track.firstElementChild.offsetWidth + 18 // card-w + gap
    : 0
  if (!stepWidth) return

  // 计算总宽度的一半，用于无缝回跳
  const half = track.scrollWidth / 2
  offset.value -= stepWidth
  if (Math.abs(offset.value) >= half) {
    offset.value += half
  }

  // 1s 过渡动画
  track.style.transition = 'transform 1s ease'
  track.style.transform = `translateX(${offset.value}px)`

  // 过渡结束后清除 transition
  clearTimeout(stepForward._restoreTimer)
  stepForward._restoreTimer = setTimeout(() => {
    if (track) track.style.transition = 'none'
  }, 1050)
}

function startTimer() {
  stopTimer()
  timer = setInterval(stepForward, 1000) // 停留 + 1s 过渡，每1s移动一步
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function handleEnter() { isPaused = true }
function handleLeave() { isPaused = false }

watch(() => props.categories, () => {
  offset.value = 0
  if (trackRef.value) {
    trackRef.value.style.transition = 'none'
    trackRef.value.style.transform = 'translateX(0)'
  }
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
        <div ref="trackRef" class="category-carousel-track">
          <RouterLink
            v-for="(cat, idx) in displayList"
            :key="idx"
            :to="`/category/${cat.name}`"
            class="category-carousel-card"
          >
            <div class="category-carousel-image">
              <img v-if="cat.image_url" :src="cat.image_url" :alt="cat.name" loading="lazy" />
              <span v-else class="category-carousel-icon">✦</span>
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
  /* 每张卡片宽度 = (容器宽度 - 4*gap) / 5，与商品网格5列一致 */
  --card-w: calc((min(1220px, 100% - 48px) - 4 * 18px) / 5);
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
  /* 竖矩形：高度大于宽度 */
  height: calc(var(--card-w) * 1.35);
  border-radius: 2px;
  overflow: hidden;
  background: #f1ebe3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.category-carousel-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.category-carousel-icon {
  font-size: 48px;
  color: #c4a882;
}
.category-carousel-label {
  text-align: center;
  margin-top: 10px;
  font-size: 14px;
}
.category-carousel-label strong {
  color: #2d2d2d;
}
</style>
