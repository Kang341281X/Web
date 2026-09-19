<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { ORDER_STATUS_OPTIONS, formatAmount, orderStatusTag } from '../../utils/order'
import { COL, actionColWidth } from '../../constants/tableColumn'
import { useIsMobile } from '../../composables/useIsMobile'

/**
 * 后台「订单管理」：列表（状态筛选 + 订单号/顾客手机号搜索）、详情（商品明细 + 收货地址）
 * 与状态流转（确认订单 / 标记发货 / 标记完成 / 取消订单）。
 * 状态流转规则与 server/utils/order.js 的 STATUS_FLOW 保持一致，前端只控制按钮显隐，
 * 最终能否流转仍由后端校验；取消订单会回补库存，因此必须二次确认。
 */
const route = useRoute()

// 移动端去掉操作列 fixed，避免固定列吃掉窄屏本就稀缺的可视宽度
const isMobile = useIsMobile()
const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ keyword: '', status: '', page: 1, page_size: 20 })

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const statusSaving = ref(false)
// 勾选导出的订单集合（与商品管理一致，供导出下拉的「导出勾选项」使用）
const selected = ref([])

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

// 每个状态流转都是不可逆的推进（取消还会回补库存），执行前统一弹窗二次确认
const STATUS_CONFIRM = {
  confirmed: { title: '确认订单', confirm: '确认接单', text: orderNo => `确认后订单 ${orderNo} 将进入待发货状态，请先核对收货信息。确认接单吗？` },
  shipped: { title: '标记发货', confirm: '确认发货', text: orderNo => `标记发货后订单 ${orderNo} 将无法再取消。确认该订单已发出吗？` },
  completed: { title: '标记完成', confirm: '确认完成', text: orderNo => `标记完成后订单 ${orderNo} 将结束流转。确认该订单已完成吗？` },
  cancelled: { title: '取消订单', confirm: '确认取消', text: orderNo => `取消后订单不可恢复，且该订单内商品的数量会立即退还到库存。确认取消订单 ${orderNo} 吗？` },
}

const customerText = computed(() => {
  const username = detail.value?.customer_username
  const phone = detail.value?.customer_phone
  if (!phone) return '游客订单（无绑定账号）'
  return username ? `${username}（${phone}）` : phone
})

// 订单详情内商品金额合计：从明细累加得到，与 customer_order.total_amount 拆分展示
// total_amount = goodsSubtotal + shipping_fee，运费由后端下单时按 shipping_rate
// 重新计算写入（前端传入的展示值仅做一致性校验，以服务端金额为准）
const detailGoodsSubtotal = computed(() => {
  const items = detail.value?.items
  if (!Array.isArray(items)) return 0
  return items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin-orders', { params: query })
    list.value = data.data
    total.value = data.pagination.total
    // 列表数据整体刷新后，之前的勾选已失效，清空以避免导出到不在当前列表里的订单
    selected.value = []
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

function handleSelection(rows) { selected.value = rows }

// 导出订单（与商品管理同一套交互）：filter=当前筛选结果，selected=勾选项。
// 后端用 exceljs 生成 xlsx 并冻结首行，一单多商品会按明细展开、订单级字段纵向合并。
async function exportOrders(mode) {
  try {
    const { data } = await api.post('/admin-orders/export', {
      mode,
      keyword: query.keyword,
      status: query.status,
      ids: selected.value.map(item => item.id),
    }, { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = '订单数据.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '导出失败')
  }
}

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
  const rule = STATUS_CONFIRM[action.status]
  if (rule) {
    try {
      await ElMessageBox.confirm(
        rule.text(detail.value.order_no),
        rule.title,
        { type: 'warning', confirmButtonText: rule.confirm, cancelButtonText: '再想想' }
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
      <div class="list-toolbar__actions">
        <el-dropdown @command="exportOrders">
          <el-button>导出<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="filter">导出筛选结果</el-dropdown-item>
              <el-dropdown-item command="selected" :disabled="!selected.length">导出勾选项</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 列宽：订单号 / 账号快照为弹性列（min-width），两者按比例分摊剩余宽度；其余短内容列统一引用 COL 常量 -->
    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%" @selection-change="handleSelection">
      <el-table-column type="selection" :width="COL.SELECTION" />
      <el-table-column label="序号" :width="COL.INDEX"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column prop="order_no" label="订单号" min-width="185" show-overflow-tooltip />
      <el-table-column label="顾客" width="118">
        <template #default="{ row }">
          <div v-if="row.customer_phone">
            <div>{{ row.customer_username || '未记录' }}</div>
            <small>{{ row.customer_phone }}</small>
          </div>
          <span v-else class="muted">游客订单</span>
        </template>
      </el-table-column>
      <el-table-column label="收货人" width="106">
        <template #default="{ row }">
          <div>{{ row.receiver_name }}</div>
          <small>{{ row.receiver_phone }}</small>
        </template>
      </el-table-column>
      <!-- 账号快照：下单时写入，顾客改资料或注销后依然保留（见 026 迁移）；邮箱长短不一，作为第二弹性列 -->
      <el-table-column label="账号快照" min-width="160">
        <template #default="{ row }">
          <div>{{ row.customer_username || '未记录' }}</div>
          <small>{{ row.customer_email || '未留邮箱' }}</small>
        </template>
      </el-table-column>
      <el-table-column label="商品金额" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount((row.total_amount || 0) - (row.shipping_fee || 0)) }}</template></el-table-column>
      <el-table-column label="运费" width="76" align="right"><template #default="{ row }">{{ Number(row.shipping_fee) > 0 ? formatAmount(row.shipping_fee) : '包邮' }}</template></el-table-column>
      <el-table-column label="订单金额" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount(row.total_amount) }}</template></el-table-column>
      <el-table-column label="状态" :width="COL.STATUS_TAG"><template #default="{ row }"><el-tag :type="orderStatusTag(row.status)">{{ row.status_label }}</el-tag></template></el-table-column>
      <el-table-column label="下单时间" :width="COL.DATETIME"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" :width="actionColWidth(1)" :fixed="isMobile ? false : 'right'"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
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
        <el-descriptions-item label="顾客账号">{{ customerText }}</el-descriptions-item>
        <el-descriptions-item label="顾客邮箱（快照）">{{ detail?.customer_email || '未留邮箱' }}</el-descriptions-item>
        <el-descriptions-item label="买家备注" :span="3">{{ detail?.remark || '无' }}</el-descriptions-item>
      </el-descriptions>

      <!-- 金额拆分：商品金额 / 运费 / 订单金额，便于后台一眼看清 -->
      <el-descriptions title="金额拆分" :column="3" border size="small" class="detail-block">
        <el-descriptions-item label="商品金额">{{ formatAmount(detailGoodsSubtotal) }}</el-descriptions-item>
        <el-descriptions-item label="运费">{{ Number(detail?.shipping_fee) > 0 ? formatAmount(detail.shipping_fee) : '包邮' }}</el-descriptions-item>
        <el-descriptions-item label="订单金额"><strong>{{ formatAmount(detail?.total_amount) }}</strong></el-descriptions-item>
      </el-descriptions>

      <el-descriptions title="收货信息" :column="3" border size="small" class="detail-block">
        <el-descriptions-item label="收货人">{{ detail?.receiver_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="联系电话">{{ detail?.receiver_phone || '-' }}</el-descriptions-item>
        <el-descriptions-item label="收货地址" :span="3">{{ detail?.receiver_address || '-' }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-block">
        <div class="detail-section__title">商品明细</div>
        <el-table :data="detail?.items || []" size="small" border empty-text="该订单没有商品明细">
          <el-table-column type="index" label="序号" :width="COL.INDEX" align="center" />
          <el-table-column prop="product_name" label="商品名称" min-width="200" show-overflow-tooltip />
          <el-table-column label="商品编号（SKU）" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.product_sku || '-' }}</template></el-table-column>
          <el-table-column label="单价" :width="COL.AMOUNT"><template #default="{ row }">{{ formatAmount(row.price) }}</template></el-table-column>
          <el-table-column prop="quantity" label="数量" width="72" align="center" />
          <el-table-column label="小计" :width="COL.AMOUNT"><template #default="{ row }">{{ formatAmount(row.subtotal) }}</template></el-table-column>
        </el-table>
        <div class="detail-total">
          <div><span>商品金额</span><b>{{ formatAmount(detailGoodsSubtotal) }}</b></div>
          <div><span>运费</span><b>{{ Number(detail?.shipping_fee) > 0 ? formatAmount(detail.shipping_fee) : '包邮' }}</b></div>
          <div class="detail-total__grand"><span>合计</span><strong>{{ formatAmount(detail?.total_amount) }}</strong></div>
        </div>
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
.list-toolbar__actions { margin-left: auto }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.muted { color: #909399; font-size: 13px }
.order-detail small { color: #909399 }
.detail-block { margin-top: 18px }
.detail-section__title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 10px }
.detail-total { margin-top: 10px; text-align: right; font-size: 14px; color: #606266; display: flex; flex-direction: column; align-items: flex-end; gap: 4px }
.detail-total > div { display: flex; gap: 16px; align-items: baseline }
.detail-total__grand { padding-top: 6px; border-top: 1px solid #ebeef5; margin-top: 4px }
.detail-total strong { font-size: 16px; color: #f56c6c }
@media (max-width: 600px) {
  .list-toolbar { align-items: stretch; flex-direction: column }
  .pagination { justify-content: center }
}
</style>
