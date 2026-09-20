<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../services/api'
import { formatAmount } from '../../utils/order'
import { COL } from '../../constants/tableColumn'

/**
 * 后台「访客下载记录」：未登录访客在前台下载结算清单（Excel）时写入 intent_order 的记录，
 * 只读展示（无状态标签 / 无状态流转 / 无导出）。
 * 注意：intent_order 只存商品快照与金额，不含访客联系方式，
 * 与顾客正式订单（customer_order，见订单管理页）是两套数据。
 */
const loading = ref(false)
const list = ref([])
const total = ref(0)
// 日期范围用 daterange 选择器，提交时拆成 start_date / end_date
const query = reactive({ order_no: '', date_range: [], page: 1, page_size: 20 })

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)

async function load() {
  loading.value = true
  try {
    const [start_date, end_date] = query.date_range || []
    const { data } = await api.get('/admin-intent-orders', {
      params: { ...query, date_range: undefined, start_date, end_date },
    })
    list.value = data.data
    total.value = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '访客下载记录加载失败')
  } finally {
    loading.value = false
  }
}

function search() { query.page = 1; load() }
function resetFilter() { query.order_no = ''; query.date_range = []; search() }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }

async function openDetail(row) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    const { data } = await api.get(`/admin-intent-orders/${row.id}`)
    detail.value = data.data
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '记录详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <el-card shadow="never" class="admin-page-card admin-table-page">
    <template #header><div class="page-header"><span>访客下载记录</span></div></template>

    <!-- 页面说明：避免运营误解这批数据可拿来做客户跟进 -->
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="page-hint"
      title="这里是未登录访客下载结算清单产生的记录，不含联系方式，与顾客正式订单是两套数据，仅供了解清单下载与商品关注情况。"
    />

    <div class="list-toolbar">
      <el-input v-model="query.order_no" clearable placeholder="搜索订单号" style="max-width: 220px" @keyup.enter="search" @clear="search" />
      <el-date-picker
        v-model="query.date_range"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="max-width: 260px"
      />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetFilter">重置</el-button>
    </div>

    <!-- 列宽：订单号为唯一弹性列（min-width），其余短内容列引用 COL 常量 -->
    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%">
      <el-table-column label="序号" :width="COL.INDEX"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column prop="order_no" label="订单号" min-width="185" show-overflow-tooltip />
      <el-table-column prop="item_count" label="商品数量" :width="COL.BOOL_TAG" align="center" />
      <el-table-column label="商品金额" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount(row.goods_amount) }}</template></el-table-column>
      <el-table-column label="运费" width="76" align="right"><template #default="{ row }">{{ row.shipping_fee > 0 ? formatAmount(row.shipping_fee) : '包邮' }}</template></el-table-column>
      <el-table-column label="总金额" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount(row.total_amount) }}</template></el-table-column>
      <el-table-column label="生成时间" :width="COL.DATETIME"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" :width="68" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" />
    </div>
  </el-card>

  <el-dialog v-model="detailVisible" title="下载记录详情" width="min(760px, calc(100% - 24px))" top="8vh">
    <div v-loading="detailLoading" class="intent-detail">
      <el-descriptions title="记录信息" :column="3" border size="small">
        <el-descriptions-item label="订单号">{{ detail?.order_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ formatTime(detail?.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="商品数量">{{ detail?.item_count ?? '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-descriptions title="金额拆分" :column="3" border size="small" class="detail-block">
        <el-descriptions-item label="商品金额">{{ formatAmount(detail?.goods_amount) }}</el-descriptions-item>
        <el-descriptions-item label="运费">{{ detail && detail.shipping_fee > 0 ? formatAmount(detail.shipping_fee) : '包邮' }}</el-descriptions-item>
        <el-descriptions-item label="总金额"><strong>{{ formatAmount(detail?.total_amount) }}</strong></el-descriptions-item>
      </el-descriptions>

      <div class="detail-block">
        <div class="detail-section__title">商品明细（下载时快照）</div>
        <el-table :data="detail?.items || []" size="small" border empty-text="该记录没有商品明细">
          <el-table-column type="index" label="序号" :width="COL.INDEX" align="center" />
          <el-table-column prop="name" label="商品名称" min-width="220" show-overflow-tooltip />
          <el-table-column label="单价" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount(row.price) }}</template></el-table-column>
          <el-table-column prop="quantity" label="数量" width="72" align="center" />
          <el-table-column label="小计" :width="COL.AMOUNT" align="right"><template #default="{ row }">{{ formatAmount(row.subtotal) }}</template></el-table-column>
        </el-table>
      </div>
    </div>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.page-hint { margin-bottom: 16px }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.detail-block { margin-top: 18px }
.detail-section__title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 10px }
@media (max-width: 600px) {
  .list-toolbar { align-items: stretch; flex-direction: column }
  .pagination { justify-content: center }
}
</style>
