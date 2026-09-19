<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, ArrowLeft, Folder, FolderOpened } from '@element-plus/icons-vue'
import { onBeforeRouteLeave } from 'vue-router'
import api from '../../services/api'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'success', 'category-created'])

// ── 状态 ──────────────────────────────────────────────
const dialogVisible = ref(props.visible)
const step = ref(1) // 1=上传, 2=预览结果
const uploading = ref(false)
const confirming = ref(false)
const downloadingTemplate = ref(false)
const excelFile = ref(null)
const zipFile = ref(null)
const previewResult = ref(null)
const batchId = ref(null)
const renamingFolder = ref(null) // 正在重命名的子文件夹 full_path
const renameNewName = ref('')
const renaming = ref(false)
const creatingCategory = ref({}) // category_name -> boolean
const generatingSku = ref({}) // row -> boolean
const generatingAll = ref(false)
const deletingRow = ref({}) // row -> boolean
const foldersData = ref([])
const currentFolder = ref(null) // 当前进入的顶层文件夹对象（null = 显示顶层列表）
const savedSkuMap = ref({}) // row -> 最近一次服务端保存的编号，输入非法时用于恢复输入框

watch(() => props.visible, val => { dialogVisible.value = val })
watch(dialogVisible, val => { emit('update:visible', val) })

// ── 计算属性 ──────────────────────────────────────────
const canConfirm = computed(() => {
  if (!previewResult.value) return false
  return previewResult.value.fail_count === 0 && previewResult.value.success_count > 0
})

const successRows = computed(() => {
  if (!previewResult.value?.preview) return []
  return previewResult.value.preview.filter(r => r.success)
})

// 尚未生成商品编号的行（上传后已自动生成，正常情况下为空；仅供一键补齐入口判断）
const rowsNeedingSku = computed(() => {
  if (!previewResult.value?.preview) return []
  return previewResult.value.preview.filter(r => !r.sku)
})

const failRows = computed(() => {
  if (!previewResult.value?.preview) return []
  return previewResult.value.preview.filter(r => !r.success)
})

// ── 模板下载 ──────────────────────────────────────────
// 统一走后端 GET /api/product-imports/template（而不是直接下载 public 下的静态文件）：
// 模板以后更新只需替换后端一份文件，前端不必跟着发版；api 实例会自动携带管理员 token。
// 从 Content-Disposition 中解析后端给定的文件名，解析失败时回退到默认名
function resolveTemplateFileName(headers) {
  const disposition = headers?.['content-disposition'] || ''
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]) } catch { /* 解析失败则用下面的回退逻辑 */ }
  }
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'Products.xlsx'
}

async function downloadTemplate() {
  if (downloadingTemplate.value) return
  downloadingTemplate.value = true
  try {
    const response = await api.get('/product-imports/template', { responseType: 'blob', timeout: 60000 })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = resolveTemplateFileName(response.headers)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    // responseType 为 blob 时，后端返回的 JSON 错误也会被包成 Blob，需读出来才能显示真实提示
    let message = '模板下载失败，请稍后重试'
    const data = error.response?.data
    if (data instanceof Blob) {
      try { message = JSON.parse(await data.text())?.message || message } catch { /* 保持默认提示 */ }
    } else if (data?.message) {
      message = data.message
    }
    ElMessage.error(message)
  } finally {
    downloadingTemplate.value = false
  }
}

// ── 文件选择 ──────────────────────────────────────────
function handleExcelChange(file) {
  if (!file) return
  const raw = file.raw || file
  if (!raw.name.match(/\.(xlsx|xls)$/i)) {
    ElMessage.error('请选择 .xlsx 格式的 Excel 文件')
    excelFile.value = null
    return
  }
  if (raw.size > 10 * 1024 * 1024) {
    ElMessage.error('Excel 文件不能超过 10MB')
    excelFile.value = null
    return
  }
  excelFile.value = file
}

function handleZipChange(file) {
  if (!file) return
  const raw = file.raw || file
  if (raw.name !== 'images.zip') {
    ElMessage.error('压缩包文件名必须为 images.zip')
    zipFile.value = null
    return
  }
  if (!raw.name.toLowerCase().endsWith('.zip')) {
    ElMessage.error('只支持 .zip 格式的压缩包')
    zipFile.value = null
    return
  }
  if (raw.size > 500 * 1024 * 1024) {
    ElMessage.error('压缩包不能超过 500MB')
    zipFile.value = null
    return
  }
  zipFile.value = file
}

function handleRemoveExcel() {
  excelFile.value = null
}

function handleRemoveZip() {
  zipFile.value = null
}

// ── 上传 ──────────────────────────────────────────
async function handlePreview() {
  if (!excelFile.value) return ElMessage.error('请选择 Excel 文件')

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('excel', excelFile.value.raw || excelFile.value)
    if (zipFile.value) {
      formData.append('zip', zipFile.value.raw || zipFile.value)
    }

    const { data } = await api.post('/product-imports/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })

    previewResult.value = data.data
    batchId.value = data.data.batchId
    foldersData.value = data.data.folders || []
    currentFolder.value = null
    step.value = 2
    syncSkuMap(data.data.preview)

    // 上传后立即为全部行生成商品编号，管理员可在预览表格中直接修改
    await generateAllSkus()

    if (previewResult.value.fail_count > 0) {
      ElMessage.warning(`校验完成，有 ${data.data.fail_count} 行失败，请修正后重新上传`)
    } else {
      ElMessage.success(`校验完成，全部 ${data.data.success_count} 行通过`)
    }
  } catch (error) {
    const message = error.response?.data?.message || '上传失败，请检查文件后重试'
    ElMessage.error(message)
  } finally {
    uploading.value = false
  }
}

// ── 文件夹浏览 ──────────────────────────────────────
function enterFolder(folder) {
  currentFolder.value = folder
  cancelRename()
}

function exitFolder() {
  currentFolder.value = null
  cancelRename()
}

// ── 子文件夹重命名 ──────────────────────────────────────
function startRename(subFolder) {
  renamingFolder.value = subFolder.full_path
  renameNewName.value = subFolder.folder_name
}

function cancelRename() {
  renamingFolder.value = null
  renameNewName.value = ''
}

async function handleRenameFolder() {
  const newName = renameNewName.value.trim()
  if (!newName) {
    ElMessage.error('新文件夹名称不能为空')
    return
  }
  if (newName === renamingFolder.value.split('/').pop()) {
    ElMessage.warning('新名称与原名称相同')
    return
  }
  if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
    ElMessage.error('文件夹名称不能包含特殊字符')
    return
  }

  renaming.value = true
  try {
    const parentFolder = currentFolder.value ? currentFolder.value.folder_name : ''
    const oldName = renamingFolder.value.split('/').pop()

    const { data } = await api.post(`/product-imports/${batchId.value}/rename-folder`, {
      parent_folder: parentFolder,
      old_name: oldName,
      new_name: newName,
    })

    // 更新预览结果
    previewResult.value = {
      ...previewResult.value,
      success_count: data.data.success_count,
      fail_count: data.data.fail_count,
      preview: data.data.preview,
    }
    foldersData.value = data.data.folders || []

    // 保持当前在子文件夹视图中
    if (currentFolder.value) {
      const updated = foldersData.value.find(f => f.folder_name === currentFolder.value.folder_name)
      currentFolder.value = updated || null
    }

    ElMessage.success(`文件夹已重命名为 "${newName}"，更新了 ${data.data.updated_rows} 行`)
    cancelRename()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '重命名失败，请重试')
  } finally {
    renaming.value = false
  }
}

// ── 一键创建缺失分类 ──────────────────────────────────
async function handleCreateCategory(categoryName) {
  if (!categoryName || creatingCategory.value[categoryName]) return
  creatingCategory.value[categoryName] = true
  try {
    const { data } = await api.post(`/product-imports/${batchId.value}/create-category`, {
      category_name: categoryName,
    })

    previewResult.value = {
      ...previewResult.value,
      success_count: data.data.success_count,
      fail_count: data.data.fail_count,
      preview: data.data.preview,
    }

    ElMessage.success(`分类"${categoryName}"已创建，并修复了 ${data.data.updated_rows} 行`)
    emit('category-created', { name: categoryName })
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '创建分类失败，请重试')
  } finally {
    creatingCategory.value[categoryName] = false
  }
}

// ── 商品编号生成 / 手动修改 ────────────────────────────
function applyPreviewResult(data) {
  previewResult.value = {
    ...previewResult.value,
    total_count: data.preview.length,
    success_count: data.success_count,
    fail_count: data.fail_count,
    preview: data.preview,
  }
  syncSkuMap(data.preview)
}

function syncSkuMap(preview) {
  const map = {}
  for (const row of preview || []) map[row.row] = row.sku || ''
  savedSkuMap.value = map
}

async function generateRowSku(row) {
  if (generatingSku.value[row.row]) return
  generatingSku.value[row.row] = true
  try {
    const { data } = await api.put(`/product-imports/${batchId.value}/rows/${row.row}/sku`)
    applyPreviewResult(data.data)
    ElMessage.success(`第 ${row.row} 行已生成商品编号：${data.data.sku}`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '生成编号失败，请重试')
  } finally {
    generatingSku.value[row.row] = false
  }
}

// 管理员手动修改某行编号：所见即所存，提交值直接回写预览，确认导入时原样落库
async function saveRowSku(row, value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    row.sku = savedSkuMap.value[row.row] || ''
    return ElMessage.warning('商品编号不能为空，已恢复原编号')
  }
  if (generatingSku.value[row.row]) return
  generatingSku.value[row.row] = true
  try {
    const { data } = await api.put(`/product-imports/${batchId.value}/rows/${row.row}/sku`, { sku: trimmed })
    applyPreviewResult(data.data)
    ElMessage.success(`第 ${row.row} 行商品编号已更新：${data.data.sku}`)
  } catch (error) {
    row.sku = savedSkuMap.value[row.row] || ''
    ElMessage.error(error.response?.data?.message || '保存编号失败，请重试')
  } finally {
    generatingSku.value[row.row] = false
  }
}

// ── 删除预览行 ──────────────────────────────────────
async function removeRow(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除第 ${row.row} 行「${row.name}」吗？删除后该行不会被导入。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  if (deletingRow.value[row.row]) return
  deletingRow.value[row.row] = true
  try {
    const { data } = await api.delete(`/product-imports/${batchId.value}/rows/${row.row}`)
    applyPreviewResult(data.data)
    ElMessage.success(`已删除第 ${row.row} 行「${row.name}」`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '删除失败，请重试')
  } finally {
    deletingRow.value[row.row] = false
  }
}

async function generateAllSkus() {
  if (!rowsNeedingSku.value.length) return
  generatingAll.value = true
  try {
    const { data } = await api.post(`/product-imports/${batchId.value}/generate-skus`)
    applyPreviewResult(data.data)
    ElMessage.success(`已为 ${data.data.generated} 行生成商品编号`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '批量生成编号失败，请重试')
  } finally {
    generatingAll.value = false
  }
}

// ── 确认导入 ──────────────────────────────────────────
async function handleConfirm() {
  if (!canConfirm.value) return
  try {
    await ElMessageBox.confirm(
      `确认导入 ${previewResult.value.success_count} 个商品吗？此操作不可撤销。`,
      '确认导入',
      { type: 'warning', confirmButtonText: '确定导入', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  confirming.value = true
  try {
    const { data } = await api.post('/product-imports/confirm', { batchId: batchId.value })
    ElMessage.success(`成功导入 ${data.data.imported_count} 个商品`)
    emit('success')
    resetAndClose()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '导入失败，请重试')
  } finally {
    confirming.value = false
  }
}

// ── 重新上传 ──────────────────────────────────────────
function handleReUpload() {
  // 放弃当前批次
  if (batchId.value) {
    cancelBatch(batchId.value)
    batchId.value = null
  }
  previewResult.value = null
  excelFile.value = null
  zipFile.value = null
  foldersData.value = []
  currentFolder.value = null
  cancelRename()
  step.value = 1
}

// ── 取消批次（sendBeacon / fetch） ───────────────────
function cancelBatch(id) {
  if (!id) return
  const token = localStorage.getItem('admin_token')
  try {
    fetch(`/api/product-imports/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 尽力通知
  }
}

// ── 弹窗关闭 ──────────────────────────────────────────
function handleDialogClose() {
  if (batchId.value) {
    cancelBatch(batchId.value)
    batchId.value = null
  }
  resetForm()
}

function resetForm() {
  step.value = 1
  excelFile.value = null
  zipFile.value = null
  previewResult.value = null
  batchId.value = null
  foldersData.value = []
  currentFolder.value = null
  cancelRename()
}

function resetAndClose() {
  batchId.value = null // 不再取消，因为已确认成功
  resetForm()
  dialogVisible.value = false
}

// ── 页面离开/关闭时的清理 ─────────────────────────────
function handleBeforeUnload() {
  if (batchId.value) {
    const token = localStorage.getItem('admin_token')
    try {
      fetch(`/api/product-imports/${batchId.value}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {})
    } catch {
      // 尽力通知
    }
  }
}

// ── 生命周期 ──────────────────────────────────────────
onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('pagehide', handleBeforeUnload)
  if (batchId.value) {
    cancelBatch(batchId.value)
  }
})

// 路由离开时的清理
onBeforeRouteLeave(() => {
  if (batchId.value) {
    cancelBatch(batchId.value)
  }
  return true
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="批量导入商品"
    width="min(1280px, calc(100% - 24px))"
    top="4vh"
    destroy-on-close
    @closed="handleDialogClose"
  >
    <!-- 步骤1: 上传文件 -->
    <div v-if="step === 1" class="import-step">
      <div class="template-download">
        <el-button type="primary" :icon="Download" :loading="downloadingTemplate" @click="downloadTemplate">下载导入模板</el-button>
        <span class="hint">模板文件名：Products.xlsx</span>
      </div>

      <div class="upload-section">
        <div class="upload-item">
          <div class="upload-label">Excel 商品文件</div>
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".xlsx,.xls"
            :on-change="handleExcelChange"
            :on-remove="handleRemoveExcel"
            :file-list="excelFile ? [excelFile] : []"
          >
            <el-button :icon="Upload">选择 Excel 文件</el-button>
            <template #tip>
              <div class="upload-tip">.xlsx 格式，不超过 10MB</div>
            </template>
          </el-upload>
        </div>

        <div class="upload-item">
          <div class="upload-label">图片压缩包 <span class="optional-tag">（必选）</span></div>
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".zip"
            :on-change="handleZipChange"
            :on-remove="handleRemoveZip"
            :file-list="zipFile ? [zipFile] : []"
          >
            <el-button :icon="Upload">选择 images.zip</el-button>
            <template #tip>
              <div class="upload-tip">文件名必须为 images.zip，不超过 500MB；子文件夹名称需与 Excel「图片文件夹名称」一致</div>
            </template>
          </el-upload>
        </div>
      </div>
    </div>

    <!-- 步骤2: 预览结果 -->
    <div v-if="step === 2 && previewResult" class="import-step">
      <div class="preview-summary">
        <el-statistic title="总行数" :value="previewResult.total_count" />
        <el-statistic title="成功" :value="previewResult.success_count" />
        <el-statistic title="失败" :value="previewResult.fail_count" />
      </div>

      <!-- 文件夹列表面板 -->
      <div v-if="foldersData.length > 0" class="folders-panel">
        <div class="folders-panel-header">
          <span class="folders-panel-title">图片文件夹列表</span>
          <span class="folders-panel-hint">
            <template v-if="!currentFolder">点击文件夹进入查看子文件夹，可重命名子文件夹以匹配 Excel 中的"图片文件夹名称"</template>
            <template v-else>可重命名子文件夹，使其与 Excel 中的"图片文件夹名称"对应</template>
          </span>
        </div>

        <!-- 顶层文件夹列表 -->
        <el-table v-if="!currentFolder" :data="foldersData" border size="small" style="width: 100%">
          <el-table-column label="文件夹名称" min-width="200">
            <template #default="{ row }">
              <el-button link type="primary" @click="enterFolder(row)" class="folder-link">
                <el-icon style="margin-right: 4px"><Folder /></el-icon>
                {{ row.folder_name }}
              </el-button>
            </template>
          </el-table-column>
          <el-table-column prop="image_count" label="直接图片数" width="100" align="center" />
          <el-table-column label="子文件夹数" width="100" align="center">
            <template #default="{ row }">{{ row.sub_folders ? row.sub_folders.length : 0 }}</template>
          </el-table-column>
          <el-table-column label="Excel匹配" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.matched ? 'success' : 'info'" size="small">
                {{ row.matched ? '已匹配' : '-' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button v-if="row.has_subfolders" link type="primary" size="small" @click="enterFolder(row)">进入</el-button>
              <span v-else style="color: #909399; font-size: 12px">无子文件夹</span>
            </template>
          </el-table-column>
        </el-table>

        <!-- 子文件夹列表 -->
        <div v-else class="subfolders-view">
          <div class="subfolders-breadcrumb">
            <el-button link type="primary" :icon="ArrowLeft" @click="exitFolder">返回</el-button>
            <span class="breadcrumb-sep">/</span>
            <el-icon style="margin-right: 4px"><FolderOpened /></el-icon>
            <span class="breadcrumb-folder">{{ currentFolder.folder_name }}</span>
          </div>
          <el-table :data="currentFolder.sub_folders || []" border size="small" style="width: 100%">
            <el-table-column label="子文件夹名称" min-width="200">
              <template #default="{ row }">
                <template v-if="renamingFolder === row.full_path">
                  <div class="rename-inline">
                    <el-input
                      v-model="renameNewName"
                      size="small"
                      placeholder="输入新名称"
                      @keyup.enter="handleRenameFolder"
                      style="width: 160px"
                    />
                    <el-button type="primary" size="small" :loading="renaming" @click="handleRenameFolder">确定</el-button>
                    <el-button size="small" @click="cancelRename">取消</el-button>
                  </div>
                </template>
                <template v-else>
                  <el-icon style="margin-right: 4px"><Folder /></el-icon>
                  <span>{{ row.folder_name }}</span>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    style="margin-left: 8px"
                    @click="startRename(row)"
                  >重命名</el-button>
                </template>
              </template>
            </el-table-column>
            <el-table-column prop="image_count" label="图片数" width="80" align="center" />
            <el-table-column label="Excel匹配" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.matched ? 'success' : 'warning'" size="small">
                  {{ row.matched ? '已匹配' : '未匹配' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <el-alert
        v-if="previewResult.fail_count > 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      >
        <template #title>
          有 {{ previewResult.fail_count }} 行校验失败。图片文件夹不匹配时可尝试在上方重命名文件夹；若为「分类不存在」，可点击失败原因中的「添加分类」一键创建，或前往「商品分类」创建后重新上传。全部通过后即可导入
        </template>
      </el-alert>

      <el-table
        :data="previewResult.preview"
        border
        style="width: 100%"
        :max-height="360"
      >
        <el-table-column label="行号" width="70" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column label="商品编号(SKU)" min-width="190">
          <template #default="{ row }">
            <div class="sku-cell">
              <template v-if="row.sku">
                <el-input
                  v-model="row.sku"
                  size="small"
                  class="sku-input"
                  @change="value => saveRowSku(row, value)"
                />
                <el-button link type="primary" size="small" :loading="generatingSku[row.row]" @click="generateRowSku(row)">重新生成</el-button>
              </template>
              <el-button v-else link type="primary" size="small" :loading="generatingSku[row.row]" @click="generateRowSku(row)">生成</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="商品名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category_name" label="分类" min-width="120" show-overflow-tooltip />
        <el-table-column label="定制" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_customizable ? 'warning' : 'info'" size="small">
              {{ row.is_customizable ? '支持' : '不支持' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="评分" width="80" align="center">
          <template #default="{ row }">{{ row.rating != null ? '★ ' + row.rating : '-' }}</template>
        </el-table-column>
        <el-table-column label="售价" width="90">
          <template #default="{ row }">{{ row.price != null ? '¥' + row.price.toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="原价" width="90">
          <template #default="{ row }">{{ row.original_price != null ? '¥' + row.original_price.toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column prop="stock" label="库存" width="80" align="center" />
        <el-table-column prop="unit" label="单位（件/盒）" width="110" show-overflow-tooltip />
        <el-table-column prop="manufacturer" label="生产厂家" min-width="120" show-overflow-tooltip />
        <el-table-column prop="brand" label="品牌" min-width="100" show-overflow-tooltip />
        <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
        <el-table-column label="图片数" width="80" align="center">
          <template #default="{ row }">{{ row.image_count }}</template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="220">
          <template #default="{ row }">
            <div v-if="row.errors" class="error-list">
              <div v-for="(err, i) in row.errors" :key="i" class="error-item">
                <span>{{ err }}</span>
                <el-button
                  v-if="err.startsWith('分类不存在：') && row.category_name && row.category_name !== '(未填写)'"
                  link
                  type="primary"
                  size="small"
                  :loading="creatingCategory[row.category_name]"
                  @click="handleCreateCategory(row.category_name)"
                >添加分类</el-button>
              </div>
            </div>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" fixed="right" align="center">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? '通过' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="danger" size="small" :loading="deletingRow[row.row]" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <template v-if="step === 1">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="uploading" :disabled="!excelFile" @click="handlePreview">
            上传
          </el-button>
        </template>
        <template v-if="step === 2">
          <el-button @click="handleReUpload">重新上传</el-button>
          <el-button type="primary" :loading="confirming" :disabled="!canConfirm" @click="handleConfirm">
            确定导入 ({{ previewResult.success_count }} 个商品)
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.template-download {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}
.template-download .hint {
  color: #909399;
  font-size: 13px;
}
.upload-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.upload-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.upload-label {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}
.upload-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.optional-tag {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
.preview-summary {
  display: flex;
  gap: 32px;
  margin-bottom: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 6px;
}
.error-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.error-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: #f56c6c;
  font-size: 13px;
  line-height: 1.5;
}
.error-item .el-button {
  padding: 0;
  height: auto;
}
.sku-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.sku-input {
  width: 130px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.folders-panel {
  margin-bottom: 16px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}
.folders-panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
}
.folders-panel-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}
.folders-panel-hint {
  font-size: 12px;
  color: #909399;
}
.rename-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.folder-link {
  font-size: 14px;
}
.subfolders-view {
  padding: 8px;
}
.subfolders-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 10px;
}
.breadcrumb-sep {
  color: #c0c4cc;
  font-size: 14px;
}
.breadcrumb-folder {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}
</style>
