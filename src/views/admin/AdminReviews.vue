<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'

/**
 * 后台「商品评论」：列表（关键词 / 评分 / 状态筛选）、详情、显示/隐藏与删除。
 *
 * 关于数据一致性（见 server/routes/reviews.js）：
 *   - product_review.status 决定评论是否在前台展示（1 显示 / 0 隐藏）；
 *   - 隐藏或删除后，后端会按「可见评论」重算 product.rating 与 product.review_count，
 *     因此这两个操作都属于会影响前台展示的操作，必须二次确认。
 *   - customer_name 是评论时的昵称快照，顾客注销后依旧可正常展示。
 */
const route = useRoute()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ keyword: '', rating: '', status: '', product_id: '', page: 1, page_size: 20 })

const stats = ref(null)
const statsLoading = ref(false)
const savingId = ref(null)

const detailVisible = ref(false)
const detail = ref(null)

const RATING_OPTIONS = [5, 4, 3, 2, 1]

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin-reviews', { params: query })
    list.value = data.data
    total.value = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '评论列表加载失败')
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  statsLoading.value = true
  try {
    const { data } = await api.get('/admin-reviews/stats')
    stats.value = data.data
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '评论统计加载失败')
  } finally {
    statsLoading.value = false
  }
}

function search() { query.page = 1; load() }

function resetFilter() {
  query.keyword = ''
  query.rating = ''
  query.status = ''
  query.product_id = ''
  search()
}

function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }
function stars(rating) { return '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating)) }

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

// 显示 / 隐藏：隐藏后前台立即不可见，商品评分也会被后端重算
async function toggleStatus(row) {
  const hiding = row.status === 1
  try {
    await ElMessageBox.confirm(
      hiding
        ? `隐藏后「${row.customer_name}」的这条评论会立即从前台消失，商品评分会同步重算，确认隐藏吗？`
        : `确认重新显示「${row.customer_name}」的这条评论吗？商品评分会同步重算。`,
      hiding ? '隐藏评论' : '显示评论',
      { type: 'warning', confirmButtonText: hiding ? '确认隐藏' : '确认显示', cancelButtonText: '取消' }
    )
  } catch { return }

  savingId.value = row.id
  try {
    const { data } = await api.put(`/admin-reviews/${row.id}/status`, { status: hiding ? 0 : 1 })
    ElMessage.success(data.message || '操作成功')
    await Promise.all([load(), loadStats()])
    if (detail.value?.id === row.id) detail.value = { ...detail.value, status: hiding ? 0 : 1 }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    savingId.value = null
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `删除后不可恢复，「${row.customer_name}」的这条评论将永久消失，商品评分会同步重算。确认删除吗？`,
      '删除评论',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }

  savingId.value = row.id
  try {
    const { data } = await api.delete(`/admin-reviews/${row.id}`)
    ElMessage.success(data.message || '评论已删除')
    await Promise.all([load(), loadStats()])
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '删除失败')
  } finally {
    savingId.value = null
  }
}

onMounted(() => {
  // 支持从商品详情等处带条件跳转进来（?product_id= / ?keyword= / ?status=）
  if (route.query.product_id) query.product_id = String(route.query.product_id)
  if (route.query.keyword) query.keyword = String(route.query.keyword)
  if (route.query.status === '0' || route.query.status === '1') query.status = String(route.query.status)
  load()
  loadStats()
})
</script>

<template>
  <el-card shadow="never" class="admin-page-card admin-table-page">
    <template #header><div class="page-header"><span>商品评论</span></div></template>

    <div v-loading="statsLoading" class="review-stats">
      <el-card shadow="never" class="dashboard-stat-card">
        <div class="dashboard-stat-icon dashboard-stat-icon--blue">评</div>
        <div>
          <div class="dashboard-stat-value">{{ stats?.total_reviews ?? 0 }}</div>
          <div class="dashboard-stat-label">评论总数</div>
        </div>
      </el-card>
      <el-card shadow="never" class="dashboard-stat-card">
        <div class="dashboard-stat-icon dashboard-stat-icon--green">显</div>
        <div>
          <div class="dashboard-stat-value">{{ stats?.visible_reviews ?? 0 }}</div>
          <div class="dashboard-stat-label">显示中</div>
        </div>
      </el-card>
      <el-card shadow="never" class="dashboard-stat-card">
        <div class="dashboard-stat-icon dashboard-stat-icon--orange">隐</div>
        <div>
          <div class="dashboard-stat-value">{{ stats?.hidden_reviews ?? 0 }}</div>
          <div class="dashboard-stat-label">已隐藏</div>
        </div>
      </el-card>
      <el-card shadow="never" class="dashboard-stat-card">
        <div class="dashboard-stat-icon dashboard-stat-icon--red">★</div>
        <div>
          <div class="dashboard-stat-value">{{ stats?.average_rating ?? 0 }}</div>
          <div class="dashboard-stat-label">平均评分</div>
        </div>
      </el-card>
    </div>

    <div class="list-toolbar">
      <el-input v-model="query.keyword" clearable placeholder="搜索商品名称、评价人或评论内容" style="max-width: 300px" @keyup.enter="search" @clear="search" />
      <el-select v-model="query.rating" clearable placeholder="全部评分" style="width: 130px" @change="search">
        <el-option v-for="item in RATING_OPTIONS" :key="item" :label="`${item} 星`" :value="item" />
      </el-select>
      <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 130px" @change="search">
        <el-option label="显示中" value="1" />
        <el-option label="已隐藏" value="0" />
      </el-select>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetFilter">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%">
      <el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column label="商品" min-width="170">
        <template #default="{ row }">
          <a class="review-product" :href="`/product/${row.product_id}`" target="_blank" rel="noopener">{{ row.product_name || `商品 #${row.product_id}` }}</a>
        </template>
      </el-table-column>
      <el-table-column label="评价人" min-width="150">
        <template #default="{ row }">
          <div>{{ row.customer_name }}</div>
          <small class="muted">{{ row.customer_phone || '账号已注销' }}</small>
        </template>
      </el-table-column>
      <el-table-column label="评分" width="150">
        <template #default="{ row }"><el-rate :model-value="row.rating" disabled size="small" /></template>
      </el-table-column>
      <el-table-column label="评论内容" min-width="280">
        <template #default="{ row }"><span class="review-content">{{ row.content }}</span></template>
      </el-table-column>
      <el-table-column label="图片" width="90" align="center">
        <template #default="{ row }">
          <el-image v-if="row.images?.length" :src="row.images[0]" :preview-src-list="row.images" preview-teleported fit="cover" class="review-thumb" />
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="购买" width="90" align="center">
        <template #default="{ row }"><el-tag v-if="row.is_purchased" type="success" size="small">已购买</el-tag><span v-else class="muted">-</span></template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '显示中' : '已隐藏' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="评论时间" width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button link :type="row.status ? 'warning' : 'success'" :loading="savingId === row.id" @click="toggleStatus(row)">{{ row.status ? '隐藏' : '显示' }}</el-button>
          <el-button link type="danger" :loading="savingId === row.id" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" />
    </div>
  </el-card>

  <el-dialog v-model="detailVisible" title="评论详情" width="min(720px, calc(100% - 24px))" top="6vh">
    <el-descriptions v-if="detail" :column="2" border size="small">
      <el-descriptions-item label="商品">
        <a class="review-product" :href="`/product/${detail.product_id}`" target="_blank" rel="noopener">{{ detail.product_name || `商品 #${detail.product_id}` }}</a>
      </el-descriptions-item>
      <el-descriptions-item label="评价人">{{ detail.customer_name }}<small class="muted">（{{ detail.customer_phone || '账号已注销' }}）</small></el-descriptions-item>
      <el-descriptions-item label="评分"><el-rate :model-value="detail.rating" disabled size="small" /><span class="detail-score">{{ stars(detail.rating) }}</span></el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="detail.status ? 'success' : 'info'">{{ detail.status ? '显示中' : '已隐藏' }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="购买凭证">{{ detail.is_purchased ? (detail.order_no || '已购买') : '普通评价' }}</el-descriptions-item>
      <el-descriptions-item label="评论时间">{{ formatTime(detail.created_at) }}</el-descriptions-item>
      <el-descriptions-item label="评论内容" :span="2"><p class="detail-content">{{ detail.content }}</p></el-descriptions-item>
      <el-descriptions-item label="评论图片" :span="2">
        <div v-if="detail.images?.length" class="detail-images">
          <el-image v-for="(image, index) in detail.images" :key="index" :src="image" :preview-src-list="detail.images" :initial-index="index" preview-teleported fit="cover" class="review-thumb" />
        </div>
        <span v-else class="muted">无</span>
      </el-descriptions-item>
    </el-descriptions>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button :type="detail?.status ? 'warning' : 'success'" :loading="savingId === detail?.id" @click="toggleStatus(detail)">{{ detail?.status ? '隐藏该评论' : '显示该评论' }}</el-button>
      <el-button type="danger" :loading="savingId === detail?.id" @click="remove(detail)">删除该评论</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.review-stats { flex: none; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px }
.review-stats .dashboard-stat-card { margin: 0 }
.review-stats .dashboard-stat-card :deep(.el-card__body) { display: flex; align-items: center; gap: 16px }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.muted { color: #909399; font-size: 13px }
.review-product { color: #409eff }
.review-content { color: #606266; line-height: 1.6 }
.review-thumb { width: 40px; height: 40px; border-radius: 4px; background: #f5f5f5; cursor: pointer }
.detail-content { margin: 0; color: #303133; line-height: 1.8; white-space: pre-wrap }
.detail-score { margin-left: 10px; color: #e6a23c; letter-spacing: 1px }
.detail-images { display: flex; flex-wrap: wrap; gap: 8px }
@media (max-width: 992px) {
  .review-stats { grid-template-columns: repeat(2, 1fr) }
}
@media (max-width: 600px) {
  .review-stats { grid-template-columns: 1fr }
  .list-toolbar { align-items: stretch; flex-direction: column }
  .pagination { justify-content: center }
}
</style>
