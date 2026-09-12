<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../services/api'
import { Goods, Files, Box, Warning, Tickets, Bell, User } from '@element-plus/icons-vue'

const router = useRouter()
const loading = ref(false)
const stats = ref({
  totalProducts: 0, totalCategories: 0, monthNew: 0, lowStock: 0, lowStockThreshold: 10,
  todayOrders: 0, pendingOrders: 0, totalCustomers: 0,
})
const recentLogs = ref([])
const categoryChart = ref(null)
const trendChart = ref(null)
const categoryData = ref([])
const trendData = ref([])

// 所有指标都由后端聚合接口给出（/products/stats、/admin-orders/stats、/admin-customers/stats），
// 不再拉取全量商品在前端自己统计——那样商品数量超过一页时结果会失真，且每次进仪表盘都要传大量数据。
async function loadDashboard() {
  loading.value = true
  try {
    const [productRes, orderRes, customerRes, logsRes] = await Promise.all([
      api.get('/products/stats'),
      api.get('/admin-orders/stats'),
      api.get('/admin-customers/stats'),
      api.get('/logs', { params: { page: 1, page_size: 8 } }),
    ])

    const productStats = productRes.data.data
    const orderStats = orderRes.data.data
    const customerStats = customerRes.data.data

    stats.value = {
      totalProducts: productStats.total_products,
      totalCategories: productStats.total_categories,
      monthNew: productStats.month_new,
      lowStock: productStats.low_stock,
      lowStockThreshold: productStats.low_stock_threshold,
      todayOrders: orderStats.today_orders,
      pendingOrders: orderStats.pending_orders,
      totalCustomers: customerStats.total_customers,
    }

    recentLogs.value = logsRes.data.data

    // 分类占比 / 近 7 天新增趋势同样来自后端聚合结果（日期轴已由后端补齐）
    categoryData.value = productStats.category_distribution
    trendData.value = productStats.daily_new.map(item => ({ date: item.date.slice(5), count: item.count }))

    renderCharts()
  } catch (error) {
    console.error('Dashboard load error:', error)
  } finally {
    loading.value = false
  }
}

async function renderCharts() {
  const echarts = await import('echarts')
  if (categoryChart.value) {
    const chart = echarts.init(categoryChart.value)
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['50%', '45%'],
        data: categoryData.value,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } },
        label: { show: false },
      }],
    })
    window.addEventListener('resize', () => chart.resize())
  }
  if (trendChart.value) {
    const chart = echarts.init(trendChart.value)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: trendData.value.map(d => d.date), boundaryGap: false },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ name: '新增商品', type: 'line', smooth: true, areaStyle: {}, data: trendData.value.map(d => d.count) }],
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    })
    window.addEventListener('resize', () => chart.resize())
  }
}

onMounted(loadDashboard)
</script>

<template>
  <div v-loading="loading">
    <div class="dashboard-stat-grid">
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--blue"><el-icon :size="28"><Goods /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.totalProducts }}</div><div class="dashboard-stat-label">商品总数</div></div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--green"><el-icon :size="28"><Files /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.totalCategories }}</div><div class="dashboard-stat-label">分类数</div></div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--orange"><el-icon :size="28"><Box /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.monthNew }}</div><div class="dashboard-stat-label">本月新增</div></div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--red"><el-icon :size="28"><Warning /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.lowStock }}</div><div class="dashboard-stat-label">低库存预警(&lt;{{ stats.lowStockThreshold }})</div></div>
        </div>
      </el-card>
      <!-- 订单与顾客指标：点击可直达带筛选条件的列表页 -->
      <el-card shadow="hover" body-style="padding: 20px;" class="dashboard-stat-clickable" @click="router.push('/admin/orders')">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--indigo"><el-icon :size="28"><Tickets /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.todayOrders }}</div><div class="dashboard-stat-label">今日订单数</div></div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;" class="dashboard-stat-clickable" @click="router.push('/admin/orders?status=pending')">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--magenta"><el-icon :size="28"><Bell /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.pendingOrders }}</div><div class="dashboard-stat-label">待处理订单数（待确认）</div></div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;" class="dashboard-stat-clickable" @click="router.push('/admin/customers')">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--teal"><el-icon :size="28"><User /></el-icon></div>
          <div><div class="dashboard-stat-value">{{ stats.totalCustomers }}</div><div class="dashboard-stat-label">顾客总数</div></div>
        </div>
      </el-card>
    </div>

    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="admin-page-card">
          <template #header><span style="font-weight:600">各分类商品占比</span></template>
          <div ref="categoryChart" style="height: 320px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="admin-page-card">
          <template #header><span style="font-weight:600">近 7 天商品新增趋势</span></template>
          <div ref="trendChart" style="height: 320px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="admin-page-card" style="margin-top: 20px">
      <template #header>
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span style="font-weight:600">最近操作日志</span>
          <el-button link type="primary" @click="router.push('/admin/logs')">查看全部</el-button>
        </div>
      </template>
      <el-table :data="recentLogs" stripe style="width:100%">
        <el-table-column prop="admin_username" label="操作人" width="120" show-overflow-tooltip />
        <el-table-column prop="operation_module" label="模块" width="110" />
        <el-table-column prop="operation_type" label="类型" width="110" />
        <el-table-column prop="operation_desc" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.dashboard-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px }
.dashboard-stat-card { display: flex; align-items: center; gap: 14px }
.dashboard-stat-icon { width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex: none }
.dashboard-stat-icon--blue { background: #ecf5ff; color: #409eff }
.dashboard-stat-icon--green { background: #f0f9eb; color: #67c23a }
.dashboard-stat-icon--orange { background: #fdf6ec; color: #e6a23c }
.dashboard-stat-icon--red { background: #fef0f0; color: #f56c6c }
.dashboard-stat-icon--indigo { background: #eef2ff; color: #6366f1 }
.dashboard-stat-icon--magenta { background: #fff0f6; color: #eb2f96 }
.dashboard-stat-icon--teal { background: #e6fffb; color: #13c2c2 }
/* 可点击的卡片（订单 / 顾客）：整卡可点，跳转到对应列表页 */
.dashboard-stat-clickable { cursor: pointer }
.dashboard-stat-value { font-size: 28px; font-weight: 700; color: #303133 }
.dashboard-stat-label { font-size: 13px; color: #909399; margin-top: 2px }
</style>
