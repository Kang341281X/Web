<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { ORDER_STATUS_OPTIONS, formatAmount, orderStatusTag } from '../../utils/order'

/**
 * 后台「订单管理」：列表（状态筛选 + 订单号/顾客手机号搜索）、详情（商品明细 + 收货地址）
 * 与状态流转（确认订单 / 标记发货 / 标记完成 / 取消订单）。
 * 状态流转规则与 server/utils/order.js 的 STATUS_FLOW 保持一致，前端只控制按钮显隐，
 * 最终能否流转仍由后端校验；取消订单会回补库存，因此必须二次确认。
 */
const route = useRoute()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ keyword: '', status: '', page: 1, page_size: 20 })

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const statusSaving = ref(false)

// 与后端状态机一致的可用操作：发货之后不再允许取消（售后另走流程）
const CANCEL_ACTION = { status: 'cancelled', label: '取消订单', type: 'danger' }
const nextActions = computed(() => {
  switch (detail.value?.status) {
    case 'pending': return [{ status: 'confirmed', label: '确认订单', type: 'primary' }, CANCEL_ACTION]
    case 'confirmed': return [{ status: 'shipped', label: '标记发货', type: 'primary' }, CANCEL_ACTION]
    case 'shipped': return [{ status: 'completed', label: '标记完成', type: 'success' }]
    default: return []
  }
})

const customerText = computed(() => {
  const nickname = detail.value?.customer_nickname
  const phone = detail.value?.customer_phone
  if (!phone) return '游客订单（无绑定账号）'
  return nickname ? `${nickname}（${phone}）` : phone
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin-orders', { params: query })
    list.value = data.data
    total.value = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '订单列表加载失败')
  } finally {
    loading.value = false
  }
}

function search() { query.page = 1; load() }
function resetFilter() { query.keyword = ''; query.status = ''; search() }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }

async function openDetail(row) {
  detail.value = row
  detailVisible.value = true
  detailLoading.value = true
  try {
    await refreshDetail()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '订单详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

async function refreshDetail() {
  if (!detail.value?.id) return
  const { data } = await api.get(`/admin-orders/${detail.value.id}`)
  detail.value = data.data
}

async function updateStatus(action) {
  if (!detail.value) return
  if (action.status === 'cancelled') {
    try {
      await ElMessageBox.confirm(
        `取消后订单不可恢复，且该订单内商品的数量会立即退还到库存。确认取消订单 ${detail.value.order_no} 吗？`,
        '取消订单',
        { type: 'warning', confirmButtonText: '确认取消', cancelButtonText: '再想想' }
      )
    } catch { return }
  }

  statusSaving.value = true
  try {
    const { data } = await api.put(`/admin-orders/${detail.value.id}/status`, { status: action.status })
    // 后端会返回「已取消，已回补 N 项商品库存」这类结果说明，直接透传给操作者
    ElMessage.success(data.message || '订单状态已更新')
    await load()
    // 订单可能已不再符合当前筛选条件（从列表消失），但详情弹窗仍展示最新状态
    await refreshDetail()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    statusSaving.value = false
  }
}

onMounted(() => {
  // 支持从仪表盘（?status=pending）与用户管理详情（?keyword=手机号）带条件跳转进来
  if (route.query.status) query.status = String(route.query.status)
  if (route.query.keyword) query.keyword = String(route.query.keyword)
  load()
})
</script>

<template>
  <el-card shadow="never" class="admin-page-card admin-table-page">
    <template #header><div class="page-header"><span>订单管理</span></div></template>

    <div class="list-toolbar">
      <el-input v-model="query.keyword" clearable placeholder="搜索订单号或顾客手机号" style="max-width: 280px" @keyup.enter="search" @clear="search" />
      <el-radio-group v-model="query.status" @change="search">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="item in ORDER_STATUS_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
      </el-radio-group>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetFilter">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%">
      <el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column prop="order_no" label="订单号" min-width="180" show-overflow-tooltip />
      <el-table-column label="顾客" min-width="150">
        <template #default="{ row }">
          <div v-if="row.customer_phone">
            <div>{{ row.customer_nickname || '未设置昵称' }}</div>
            <small>{{ row.customer_phone }}</small>
          </div>
          <span v-else class="muted">游客订单</span>
        </template>
      </el-table-column>
      <el-table-column label="收货人" min-width="140">
        <template #default="{ row }">
          <div>{{ row.receiver_name }}</div>
          <small>{{ row.receiver_phone }}</small>
        </template>
      </el-table-column>
      <el-table-column label="订单金额" width="110"><template #default="{ row }">{{ formatAmount(row.total_amount) }}</template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="orderStatusTag(row.status)">{{ row.status_label }}</el-tag></template></el-table-column>
      <el-table-column label="下单时间" width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" />
    </div>
  </el-card>

  <el-dialog v-model="detailVisible" title="订单详情" width="min(900px, calc(100% - 24px))" top="5vh">
    <div v-loading="detailLoading" class="order-detail">
      <el-descriptions title="订单信息" :column="3" border size="small">
        <el-descriptions-item label="订单号">{{ detail?.order_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="订单状态"><el-tag :type="orderStatusTag(detail?.status)">{{ detail?.status_label || '-' }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="订单金额">{{ formatAmount(detail?.total_amount) }}</el-descriptions-item>
        <el-descriptions-item label="下单时间">{{ formatTime(detail?.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="最近更新">{{ formatTime(detail?.updated_at) }}</el-descriptions-item>
        <el-descriptions-item label="处理人">{{ detail?.handled_by_name || '未处理' }}</el-descriptions-item>
        <el-descriptions-item label="顾客账号" :span="2">{{ customerText }}</el-descriptions-item>
        <el-descriptions-item label="买家备注">{{ detail?.remark || '无' }}</el-descriptions-item>
      </el-descriptions>

      <el-descriptions title="收货信息" :column="3" border size="small" class="detail-block">
        <el-descriptions-item label="收货人">{{ detail?.receiver_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="联系电话">{{ detail?.receiver_phone || '-' }}</el-descriptions-item>
        <el-descriptions-item label="收货地址" :span="3">{{ detail?.receiver_address || '-' }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-block">
        <div class="detail-section__title">商品明细</div>
        <el-table :data="detail?.items || []" size="small" border empty-text="该订单没有商品明细">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="product_name" label="商品名称" min-width="200" show-overflow-tooltip />
          <el-table-column label="商品编号（SKU）" min-width="140"><template #default="{ row }">{{ row.product_sku || '-' }}</template></el-table-column>
          <el-table-column label="单价" width="100"><template #default="{ row }">{{ formatAmount(row.price) }}</template></el-table-column>
          <el-table-column prop="quantity" label="数量" width="80" align="center" />
          <el-table-column label="小计" width="110"><template #default="{ row }">{{ formatAmount(row.subtotal) }}</template></el-table-column>
        </el-table>
        <div class="detail-total">合计：<strong>{{ formatAmount(detail?.total_amount) }}</strong></div>
      </div>
    </div>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button v-for="action in nextActions" :key="action.status" :type="action.type" :loading="statusSaving" @click="updateStatus(action)">{{ action.label }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.muted { color: #909399; font-size: 13px }
.order-detail small { color: #909399 }
.detail-block { margin-top: 18px }
.detail-section__title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 10px }
.detail-total { margin-top: 10px; text-align: right; font-size: 14px; color: #606266 }
.detail-total strong { font-size: 16px; color: #f56c6c }
@media (max-width: 600px) {
  .list-toolbar { align-items: stretch; flex-direction: column }
  .pagination { justify-content: center }
}
</style>
