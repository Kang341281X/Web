<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useLanguageStore } from '../../stores/language'
import { useCustomerStore } from '../../stores/customer'
import { useUserStore } from '../../stores/user'
import { fetchProductReviews } from '../../services/publicApi'
import { createProductReview, deleteCustomerReview, updateCustomerReview } from '../../services/customerReviews'
import { resolve } from '../../utils/image'
import AppImage from '../common/AppImage.vue'

/**
 * 商品详情页「买家评价」面板。
 *
 * 数据来自 /api/public/products/:id/reviews（对应 product_review 表）：
 *   - 只展示 status = 1 的评论，隐藏/删除由后台「商品管理 → 商品评论」控制；
 *   - customer_name 为评论时的用户名快照，顾客注销后依旧能正常展示；
 *   - is_purchased 表示该评论绑定了订单（发表时写入已完成订单的 order_id）；
 *   - 登录后接口会额外返回 is_mine / can_edit，用来决定「编辑 / 删除」按钮是否展示。
 *
 * 业务规则（与后端 routes/customerReview.js 一致）：
 *   - 只有「已完成」订单中包含该商品的顾客才能评价（接口返回 can_review），
 *     无购买资格时隐藏「写评价」入口并提示；真正的拦截以后端为准；
 *   - 发布后 24 小时内可修改，超过 24 小时只能删除；
 *   - 删除不限时间。
 */
const props = defineProps({ productId: { type: Number, required: true } })
const emit = defineEmits(['changed'])

const language = useLanguageStore()
const customer = useCustomerStore()
const user = useUserStore()

const loading = ref(false)
const failed = ref(false)
const reviews = ref([])
const summary = ref({ total: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } })

// 发表评价的资格：true / false 由后端按「是否存在包含该商品的已完成订单」判定，
// null 表示未登录（或 token 失效被按游客处理），前端按「未登录」引导登录。
const canReview = ref(null)
// 已登录但没有购买资格：隐藏「写评价」入口并提示（后端 POST 仍会再校验一次）
const purchaseBlocked = computed(() => customer.isLoggedIn && canReview.value === false)

const LEVELS = [5, 4, 3, 2, 1]

// 可修改窗口：与后端 utils/review.js 的 REVIEW_EDIT_WINDOW_HOURS 保持一致
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_IMAGES = 6
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp']

const submitting = ref(false)
const formOpen = ref(false)
const formError = ref('')
const formRef = ref(null)

// keepImages：编辑时保留的原有配图（存后端返回的图片地址，后端会归一化后比对）
// files：本次新选择的文件，url 是本地预览地址
const form = reactive({ id: null, rating: 5, content: '', keepImages: [], files: [] })

const isEditing = computed(() => Boolean(form.id))
const imageCount = computed(() => form.keepImages.length + form.files.length)
const canAddImage = computed(() => imageCount.value < MAX_IMAGES)

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

/**
 * 把后端时间解析成时间戳。
 * created_at / updated_at 由 SQLite 写入，格式为 'YYYY-MM-DD HH:MM:SS' 且是 UTC，但字符串里不带时区标记；
 * 直接 new Date() 会被当成本地时间解析，东八区会凭空少 8 小时——正好会把「刚过 24 小时」的评论判成还能改。
 * 因此没有时区信息时统一补 'Z'。
 */
function parseServerTime(value) {
  const text = String(value || '').trim()
  if (!text) return NaN
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`).getTime()
}

// 是否是「我的评论」（未登录时后端一律返回 false）
function isMine(review) { return Boolean(review.isMine) }

// 我的评论是否还在 24 小时可修改窗口内：决定「编辑」按钮是否展示（后端仍会再校验一次）
function isEditable(review) {
  if (!isMine(review)) return false
  const published = parseServerTime(review.createdAt)
  // 时间解析异常时退回后端给的结果，避免把入口藏掉后用户在别处也改不了
  if (!Number.isFinite(published)) return Boolean(review.canEdit)
  return Date.now() - published < EDIT_WINDOW_MS
}

// 商品详情页默认只展示最新 3 条（公开评论，未登录同样可见）；
// 点「查看全部评价」再按需补齐剩余分页，始终走同一个公开接口，不改变任何登录限制。
const FIRST_PAGE_SIZE = 3
const MAX_PAGE_SIZE = 50
const expanded = ref(false)

async function fetchPage(page, pageSize) {
  // 已登录时请求会带上顾客 token，后端据此标出哪些评论是自己写的、有没有评价资格
  const { reviews: list, summary: overview, pagination, canReview: eligible } = await fetchProductReviews(props.productId, { page, page_size: pageSize })
  return { list, overview, pagination, canReview: eligible }
}

async function load() {
  if (!props.productId) return
  loading.value = true
  failed.value = false
  try {
    const first = await fetchPage(1, expanded.value ? MAX_PAGE_SIZE : FIRST_PAGE_SIZE)
    reviews.value = first.list
    summary.value = first.overview
    canReview.value = first.canReview
    // 展开态下把所有剩余分页补全，保证「查看全部评价」看到的确实是全部评论
    const total = Number(first.pagination?.total ?? first.overview?.total ?? first.list.length)
    let page = 2
    while (expanded.value && reviews.value.length < total) {
      const next = await fetchPage(page, MAX_PAGE_SIZE)
      if (!next.list.length) break
      reviews.value = reviews.value.concat(next.list)
      page += 1
    }
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

// 评论总数超过默认展示条数时才给出「查看全部评价」入口，展开后同一位置变成「收起」
const canCollapse = computed(() => summary.value.total > FIRST_PAGE_SIZE)

async function toggleAll() {
  expanded.value = !expanded.value
  await load()
}

// 登录/退出后要重新拉取，否则 is_mine 状态会停留在旧的登录态上（按钮不出现或出现错人身上）
watch(() => customer.isLoggedIn, load)

function revokePreview(files) {
  files.forEach(item => { if (item.url) URL.revokeObjectURL(item.url) })
}

function resetForm() {
  revokePreview(form.files)
  form.id = null
  form.rating = 5
  form.content = ''
  form.keepImages = []
  form.files = []
  formError.value = ''
}

function closeForm() {
  formOpen.value = false
  resetForm()
}

async function scrollToForm() {
  await nextTick()
  formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// 「写评价」：未登录先弹登录框，登录成功后由 watch 重新加载列表（含评价资格）；
// 已登录但没有购买资格时入口已隐藏，这里再挡一次，防止通过其它方式触发
function openCreate() {
  if (!customer.isLoggedIn) {
    user.openLogin()
    ElMessage.info(language.t('reviewLoginNeeded'))
    return
  }
  if (purchaseBlocked.value) {
    ElMessage.warning(language.t('reviewPurchaseRequired'))
    return
  }
  resetForm()
  formOpen.value = true
  scrollToForm()
}

function openEdit(review) {
  // 24 小时后按钮本就不展示，这里再挡一次，防止通过其它方式触发
  if (!isEditable(review)) return
  revokePreview(form.files)
  form.id = review.id
  form.rating = review.rating
  form.content = review.content
  form.keepImages = [...review.images]
  form.files = []
  formError.value = ''
  formOpen.value = true
  scrollToForm()
}

function pickFiles(event) {
  const picked = Array.from(event.target.files || [])
  // 清空 input 的 value：否则连续两次选择同一个文件不会触发 change
  event.target.value = ''
  if (!picked.length) return

  const accepted = []
  for (const file of picked) {
    if (imageCount.value + accepted.length >= MAX_IMAGES) {
      ElMessage.warning(language.t('reviewImageLimit'))
      break
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue
    if (file.size > MAX_IMAGE_SIZE) {
      ElMessage.warning(language.t('reviewImageTooLarge'))
      continue
    }
    accepted.push({ file, url: URL.createObjectURL(file) })
  }
  form.files.push(...accepted)
}

function removeFile(index) {
  const [removed] = form.files.splice(index, 1)
  if (removed?.url) URL.revokeObjectURL(removed.url)
}

function removeKeptImage(index) { form.keepImages.splice(index, 1) }

// 提交（发布 / 修改共用）
async function submit() {
  formError.value = ''
  if (!customer.isLoggedIn) {
    user.openLogin()
    return
  }
  const content = form.content.trim()
  if (!form.rating) { formError.value = language.t('reviewRatingRequired'); return }
  if (!content) { formError.value = language.t('reviewContentRequired'); return }

  submitting.value = true
  try {
    const files = form.files.map(item => item.file)
    if (isEditing.value) {
      await updateCustomerReview(form.id, { rating: form.rating, content, images: files, keepImages: form.keepImages })
      ElMessage.success(language.t('reviewUpdated'))
    } else {
      await createProductReview(props.productId, { rating: form.rating, content, images: files })
      ElMessage.success(language.t('reviewSubmitted'))
    }
    closeForm()
    await load()
    // 评分与评论数变了，通知商品详情页刷新顶部数据
    emit('changed')
  } catch (error) {
    formError.value = error?.response?.data?.message || error?.message || language.t('operationFailed')
  } finally {
    submitting.value = false
  }
}

// 删除：不限时间，只校验归属
async function remove(review) {
  try {
    await ElMessageBox.confirm(language.t('deleteReviewConfirm'), language.t('deleteReview'), {
      type: 'warning',
      confirmButtonText: language.t('deleteReview'),
      cancelButtonText: language.t('cancel'),
    })
  } catch { return /* 用户取消 */ }

  try {
    await deleteCustomerReview(review.id)
    // 正在编辑这条评论时，表单要一起关掉，否则会对着已删除的评论继续提交
    if (form.id === review.id) closeForm()
    ElMessage.success(language.t('reviewDeleted'))
    await load()
    emit('changed')
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || error?.message || language.t('operationFailed'))
  }
}

onBeforeUnmount(() => revokePreview(form.files))

// 切换商品时回到「只展示最新 3 条」的默认状态
watch(() => props.productId, () => { expanded.value = false; load() }, { immediate: true })
</script>

<template>
  <div v-loading="loading" class="review-panel">
    <!-- 写评价入口：未登录也能看到，点击引导登录（评价只能绑定到具体账号）；
         已登录但无购买资格（没有包含该商品的已完成订单）时隐藏按钮并给出说明 -->
    <div class="review-toolbar">
      <span v-if="purchaseBlocked" class="review-toolbar__hint">{{ language.t('reviewPurchaseRequired') }}</span>
      <p v-else-if="customer.isLoggedIn" class="review-toolbar__hint">{{ language.t('reviewEditWindow') }}</p>
      <span v-else class="review-toolbar__hint">{{ language.t('reviewLoginNeeded') }}</span>
      <button v-if="!formOpen && !purchaseBlocked" type="button" class="button primary review-write" @click="openCreate">
        {{ language.t('writeReview') }}
      </button>
    </div>

    <!-- 发布 / 修改表单 -->
    <form v-if="formOpen" ref="formRef" class="review-form" @submit.prevent="submit">
      <h4 class="review-form__title">{{ isEditing ? language.t('reviewEditTitle') : language.t('reviewFormTitle') }}</h4>

      <div class="review-form__row">
        <span class="review-form__label">{{ language.t('reviewRating') }}</span>
        <el-rate v-model="form.rating" :max="5" />
      </div>

      <div class="review-form__row review-form__row--block">
        <label class="review-form__label" for="review-content">{{ language.t('reviewContent') }}</label>
        <textarea
          id="review-content"
          v-model="form.content"
          class="review-form__textarea"
          maxlength="500"
          rows="4"
          :placeholder="language.t('reviewContentPlaceholder')"
        ></textarea>
        <small class="review-form__counter">{{ form.content.length }}/500</small>
      </div>

      <div class="review-form__row review-form__row--block">
        <span class="review-form__label">{{ language.t('reviewImages') }}</span>
        <div class="review-thumbs">
          <span v-for="(image, index) in form.keepImages" :key="`kept-${index}`" class="review-thumb">
            <img :src="resolve(image)" :alt="language.t('reviewImages')" />
            <button type="button" class="review-thumb__remove" :aria-label="language.t('removeImage')" @click="removeKeptImage(index)">×</button>
          </span>
          <span v-for="(item, index) in form.files" :key="`new-${index}`" class="review-thumb">
            <img :src="item.url" :alt="language.t('reviewImages')" />
            <button type="button" class="review-thumb__remove" :aria-label="language.t('removeImage')" @click="removeFile(index)">×</button>
          </span>
          <label v-if="canAddImage" class="review-thumb review-thumb--add">
            <input type="file" accept="image/jpeg,image/png,image/bmp,image/webp" multiple @change="pickFiles" />
            <span>{{ language.t('addReviewImage') }}</span>
          </label>
        </div>
        <small class="review-form__hint">{{ language.t('reviewImageHint') }}</small>
      </div>

      <p v-if="formError" class="review-form__error">{{ formError }}</p>

      <div class="review-form__footer">
        <button type="button" class="button review-form__cancel" @click="closeForm">{{ language.t('cancel') }}</button>
        <button type="submit" class="button primary" :disabled="submitting">
          {{ submitting ? language.t('submitting') : language.t('reviewSubmit') }}
        </button>
      </div>
    </form>

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
          <span>{{ initial(review.customerName) }}</span>
          <img v-if="review.avatarUrl" :src="resolve(review.avatarUrl)" alt="" loading="lazy" @error="hideBrokenAvatar" />
        </div>
        <div class="review-body">
          <div class="review-head">
            <span class="review-name">{{ review.customerName }}</span>
            <span v-if="review.isPurchased" class="review-verified">{{ language.t('reviewVerified') }}</span>
            <span v-if="review.edited" class="review-edited">{{ language.t('reviewEdited') }}</span>
            <span class="review-stars">{{ stars(review.rating) }}</span>
            <time class="review-date">{{ formatDate(review.createdAt) }}</time>
          </div>
          <p class="review-text">{{ review.content }}</p>
          <div v-if="review.images.length" class="review-images">
            <AppImage v-for="(image, index) in review.images" :key="index" :src="image" :alt="review.customerName" />
          </div>

          <!-- 自己的评价：24 小时内展示「编辑」，删除始终展示 -->
          <div v-if="isMine(review)" class="review-ops">
            <button v-if="isEditable(review)" type="button" class="text-button" @click="openEdit(review)">
              {{ language.t('editReview') }}
            </button>
            <button type="button" class="text-button review-ops__delete" @click="remove(review)">
              {{ language.t('deleteReview') }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <p v-else-if="!loading" class="review-empty">{{ language.t('reviewEmpty') }}</p>

    <!-- 查看全部评论：默认只展示最新 3 条，这里同样是公开入口，未登录也能展开 -->
    <div v-if="reviews.length && canCollapse" class="review-more">
      <button type="button" class="button review-more__button" @click="toggleAll">
        {{ expanded ? language.t('collapseReviews') : language.t('viewAllReviews') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.review-panel { min-height: 120px }

.review-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-bottom: 18px }
.review-toolbar__hint { margin: 0; flex: 1; min-width: 180px; color: var(--muted); font-size: .82rem }
.review-write { flex-shrink: 0 }

.review-form { border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin-bottom: 24px; background: var(--cream) }
.review-form__title { margin: 0 0 16px; font: 600 1.05rem 'Playfair Display', serif; color: var(--ink) }
.review-form__row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px }
.review-form__row--block { display: block }
.review-form__label { display: block; margin-bottom: 8px; font-size: .86rem; font-weight: 600; color: var(--ink) }
.review-form__row:not(.review-form__row--block) .review-form__label { margin-bottom: 0 }
.review-form__textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 10px; padding: 12px; font: inherit; font-size: 16px; line-height: 1.7; resize: vertical; background: #fff; color: inherit }
.review-form__textarea:focus { outline: none; border-color: var(--clay) }
.review-form__counter { display: block; margin-top: 6px; text-align: right; color: var(--muted); font-size: .76rem }
.review-form__hint { display: block; margin-top: 8px; color: var(--muted); font-size: .76rem }
.review-form__error { margin: 0 0 12px; color: #b3261e; font-size: .82rem }
.review-form__footer { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap }
.review-form__cancel { background: #fff }

.review-thumbs { display: flex; flex-wrap: wrap; gap: 10px }
.review-thumb { position: relative; width: 78px; height: 78px; border-radius: 10px; overflow: hidden; background: #fff; border: 1px solid var(--line) }
.review-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.review-thumb__remove { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; border: none; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; font-size: .9rem; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center }
.review-thumb--add { display: flex; align-items: center; justify-content: center; border-style: dashed; color: var(--muted); font-size: .74rem; text-align: center; padding: 4px; cursor: pointer; box-sizing: border-box }
.review-thumb--add input { display: none }

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
.review-edited { font-size: .72rem; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 1px 8px }
.review-date { margin-left: auto; color: var(--muted); font-size: .78rem }
.review-text { margin: 9px 0 0; line-height: 1.85; color: #59544e; white-space: pre-wrap }
.review-images { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap }
.review-images :deep(img) { width: 88px; height: 88px; object-fit: cover; border-radius: 8px; background: var(--cream) }

/* 本人评论的操作区：全局 .text-button 是零内边距的小号文字按钮，移动端点击区域不足，这里补足 */
.review-ops { display: flex; gap: 16px; margin-top: 12px }
.review-ops .text-button { display: inline-flex; align-items: center; min-height: 40px; padding: 8px 2px; font-size: .82rem }
.review-ops__delete { color: #b3261e }

.review-empty { color: var(--muted); padding: 18px 0 }

.review-more { display: flex; justify-content: center; padding: 20px 0 4px }
.review-more__button { min-width: 180px }

@media (max-width: 760px) {
  .review-overview { gap: 20px }
  .review-overview__score { flex-direction: row; gap: 10px; min-width: 0 }
  .review-overview__score strong { font-size: 2rem }
  .review-item { gap: 12px }
  .review-date { margin-left: 0; width: 100% }
  .review-write { width: 100% }
  .review-form { padding: 16px }
  .review-form__footer { flex-direction: column-reverse }
  .review-form__footer .button { width: 100% }
  .review-ops { gap: 12px }
  .review-more__button { width: 100% }
  .review-ops .text-button { flex: 1; justify-content: center; min-height: 44px; border: 1px solid var(--line); border-radius: 99px }
  .review-ops__delete { border-color: rgba(179, 38, 30, .35) }
}
</style>
