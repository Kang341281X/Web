<script setup>
import { computed, ref, watch } from 'vue'
import { useLanguageStore } from '../../stores/language'
import { fetchProductReviews } from '../../services/publicApi'
import { resolve } from '../../utils/image'
import AppImage from '../common/AppImage.vue'

/**
 * 商品详情页「买家评价」面板。
 *
 * 数据来自 /api/public/products/:id/reviews（对应 product_review 表）：
 *   - 只展示 status = 1 的评论，隐藏/删除由后台「商品管理 → 商品评论」控制；
 *   - customer_name 为评论时的昵称快照，顾客注销后依旧能正常展示；
 *   - is_purchased 表示该评论绑定了订单（已购买用户评价）。
 */
const props = defineProps({ productId: { type: Number, required: true } })
const language = useLanguageStore()

const loading = ref(false)
const failed = ref(false)
const reviews = ref([])
const summary = ref({ total: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } })

const LEVELS = [5, 4, 3, 2, 1]

// 评分分布：把各星级条数换算成占比，用于画概览条
const distributionRows = computed(() => LEVELS.map(level => {
  const count = summary.value.distribution?.[level] || 0
  const total = summary.value.total || 0
  return { level, count, percent: total ? Math.round((count / total) * 100) : 0 }
}))

function stars(rating) {
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return '★'.repeat(value) + '☆'.repeat(5 - value)
}
function formatDate(value) { return value ? String(value).slice(0, 10) : '' }
function initial(name) { return (String(name || '').trim() || '匿').slice(0, 1) }
function hideBrokenAvatar(event) { event.target.style.display = 'none' }

async function load() {
  if (!props.productId) return
  loading.value = true
  failed.value = false
  try {
    const { reviews: list, summary: overview } = await fetchProductReviews(props.productId, { page: 1, page_size: 50 })
    reviews.value = list
    summary.value = overview
  } catch (error) {
    // 评价加载失败不影响商品主体展示，这里降级为空列表
    console.error('Failed to load product reviews:', error)
    failed.value = true
    reviews.value = []
    summary.value = { total: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } }
  } finally {
    loading.value = false
  }
}

watch(() => props.productId, load, { immediate: true })
</script>

<template>
  <div v-loading="loading" class="review-panel">
    <div v-if="reviews.length" class="review-overview">
      <div class="review-overview__score">
        <strong>{{ summary.average.toFixed(1) }}</strong>
        <span class="review-stars">{{ stars(summary.average) }}</span>
        <small>{{ summary.total }} {{ language.t('reviewCountUnit') }}</small>
      </div>
      <div class="review-overview__bars">
        <div v-for="row in distributionRows" :key="row.level" class="review-bar">
          <span class="review-bar__label">{{ row.level }}{{ language.t('starUnit') }}</span>
          <span class="review-bar__track"><i :style="{ width: `${row.percent}%` }"></i></span>
          <span class="review-bar__count">{{ row.count }}</span>
        </div>
      </div>
    </div>

    <ul v-if="reviews.length" class="review-list">
      <li v-for="review in reviews" :key="review.id" class="review-item">
        <div class="review-avatar">
          <span>{{ initial(review.customer_name) }}</span>
          <img v-if="review.avatar_url" :src="resolve(review.avatar_url)" alt="" loading="lazy" @error="hideBrokenAvatar" />
        </div>
        <div class="review-body">
          <div class="review-head">
            <span class="review-name">{{ review.customer_name }}</span>
            <span v-if="review.is_purchased" class="review-verified">{{ language.t('reviewVerified') }}</span>
            <span class="review-stars">{{ stars(review.rating) }}</span>
            <time class="review-date">{{ formatDate(review.created_at) }}</time>
          </div>
          <p class="review-text">{{ review.content }}</p>
          <div v-if="review.images && review.images.length" class="review-images">
            <AppImage v-for="(image, index) in review.images" :key="index" :src="image" :alt="review.customer_name" />
          </div>
        </div>
      </li>
    </ul>

    <p v-else-if="!loading" class="review-empty">{{ language.t('reviewEmpty') }}</p>
  </div>
</template>

<style scoped>
.review-panel { min-height: 120px }
.review-overview { display: flex; align-items: center; gap: 42px; padding: 6px 0 24px; border-bottom: 1px solid var(--line); flex-wrap: wrap }
.review-overview__score { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 120px }
.review-overview__score strong { font: 600 2.6rem 'Playfair Display', serif; color: var(--ink); line-height: 1 }
.review-overview__score small { color: var(--muted); font-size: .82rem }
.review-stars { color: var(--clay); letter-spacing: 2px; font-size: .95rem }
.review-overview__bars { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 7px }
.review-bar { display: flex; align-items: center; gap: 10px; font-size: .78rem; color: var(--muted) }
.review-bar__label { width: 34px; flex-shrink: 0 }
.review-bar__track { flex: 1; height: 6px; border-radius: 99px; background: var(--cream); overflow: hidden }
.review-bar__track i { display: block; height: 100%; background: var(--clay); border-radius: 99px }
.review-bar__count { width: 26px; text-align: right; flex-shrink: 0 }
.review-list { list-style: none; margin: 0; padding: 0 }
.review-item { display: flex; gap: 16px; padding: 22px 0; border-bottom: 1px solid var(--line) }
.review-item:last-child { border-bottom: none }
.review-avatar { position: relative; width: 44px; height: 44px; border-radius: 50%; background: var(--cream); color: var(--clay); display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0; overflow: hidden }
.review-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.review-body { flex: 1; min-width: 0 }
.review-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }
.review-name { font-weight: 600 }
.review-verified { font-size: .72rem; color: var(--sage); border: 1px solid var(--sage); border-radius: 99px; padding: 1px 8px }
.review-date { margin-left: auto; color: var(--muted); font-size: .78rem }
.review-text { margin: 9px 0 0; line-height: 1.85; color: #59544e; white-space: pre-wrap }
.review-images { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap }
.review-images :deep(img) { width: 88px; height: 88px; object-fit: cover; border-radius: 8px; background: var(--cream) }
.review-empty { color: var(--muted); padding: 18px 0 }
@media (max-width: 760px) {
  .review-overview { gap: 20px }
  .review-overview__score { flex-direction: row; gap: 10px; min-width: 0 }
  .review-overview__score strong { font-size: 2rem }
  .review-item { gap: 12px }
  .review-date { margin-left: 0; width: 100% }
}
</style>
