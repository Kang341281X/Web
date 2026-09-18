<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Coin, Wallet, TrendCharts, ArrowDown } from '@element-plus/icons-vue'
import api from '../../services/api'
import { formatAmount, orderStatusTag } from '../../utils/order'
import { COL, actionColWidth } from '../../constants/tableColumn'

/**
 * 后台「收支明细」（仅超级管理员，路由 meta.requiresSuperAdmin + 后端 requireSuperAdmin 双重约束）：
 *  - 收入：由订单实时聚合，口径与订单统计一致（排除 cancelled），按天/按月展示趋势；
 *  - 支出：超级管理员手工登记（物流成本、平台推广等），可增删改；
 *  - 明细表格拆成「收入 / 支出」两个 Tab：两者字段结构差异较大（订单号 / 顾客 vs 类别 / 备注 / 登记人），
 *    合成一张表要么塞入大量空列、要么牺牲字段语义，分开展示更清晰，各自也能按内容分配合适列宽。
 */
// 支出类别候选（下拉可直接选，也允许自定义输入）；与后端无强约束，后端只校验长度
const EXPENSE_CATEGORIES = ['物流成本', '平台推广', '采购成本', '包装耗材', '仓储费用', '运营费用', '其他']

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
const DEFAULT_RANGE = () => [daysAgo(29), today()]

const summaryLoading = ref(false)
const summary = ref({ range: {}, granularity: 'day', income_total: 0, expense_total: 0, net_profit: 0, order_count: 0, expense_count: 0, trend: [] })
const chartRef = ref(null)
let chartInstance = null

const activeTab = ref('income')
const query = reactive({ date_range: DEFAULT_RANGE(), granularity: 'day' })

const income = reactive({ loading: false, list: [], total: 0, page: 1, page_size: 20, keyword: '' })
const expense = reactive({ loading: false, list: [], total: 0, page: 1, page_size: 20, category: '' })

// el-date-picker 用 Date 对象，查询用 'YYYY-MM-DD' 字符串，这里做一层双向映射
const dateRange = computed({
  get: () => (query.date_range?.length === 2 ? [new Date(query.date_range[0]), new Date(query.date_range[1])] : null),
  set: value => { query.date_range = value ? [value[0].toISOString().slice(0, 10), value[1].toISOString().slice(0, 10)] : [] },
})

// 统一的区间参数：清空日期后回退到默认「最近 30 天」，保证各接口口径一致
function rangeParams() {
  const [start, end] = query.date_range?.length === 2 ? query.date_range : DEFAULT_RANGE()
  return { start_date: start, end_date: end }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

// ---------- 趋势图 ----------
async function renderChart() {
  if (!chartRef.value) return
  const echarts = await import('echarts')
  if (!chartInstance) chartInstance = echarts.init(chartRef.value)
  const trend = summary.value.trend || []
  chartInstance.setOption({
    tooltip: { trigger: 'axis', valueFormatter: value => formatAmount(value) },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 44, containLabel: true },
    xAxis: { type: 'category', data: trend.map(item => item.period), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value' },
    series: [
      { name: '收入', type: 'bar', data: trend.map(item => item.income), itemStyle: { color: '#67c23a' }, barMaxWidth: 24 },
      { name: '支出', type: 'bar', data: trend.map(item => item.expense), itemStyle: { color: '#f56c6c' }, barMaxWidth: 24 },
    ],
  }, true)
  chartInstance.resize()
}

// ---------- 数据加载 ----------
async function loadSummary() {
  summaryLoading.value = true
  try {
    const { data } = await api.get('/admin/finance/summary', { params: { ...rangeParams(), granularity: query.granularity } })
    summary.value = data.data
    await renderChart()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '收支概览加载失败')
  } finally {
    summaryLoading.value = false
  }
}

async function loadIncome() {
  income.loading = true
  try {
    const { data } = await api.get('/admin/finance/income', {
      params: { ...rangeParams(), keyword: income.keyword, page: income.page, page_size: income.page_size },
    })
    income.list = data.data
    income.total = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '收入明细加载失败')
  } finally {
    income.loading = false
  }
}

async function loadExpenses() {
  expense.loading = true
  try {
    const { data } = await api.get('/admin/finance/expenses', {
      params: { ...rangeParams(), category: expense.category, page: expense.page, page_size: expense.page_size },
    })
    expense.list = data.data
    expense.total = data.pagination.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '支出明细加载失败')
  } finally {
    expense.loading = false
  }
}

function loadAll() {
  income.page = 1
  expense.page = 1
  loadSummary()
  loadIncome()
  loadExpenses()
}

function search() { loadAll() }

function resetFilter() {
  query.date_range = DEFAULT_RANGE()
  query.granularity = 'day'
  income.keyword = ''
  expense.category = ''
  loadAll()
}

function pageIndex(list, index) { return (list.page - 1) * list.page_size + index + 1 }

// ---------- 导出（全部 / 勾选项） ----------
// 勾选集合：列表数据刷新后 el-table 会清空勾选并回抛 selection-change，与订单管理一致
const selectedIncome = ref([])
const selectedExpense = ref([])
const exporting = ref(false)

function handleIncomeSelection(rows) { selectedIncome.value = rows }
function handleExpenseSelection(rows) { selectedExpense.value = rows }

// 导出收支明细（后端 exceljs 生成 xlsx）：filter=当前筛选区间内的全部记录，selected=勾选项
async function exportFinance(type, mode) {
  exporting.value = true
  try {
    const [start, end] = Object.values(rangeParams())
    const { data } = await api.post('/admin/finance/export', {
      type,
      mode,
      start_date: start,
      end_date: end,
      keyword: type === 'income' ? income.keyword : undefined,
      category: type === 'expense' ? expense.category : undefined,
      ids: (type === 'income' ? selectedIncome.value : selectedExpense.value).map(item => item.id),
    }, { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = type === 'income' ? '收入明细.xlsx' : '支出明细.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

// ---------- 支出登记 / 编辑 / 删除 ----------
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref(null)
const saving = ref(false)
const formRef = ref()
const form = reactive({ expense_date: today(), category: '', amount: null, note: '' })
const rules = {
  expense_date: [{ required: true, message: '请选择支出发生日期', trigger: 'change' }],
  category: [{ required: true, message: '请选择或输入支出类别', trigger: 'change' }],
  amount: [{ validator: (_rule, value, callback) => (Number(value) > 0 ? callback() : callback(new Error('金额需大于 0'))), trigger: 'blur' }],
}

function resetForm() {
  Object.assign(form, { expense_date: today(), category: '', amount: null, note: '' })
  editingId.value = null
}

function openCreateExpense() {
  resetForm()
  isEditing.value = false
  dialogVisible.value = true
}

function openEditExpense(row) {
  Object.assign(form, {
    expense_date: row.expense_date,
    category: row.category,
    amount: Number(row.amount),
    note: row.note || '',
  })
  editingId.value = row.id
  isEditing.value = true
  dialogVisible.value = true
}

async function saveExpense() {
  await formRef.value.validate()
  saving.value = true
  try {
    const payload = { ...form, amount: Number(form.amount) }
    if (isEditing.value) await api.put(`/admin/finance/expenses/${editingId.value}`, payload)
    else await api.post('/admin/finance/expenses', payload)
    ElMessage.success(isEditing.value ? '支出已更新' : '支出已登记')
    dialogVisible.value = false
    await loadSummary()
    await loadExpenses()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeExpense(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.category} ${formatAmount(row.amount)}」这笔支出吗？`, '删除确认', { type: 'warning' })
    await api.delete(`/admin/finance/expenses/${row.id}`)
    ElMessage.success('支出已删除')
    if (expense.list.length === 1 && expense.page > 1) expense.page--
    await loadSummary()
    await loadExpenses()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.response?.data?.message || '删除失败')
  }
}

function handleResize() { chartInstance?.resize() }

onMounted(() => {
  loadAll()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <el-card shadow="never" class="admin-page-card">
    <template #header>
      <div class="page-header">
        <span>收支明细</span>
        <el-button type="primary" @click="openCreateExpense">登记支出</el-button>
      </div>
    </template>

    <div class="list-toolbar">
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 260px" @change="search" />
      <el-radio-group v-model="query.granularity" @change="loadSummary">
        <el-radio-button value="day">按天</el-radio-button>
        <el-radio-button value="month">按月</el-radio-button>
      </el-radio-group>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetFilter">重置</el-button>
      <span v-if="summary.range.start_date" class="range-hint">统计区间：{{ summary.range.start_date }} ~ {{ summary.range.end_date }}</span>
    </div>

    <!-- 统计卡片：当前筛选区间内的总收入 / 总支出 / 净利润（收入-支出） -->
    <div v-loading="summaryLoading" class="finance-stat-grid">
      <el-card shadow="hover" body-style="padding: 18px 20px;">
        <div class="finance-stat">
          <div class="finance-stat-icon finance-stat-icon--income"><el-icon :size="26"><Coin /></el-icon></div>
          <div>
            <div class="finance-stat-value">{{ formatAmount(summary.income_total) }}</div>
            <div class="finance-stat-label">总收入（{{ summary.order_count }} 笔订单）</div>
          </div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 18px 20px;">
        <div class="finance-stat">
          <div class="finance-stat-icon finance-stat-icon--expense"><el-icon :size="26"><Wallet /></el-icon></div>
          <div>
            <div class="finance-stat-value">{{ formatAmount(summary.expense_total) }}</div>
            <div class="finance-stat-label">总支出（{{ summary.expense_count }} 笔登记）</div>
          </div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 18px 20px;">
        <div class="finance-stat">
          <div class="finance-stat-icon" :class="summary.net_profit >= 0 ? 'finance-stat-icon--profit' : 'finance-stat-icon--loss'"><el-icon :size="26"><TrendCharts /></el-icon></div>
          <div>
            <div class="finance-stat-value" :class="summary.net_profit >= 0 ? 'is-profit' : 'is-loss'">{{ formatAmount(summary.net_profit) }}</div>
            <div class="finance-stat-label">净利润（收入 - 支出）</div>
          </div>
        </div>
      </el-card>
    </div>

    <div ref="chartRef" v-loading="summaryLoading" class="finance-chart"></div>
  </el-card>

  <el-card shadow="never" class="admin-page-card">
    <el-tabs v-model="activeTab">
      <el-tab-pane :label="`收入明细（${income.total}）`" name="income">
        <div class="list-toolbar">
          <el-input v-model="income.keyword" clearable placeholder="搜索订单号或顾客手机号" style="max-width: 280px" @keyup.enter="income.page = 1; loadIncome()" @clear="income.page = 1; loadIncome()" />
          <el-button type="primary" @click="income.page = 1; loadIncome()">搜索</el-button>
          <el-dropdown :disabled="exporting" @command="mode => exportFinance('income', mode)">
            <el-button :loading="exporting">导出<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="filter">全部导出</el-dropdown-item>
                <el-dropdown-item command="selected" :disabled="!selectedIncome.length">导出选中（{{ selectedIncome.length }}）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span class="muted">收入口径与订单统计一致：已取消订单不计入</span>
        </div>
        <!-- 列宽：订单号 / 顾客为弹性列（min-width），两者按比例分摊剩余宽度；其余短内容列统一引用 COL 常量 -->
        <el-table v-loading="income.loading" :data="income.list" stripe style="width: 100%" @selection-change="handleIncomeSelection">
          <el-table-column type="selection" :width="COL.SELECTION" />
          <el-table-column label="序号" :width="COL.INDEX"><template #default="{ $index }">{{ pageIndex(income, $index) }}</template></el-table-column>
          <el-table-column prop="order_no" label="订单号" min-width="185" show-overflow-tooltip />
          <el-table-column label="顾客" min-width="150">
            <template #default="{ row }">
              <div v-if="row.customer_phone">
                <div>{{ row.customer_username || '未记录' }}</div>
                <small>{{ row.customer_phone }}</small>
              </div>
              <span v-else class="muted">游客订单</span>
            </template>
          </el-table-column>
          <el-table-column label="订单金额" :width="COL.AMOUNT"><template #default="{ row }">{{ formatAmount(row.total_amount) }}</template></el-table-column>
          <el-table-column label="状态" :width="COL.STATUS_TAG"><template #default="{ row }"><el-tag :type="orderStatusTag(row.status)">{{ row.status_label }}</el-tag></template></el-table-column>
          <el-table-column label="下单时间" :width="COL.DATETIME"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
        <div class="pagination">
          <el-pagination v-model:current-page="income.page" v-model:page-size="income.page_size" :total="income.total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="loadIncome" @size-change="income.page = 1; loadIncome()" />
        </div>
      </el-tab-pane>

      <el-tab-pane :label="`支出明细（${expense.total}）`" name="expense">
        <div class="list-toolbar">
          <el-select v-model="expense.category" clearable placeholder="全部支出类别" style="width: 180px" @change="expense.page = 1; loadExpenses()">
            <el-option v-for="item in EXPENSE_CATEGORIES" :key="item" :label="item" :value="item" />
          </el-select>
          <el-dropdown :disabled="exporting" @command="mode => exportFinance('expense', mode)">
            <el-button :loading="exporting">导出<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="filter">全部导出</el-dropdown-item>
                <el-dropdown-item command="selected" :disabled="!selectedExpense.length">导出选中（{{ selectedExpense.length }}）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span class="muted">支出为手工登记，可编辑或删除</span>
        </div>
        <!-- 列宽：支出类别 / 备注为弹性列（min-width），两者按比例分摊剩余宽度；其余短内容列统一引用 COL 常量 -->
        <el-table v-loading="expense.loading" :data="expense.list" stripe style="width: 100%" @selection-change="handleExpenseSelection">
          <el-table-column type="selection" :width="COL.SELECTION" />
          <el-table-column label="序号" :width="COL.INDEX"><template #default="{ $index }">{{ pageIndex(expense, $index) }}</template></el-table-column>
          <el-table-column prop="expense_date" label="发生日期" width="120" />
          <el-table-column prop="category" label="支出类别" min-width="110" show-overflow-tooltip />
          <el-table-column label="金额" :width="COL.AMOUNT"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
          <el-table-column prop="created_by_name" label="登记人" width="110" show-overflow-tooltip />
          <el-table-column prop="note" label="备注" min-width="220" show-overflow-tooltip />
          <el-table-column label="登记时间" :width="COL.DATETIME"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="操作" :width="actionColWidth(2)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditExpense(row)">编辑</el-button>
              <el-button link type="danger" @click="removeExpense(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination">
          <el-pagination v-model:current-page="expense.page" v-model:page-size="expense.page_size" :total="expense.total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="loadExpenses" @size-change="expense.page = 1; loadExpenses()" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑支出' : '登记支出'" width="min(520px, calc(100% - 32px))" @closed="resetForm">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="92px">
      <el-form-item label="发生日期" prop="expense_date">
        <el-date-picker v-model="form.expense_date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
      </el-form-item>
      <el-form-item label="支出类别" prop="category">
        <el-select v-model="form.category" filterable allow-create default-first-option placeholder="选择或输入类别" style="width: 100%">
          <el-option v-for="item in EXPENSE_CATEGORIES" :key="item" :label="item" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="金额" prop="amount">
        <el-input-number v-model="form.amount" :min="0.01" :precision="2" :controls="false" placeholder="请输入金额" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="如：9 月顺丰国际运费结算" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveExpense">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px }
.muted { color: #909399; font-size: 13px }
.range-hint { color: #909399; font-size: 13px; margin-left: auto }
.finance-stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px }
.finance-stat { display: flex; align-items: center; gap: 14px }
.finance-stat-icon { width: 52px; height: 52px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex: none }
.finance-stat-icon--income { background: #f0f9eb; color: #67c23a }
.finance-stat-icon--expense { background: #fef0f0; color: #f56c6c }
.finance-stat-icon--profit { background: #ecf5ff; color: #409eff }
.finance-stat-icon--loss { background: #fdf6ec; color: #e6a23c }
.finance-stat-value { font-size: 24px; font-weight: 700; color: #303133 }
.finance-stat-value.is-profit { color: #67c23a }
.finance-stat-value.is-loss { color: #e6a23c }
.finance-stat-label { font-size: 13px; color: #909399; margin-top: 2px }
.finance-chart { height: 340px; width: 100% }
@media (max-width: 992px) { .finance-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
@media (max-width: 600px) {
  .finance-stat-grid { grid-template-columns: 1fr }
  .list-toolbar { align-items: stretch; flex-direction: column }
  .range-hint { margin-left: 0 }
  .pagination { justify-content: center }
}
</style>
