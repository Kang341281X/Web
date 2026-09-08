<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../services/api'
import { Goods, Files, Box, Warning } from '@element-plus/icons-vue'

const router = useRouter()
const loading = ref(false)
const stats = ref({ totalProducts: 0, totalCategories: 0, todayNew: 0, monthNew: 0, lowStock: 0 })
const recentLogs = ref([])
const categoryChart = ref(null)
const trendChart = ref(null)
const categoryData = ref([])
const trendData = ref([])

async function loadDashboard() {
  loading.value = true
  try {
    const [productsRes, categoriesRes, logsRes] = await Promise.all([
      api.get('/products', { params: { page: 1, page_size: 1 } }),
      api.get('/categories'),
      api.get('/logs', { params: { page: 1, page_size: 8 } }),
    ])

    const totalProducts = productsRes.data.pagination.total
    const categories = categoriesRes.data.data.filter(c => c.status)
    const today = new Date().toISOString().slice(0, 10)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

    const lowStockRes = await api.get('/products', { params: { page: 1, page_size: 100 } })

    const allProducts = lowStockRes.data.data
    const todayNew = allProducts.filter(p => new Date(p.created_at).toISOString().slice(0, 10) === today).length
    const monthNew = allProducts.filter(p => new Date(p.created_at).toISOString().slice(0, 10) >= monthStart).length
    const lowStock = allProducts.filter(p => p.stock < 10).length

    stats.value = {
      totalProducts,
      totalCategories: categories.length,
      todayNew,
      monthNew,
      lowStock,
    }

    recentLogs.value = logsRes.data.data

    // 分类占比
    const catCount = {}
    for (const p of allProducts) {
      catCount[p.category_name] = (catCount[p.category_name] || 0) + 1
    }
    categoryData.value = Object.entries(catCount).map(([name, value]) => ({ name, value }))

    // 近7天趋势
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(d.toISOString().slice(0, 10))
    }
    const dayCounts = days.map(d => ({
      date: d.slice(5),
      count: allProducts.filter(p => new Date(p.created_at).toISOString().slice(0, 10) === d).length,
    }))
    trendData.value = dayCounts

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
          <div><div class="dashboard-stat-value">{{ stats.lowStock }}</div><div class="dashboard-stat-label">低库存预警(&lt;10)</div></div>
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
.dashboard-stat-value { font-size: 28px; font-weight: 700; color: #303133 }
.dashboard-stat-label { font-size: 13px; color: #909399; margin-top: 2px }
</style>
