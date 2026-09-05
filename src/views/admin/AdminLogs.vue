<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../services/api'

const loading = ref(false); const logs = ref([]); const total = ref(0)
const query = reactive({ keyword: '', module: '', date_range: [], page: 1, page_size: 20 })

const moduleOptions = [
  { label: '全部模块', value: '' },
  { label: '登录', value: '登录' },
  { label: '商品管理', value: '商品管理' },
  { label: '分类管理', value: '分类管理' },
  { label: '管理员管理', value: '管理员管理' },
  { label: '其他设置', value: '其他设置' },
]
const dateRange = computed({
  get: () => {
    if (!query.date_range || !query.date_range.length) return null
    return [new Date(query.date_range[0]), new Date(query.date_range[1])]
  },
  set: val => { query.date_range = val ? [val[0].toISOString().slice(0,10), val[1].toISOString().slice(0,10)] : [] }
})
async function load() {
  loading.value = true
  try {
    const params = { page: query.page, page_size: query.page_size, keyword: query.keyword, module: query.module }
    if (query.date_range?.length === 2) { params.start_date = query.date_range[0]; params.end_date = query.date_range[1] }
    const { data } = await api.get('/logs', { params })
    logs.value = data.data; total.value = data.pagination.total
  } catch (error) { ElMessage.error(error.response?.data?.message || '日志加载失败') } finally { loading.value = false }
}
function search() { query.page = 1; load() }
function resetFilter() { query.keyword = ''; query.module = ''; query.date_range = []; search() }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function formatTime(row) { return new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) }
onMounted(load)
</script>

<template>
  <el-card shadow="never" class="admin-page-card">
    <template #header><div class="page-header"><span>操作日志</span></div></template>
    <div class="toolbar">
      <div class="toolbar-search">
        <el-input v-model="query.keyword" clearable placeholder="操作人/描述/类型" style="width:220px" @keyup.enter="search" @clear="search" />
        <el-select v-model="query.module" clearable placeholder="全部模块" style="width:140px" @change="search">
          <el-option v-for="item in moduleOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width:260px" @change="search" />
        <el-button type="primary" @click="search">搜索</el-button>
        <el-button @click="resetFilter">重置</el-button>
      </div>
    </div>
    <el-table v-loading="loading" :data="logs" stripe style="width:100%">
      <el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column>
      <el-table-column prop="admin_username" label="操作人" width="120" show-overflow-tooltip />
      <el-table-column prop="operation_module" label="模块" width="110" />
      <el-table-column prop="operation_type" label="类型" width="110" />
      <el-table-column prop="operation_desc" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="ip_address" label="IP" width="130" />
      <el-table-column label="时间" width="170"><template #default="{ row }">{{ formatTime(row) }}</template></el-table-column>
    </el-table>
    <div class="pagination">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" />
    </div>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; font-size:18px; font-weight:600 }
.toolbar { display:flex; justify-content:space-between; margin-bottom:16px }
.toolbar-search { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
.pagination { display:flex; justify-content:flex-end; margin-top:18px }
@media (max-width: 768px) {
  .toolbar-search .el-input, .toolbar-search .el-select { width:100% }
  .pagination { justify-content:center }
}
</style>
