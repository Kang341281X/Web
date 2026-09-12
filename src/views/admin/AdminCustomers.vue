<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { resolve } from '../../utils/image'
import { formatAddress } from '../../utils/address'
import { formatAmount, orderStatusTag } from '../../utils/order'

/**
 * 后台「用户管理」：顾客列表 + 详情（收货地址、历史订单概览）+ 启用/禁用。
 * 顾客资料与密码只能由顾客本人修改，后台刻意不提供编辑入口
 * （见 server/routes/customers.js 的注释）。
 */
const router = useRouter()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ keyword: '', status: '', page: 1, page_size: 20 })

// 详情弹窗：/admin-customers/:id 只返回地址与订单统计，
// 历史订单列表复用后台订单接口按手机号查最近 5 笔（完整列表跳「订单管理」）。
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const recentOrders = ref([])
const ordersLoading = ref(false)
const statusSaving = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin-customers', { params: query })
    list.value = data.data
    total.value = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '顾客列表加载失败')
  } finally {
    loading.value = false
  }
}

function search() { query.page = 1; load() }
function resetFilter() { query.keyword = ''; query.status = ''; search() }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }
function displayName(customer) { return customer?.nickname || '未设置昵称' }

async function openDetail(row) {
  detail.value = row
  recentOrders.value = []
  detailVisible.value = true
  detailLoading.value = true
  try {
    const { data } = await api.get(`/admin-customers/${row.id}`)
    detail.value = data.data
    await loadRecentOrders(data.data.phone)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '顾客详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

async function loadRecentOrders(phone) {
  ordersLoading.value = true
  try {
    const { data } = await api.get('/admin-orders', { params: { page: 1, page_size: 5, phone } })
    recentOrders.value = data.data
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '历史订单加载失败')
  } finally {
    ordersLoading.value = false
  }
}

function viewAllOrders() {
  const phone = detail.value?.phone
  detailVisible.value = false
  router.push(phone ? { path: '/admin/orders', query: { keyword: phone } } : '/admin/orders')
}

/**
 * 启用 / 禁用顾客账号。
 * 禁用只需把 customer.status 置 0：顾客端中间件每次请求都会回查该字段，
 * 被禁用后旧 token 立即失效，且无法再登录下单，因此禁用前必须二次确认。
 */
async function toggleStatus(customer) {
  if (!customer) return
  const disabling = Boolean(customer.status)
  const name = customer.nickname || customer.phone || '该顾客'
  try {
    await ElMessageBox.confirm(
      disabling
        ? `禁用后「${name}」会被立即退出登录，且无法再登录、下单，确认禁用吗？`
        : `确认重新启用「${name}」的账号吗？`,
      disabling ? '禁用账号' : '启用账号',
      { type: 'warning', confirmButtonText: disabling ? '确认禁用' : '确认启用', cancelButtonText: '取消' }
    )
  } catch { return }

  statusSaving.value = true
  try {
    const { data } = await api.put(`/admin-customers/${customer.id}/status`, { status: disabling ? 0 : 1 })
    ElMessage.success(data.message || '操作成功')
    await load()
    // 详情弹窗打开时同步最新状态，避免列表与弹窗两处显示不一致
    if (detail.value?.id === customer.id) detail.value = { ...detail.value, status: data.data.status }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    statusSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <el-card shadow="never" class="admin-page-card admin-table-page">
    <template #header><div class="page-header"><span>用户管理</span></div></template>

    <div class="list-toolbar">
      <el-input v-model="query.keyword" clearable placeholder="搜索手机号、昵称或邮箱" style="max-width: 320px" @keyup.enter="search" @clear="search" />
      <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 140px" @change="search">
        <el-option label="启用" value="1" />
        <el-option label="禁用" value="0" />
      </el-select>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetFilter">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%">
      <el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column label="顾客" min-width="200">
        <template #default="{ row }">
          <div class="user-cell">
            <el-avatar :src="resolve(row.avatar_url)"><template #default>{{ displayName(row).slice(0, 1) }}</template></el-avatar>
            <div>
              <div>{{ displayName(row) }}</div>
              <small>{{ row.phone }}</small>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="邮箱" min-width="180"><template #default="{ row }">{{ row.email || '-' }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'danger'">{{ row.status ? '启用' : '禁用' }}</el-tag></template></el-table-column>
      <el-table-column label="注册时间" width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
      <el-table-column label="最近登录" width="170"><template #default="{ row }">{{ formatTime(row.last_login_time) }}</template></el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button link :type="row.status ? 'danger' : 'success'" @click="toggleStatus(row)">{{ row.status ? '禁用' : '启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" />
    </div>
  </el-card>

  <el-dialog v-model="detailVisible" title="顾客详情" width="min(900px, calc(100% - 24px))" top="5vh">
    <div v-loading="detailLoading" class="customer-detail">
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="昵称">{{ displayName(detail) }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ detail?.phone || '-' }}</el-descriptions-item>
        <el-descriptions-item label="邮箱">{{ detail?.email || '-' }}</el-descriptions-item>
        <el-descriptions-item label="账号状态"><el-tag :type="detail?.status ? 'success' : 'danger'">{{ detail?.status ? '启用' : '禁用' }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ formatTime(detail?.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="最近登录">{{ formatTime(detail?.last_login_time) }}</el-descriptions-item>
        <el-descriptions-item label="历史订单数">{{ detail?.order_count ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="已取消订单">{{ detail?.cancelled_count ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="累计消费">{{ formatAmount(detail?.total_amount) }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-section">
        <div class="detail-section__head">
          <span class="detail-section__title">收货地址（{{ (detail?.addresses || []).length }}）</span>
        </div>
        <el-table :data="detail?.addresses || []" size="small" border empty-text="该顾客还没有添加收货地址">
          <el-table-column prop="receiver_name" label="收货人" width="110" />
          <el-table-column prop="receiver_phone" label="联系电话" width="140" />
          <el-table-column label="收货地址" min-width="220"><template #default="{ row }">{{ formatAddress(row) || row.detail_address }}</template></el-table-column>
          <el-table-column label="默认" width="80" align="center"><template #default="{ row }"><el-tag v-if="row.is_default" type="success" size="small">默认</el-tag><span v-else class="muted">-</span></template></el-table-column>
        </el-table>
      </div>

      <div class="detail-section">
        <div class="detail-section__head">
          <span class="detail-section__title">历史订单概览（最近 5 笔）</span>
          <el-button link type="primary" @click="viewAllOrders">查看全部订单</el-button>
        </div>
        <el-table v-loading="ordersLoading" :data="recentOrders" size="small" border empty-text="该顾客还没有下过订单">
          <el-table-column prop="order_no" label="订单号" min-width="180" show-overflow-tooltip />
          <el-table-column label="金额" width="110"><template #default="{ row }">{{ formatAmount(row.total_amount) }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="orderStatusTag(row.status)" size="small">{{ row.status_label }}</el-tag></template></el-table-column>
          <el-table-column label="下单时间" width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
      </div>
    </div>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button :type="detail?.status ? 'danger' : 'success'" :loading="statusSaving" @click="toggleStatus(detail)">{{ detail?.status ? '禁用该账号' : '启用该账号' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap }
.user-cell { display: flex; align-items: center; gap: 8px }
.user-cell small { color: #909399 }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.muted { color: #909399; font-size: 13px }
.detail-section { margin-top: 18px }
.detail-section__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px }
.detail-section__title { font-size: 14px; font-weight: 600; color: #303133 }
@media (max-width: 600px) {
  .list-toolbar { align-items: stretch; flex-direction: column }
  .pagination { justify-content: center }
}
</style>
