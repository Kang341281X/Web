<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete, Check } from '@element-plus/icons-vue'
import api from '../../services/api'
import { generateSkuCode, normalizeRatingToHalf } from '../../utils/sku'
import { useUserStore } from '../../stores/user'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'success'])

const userStore = useUserStore()

const dialogVisible = ref(props.visible)
watch(() => props.visible, val => { dialogVisible.value = val })
watch(dialogVisible, val => {
  emit('update:visible', val)
  if (val) loadCategories()
})

// ── 分类 ──────────────────────────────────────────────
const categories = ref([])
const loadingCategories = ref(false)
async function loadCategories() {
  loadingCategories.value = true
  try {
    const { data } = await api.get('/categories')
    categories.value = data.data
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '分类加载失败')
  } finally {
    loadingCategories.value = false
  }
}
const activeCategories = computed(() => (categories.value || []).filter(item => item.status))
const existingCategoryNames = computed(() => new Set(activeCategories.value.map(item => item.name)))

// 行内分类是否为「系统中不存在的新分类」（需要管理员点「添加」确认，提交后才真正创建）
function isNewCategory(row) {
  const name = String(row.category_name || '').trim()
  return Boolean(name) && !existingCategoryNames.value.has(name)
}
// 切换分类时重置新分类确认标记（改名后需重新确认）
function onCategoryChange(row) { row.categoryConfirmed = false }
// 确认新增分类：仅在本行标记，实际创建发生在提交后端的写库阶段
function confirmNewCategory(row) {
  if (!isNewCategory(row)) return
  row.categoryConfirmed = true
  row.errors = (row.errors || []).filter(err => !err.startsWith('分类不存在：'))
  ElMessage.success(`已标记新分类「${row.category_name}」，提交后将自动创建`)
}

// ── 行数据 ────────────────────────────────────────────
let rowSeq = 0
function emptyRow() {
  return {
    _key: ++rowSeq,
    // 新增一行时立即按新算法在前端本地生成，不发请求；预览即落库，后端按原值写入
    sku: generateSkuCode(userStore.adminUser?.username),
    name: '',
    // 分类直接以「名称」保存：既可选已有分类，也可输入系统中不存在的新分类
    category_name: '',
    categoryConfirmed: false, // 新分类经「添加」确认后置 true，提交时才由后端创建
    price: null,
    original_price: null,
    stock: null,
    unit: '',
    manufacturer: '',
    brand: '',
    description: '',
    is_customizable: '0',
    rating: 5,
    files: [],
    errors: [],
    checked: false, // 是否已点过「校验数据」/「全部校验」
    checkedSignature: '', // 校验时的行内容签名，字段变化后校验状态自动失效
  }
}
const rows = ref([emptyRow()])

function addRow() { rows.value.push(emptyRow()) }
function removeRow(index) {
  rows.value.splice(index, 1)
  if (!rows.value.length) rows.value.push(emptyRow())
}
function regenerateSku(row) { row.sku = generateSkuCode(userStore.adminUser?.username) }

// ── 图片选择（原生文件选择器，一次可选多张，第一张为主图） ──
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp']
function chooseImages(row) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.png,.jpg,.jpeg,.bmp,.webp'
  input.multiple = true
  input.onchange = () => {
    for (const file of Array.from(input.files || [])) {
      if (!ALLOWED_TYPES.includes(file.type)) { ElMessage.error(`不支持的图片格式：${file.name}`); continue }
      if (file.size > 5 * 1024 * 1024) { ElMessage.error(`图片不能超过 5MB：${file.name}`); continue }
      row.files.push(file)
    }
  }
  input.click()
}
function removeImage(row, index) { row.files.splice(index, 1) }

// ── 提交 ──────────────────────────────────────────────
const submitting = ref(false)

function buildRowsPayload() {
  return rows.value.map(row => ({
    sku: row.sku,
    name: row.name,
    category_name: String(row.category_name || '').trim(),
    price: row.price,
    original_price: row.original_price,
    stock: row.stock,
    unit: row.unit,
    manufacturer: row.manufacturer,
    brand: row.brand,
    description: row.description,
    is_customizable: row.is_customizable,
    rating: normalizeRatingToHalf(row.rating),
  }))
}

// ── 校验（逐行 / 全部） ────────────────────────────────
// 行内容签名：参与校验的字段一旦变化，之前的「校验成功」状态自动失效，需要重新校验
function rowSignature(row) {
  return JSON.stringify([
    String(row.name || '').trim(),
    String(row.category_name || '').trim(),
    Boolean(row.categoryConfirmed),
    row.price, row.original_price, row.stock, row.rating,
  ])
}
// 当前行是否处于「本次校验有效」状态
function isRowChecked(row) {
  return Boolean(row.checked) && row.checkedSignature === rowSignature(row)
}
// 收集单行错误（纯函数，不写回行数据）
function collectRowErrors(row) {
  const errors = []
  if (!String(row.name || '').trim()) errors.push('商品名称为空')
  const categoryName = String(row.category_name || '').trim()
  if (!categoryName) errors.push('分类不能为空')
  else if (isNewCategory(row) && !row.categoryConfirmed) errors.push(`分类不存在：${categoryName}，请点击「添加」确认新建`)
  if (row.price === null || row.price === undefined || row.price === '') errors.push('售价不能为空')
  if (row.stock === null || row.stock === undefined || row.stock === '') errors.push('库存不能为空')
  else if (!Number.isInteger(Number(row.stock)) || Number(row.stock) < 0) errors.push('库存必须是非负整数')
  if (row.original_price !== null && row.original_price !== '' && row.original_price !== undefined && Number(row.original_price) < Number(row.price)) errors.push('原价不能低于售价')
  const rating = Number(row.rating)
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) errors.push('评分必须在 0-5 之间')
  return errors
}
// 校验单行并写回结果，返回是否通过
function checkRow(row) {
  row.errors = collectRowErrors(row)
  row.checked = true
  row.checkedSignature = rowSignature(row)
  return row.errors.length === 0
}
// 「校验数据」按钮：单行校验 + 结果提示
function checkOneRow(row) {
  if (checkRow(row)) ElMessage.success('校验成功')
  else ElMessage.error('校验未通过，请按提示修正')
}
// 「全部校验」按钮：一次性校验所有行
function checkAllRows() {
  const failed = rows.value.filter(row => !checkRow(row)).length
  if (failed) ElMessage.error(`共 ${rows.value.length} 行，${failed} 行校验未通过`)
  else ElMessage.success(`全部 ${rows.value.length} 行校验成功`)
}

// 提交前的整体校验：逐行校验并定位错误行
function validateRows() {
  let hasError = false
  rows.value.forEach(row => { if (!checkRow(row)) hasError = true })
  return !hasError
}

async function submit() {
  if (!validateRows()) {
    ElMessage.error('请先修正标红的行')
    return
  }
  const formData = new FormData()
  formData.append('rows', JSON.stringify(buildRowsPayload()))
  rows.value.forEach((row, index) => {
    row.files.forEach(file => formData.append(`images_${index}`, file))
  })

  submitting.value = true
  try {
    const { data } = await api.post('/products/import/online', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    ElMessage.success(`成功创建 ${data.data.created_count} 个商品`)
    emit('success')
    resetAndClose()
  } catch (error) {
    const payload = error.response?.data
    // 后端逐行错误回填（整体失败不写库）
    if (payload?.data?.rows) {
      rows.value.forEach((row, index) => {
        const hit = payload.data.rows.find(item => item.index === index)
        row.errors = hit?.errors || []
        row.checked = true
        row.checkedSignature = rowSignature(row)
        if (hit?.sku) row.sku = hit.sku
      })
    }
    ElMessage.error(payload?.message || '批量新增失败，请重试')
  } finally {
    submitting.value = false
  }
}

function reset() { rows.value = [emptyRow()] }
function resetAndClose() { reset(); dialogVisible.value = false }
function handleClosed() { reset() }
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="在线表格批量新增商品"
    width="min(1280px, calc(100% - 24px))"
    top="4vh"
    destroy-on-close
    @closed="handleClosed"
  >
    <div class="online-toolbar">
      <el-button type="primary" plain @click="addRow"><el-icon><Plus /></el-icon>新增一行</el-button>
      <el-button plain @click="checkAllRows"><el-icon><Check /></el-icon>全部校验</el-button>
      <span class="online-toolbar__count">共 {{ rows.length }} 行</span>
    </div>

    <el-table :data="rows" border class="online-table" :max-height="470" style="width:100%" :row-class-name="({ row }) => (row.errors?.length ? 'is-error-row' : '')">
      <el-table-column label="序号" width="60" align="center">
        <template #default="{ $index }">{{ $index + 1 }}</template>
      </el-table-column>
      <el-table-column label="商品编号(SKU)" width="225">
        <template #default="{ row }">
          <div class="online-sku">
            <span class="online-sku__value">{{ row.sku }}</span>
            <el-button link type="primary" size="small" @click="regenerateSku(row)">重新生成</el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="商品名称" min-width="170">
        <template #header><span class="online-req">*</span>商品名称</template>
        <template #default="{ row }"><el-input v-model="row.name" placeholder="必填" /></template>
      </el-table-column>
      <el-table-column label="分类" min-width="210">
        <template #header><span class="online-req">*</span>分类</template>
        <template #default="{ row }">
          <div class="online-category">
            <el-select
              v-model="row.category_name"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入分类"
              :loading="loadingCategories"
              style="width:100%"
              @change="onCategoryChange(row)"
            >
              <el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.name" />
            </el-select>
            <div v-if="isNewCategory(row)" class="online-category__hint">
              <template v-if="row.categoryConfirmed">
                <el-tag type="warning" size="small">待创建</el-tag>
              </template>
              <template v-else>
                <span class="online-category__new">系统中不存在该分类</span>
                <el-button link type="primary" size="small" @click="confirmNewCategory(row)">添加</el-button>
              </template>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="售价" width="130">
        <template #header><span class="online-req">*</span>售价</template>
        <template #default="{ row }"><el-input-number v-model="row.price" :min="0" :precision="2" :controls="false" style="width:100%" /></template>
      </el-table-column>
      <el-table-column label="原价" width="130">
        <template #default="{ row }"><el-input-number v-model="row.original_price" :min="0" :precision="2" :controls="false" style="width:100%" /></template>
      </el-table-column>
      <el-table-column label="库存" width="120">
        <template #header><span class="online-req">*</span>库存</template>
        <template #default="{ row }"><el-input-number v-model="row.stock" :min="0" :controls="false" style="width:100%" /></template>
      </el-table-column>
      <el-table-column label="单位（件/盒）" width="130">
        <template #default="{ row }"><el-input v-model="row.unit" /></template>
      </el-table-column>
      <el-table-column label="生产厂家" min-width="150">
        <template #default="{ row }"><el-input v-model="row.manufacturer" /></template>
      </el-table-column>
      <el-table-column label="品牌" min-width="140">
        <template #default="{ row }"><el-input v-model="row.brand" /></template>
      </el-table-column>
      <el-table-column label="支持定制" width="120">
        <template #default="{ row }">
          <el-select v-model="row.is_customizable" style="width:100%">
            <el-option label="否" value="0" />
            <el-option label="是" value="1" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="评分" width="140">
        <template #default="{ row }">
          <el-input-number v-model="row.rating" :min="0" :max="5" :step="0.5" :precision="1" controls-position="right" style="width:100%" />
        </template>
      </el-table-column>
      <el-table-column label="图片" min-width="170">
        <template #default="{ row }">
          <div class="online-images">
            <el-tooltip content="选择图片" placement="top">
              <el-button size="small" circle @click="chooseImages(row)"><el-icon><Plus /></el-icon></el-button>
            </el-tooltip>
            <div v-if="row.files.length" class="online-images__list">
              <div v-for="(file, i) in row.files" :key="`${row._key}_${i}`" class="online-images__item">
                <span class="online-images__name" :title="file.name">{{ i === 0 ? '主图：' : '' }}{{ file.name }}</span>
                <el-button link type="danger" size="small" @click="removeImage(row, i)">删除</el-button>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="描述" min-width="170">
        <template #default="{ row }"><el-input v-model="row.description" type="textarea" :rows="1" /></template>
      </el-table-column>
      <el-table-column label="校验" min-width="210">
        <template #default="{ row }">
          <el-button v-if="!isRowChecked(row)" size="small" plain type="primary" @click="checkOneRow(row)">校验数据</el-button>
          <div v-else-if="row.errors && row.errors.length" class="online-errors">
            <div v-for="(err, i) in row.errors" :key="i">{{ err }}</div>
          </div>
          <span v-else class="online-ok">校验成功</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeRow($index)"><el-icon><Delete /></el-icon>删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <div class="online-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交批量新增</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.online-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:10px }
.online-toolbar__count { font-size:13px; color:#909399 }
.online-category { display:flex; flex-direction:column; gap:2px }
.online-category__hint { display:flex; align-items:center; gap:4px }
.online-category__new { font-size:12px; color:#e6a23c }
.online-sku { display:flex; flex-direction:row; align-items:center; flex-wrap:nowrap; gap:6px }
.online-sku__value { font-family:monospace; font-size:14px; color:#303133 }
/* 必填项：表头红色星号 */
.online-req { color:#f56c6c; margin-right:2px; font-weight:700 }
/* 表格文字与输入框整体放大，便于逐行录入 */
.online-table :deep(.el-table__cell) { padding:9px 0 }
.online-table :deep(.el-table__header .cell) { font-size:14px; font-weight:600; color:#606266 }
.online-table :deep(.cell) { font-size:14px; line-height:1.6 }
.online-table :deep(.el-input__inner),
.online-table :deep(.el-input-number .el-input__inner),
.online-table :deep(.el-textarea__inner),
.online-table :deep(.el-select__wrapper),
.online-table :deep(.el-select__placeholder) { font-size:14px }
.online-images { display:flex; flex-direction:column; gap:4px }
.online-images__list { display:flex; flex-direction:column; gap:2px }
.online-images__item { display:flex; align-items:center; gap:4px; font-size:12px }
.online-images__name { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#606266 }
.online-errors { display:flex; flex-direction:column; gap:2px; color:#f56c6c; font-size:12px; line-height:1.5 }
.online-ok { color:#67c23a; font-size:12px }
/* 兜底：操作列不显示单元格溢出省略号，避免删除按钮被截成"删除..." */
.online-table :deep(.el-table__column--right .cell) {
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: nowrap !important;
}
.online-footer { display:flex; justify-content:flex-end; gap:10px }
:deep(.is-error-row) td { background:#fef0f0 !important }
</style>
