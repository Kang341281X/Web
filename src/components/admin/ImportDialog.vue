<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, ArrowLeft, Folder, FolderOpened } from '@element-plus/icons-vue'
import { onBeforeRouteLeave } from 'vue-router'
import api from '../../services/api'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'success'])

// ── 状态 ──────────────────────────────────────────────
const dialogVisible = ref(props.visible)
const step = ref(1) // 1=上传, 2=预览结果
const uploading = ref(false)
const confirming = ref(false)
const excelFile = ref(null)
const zipFile = ref(null)
const previewResult = ref(null)
const batchId = ref(null)
const renamingFolder = ref(null) // 正在重命名的子文件夹 full_path
const renameNewName = ref('')
const renaming = ref(false)
const foldersData = ref([])
const currentFolder = ref(null) // 当前进入的顶层文件夹对象（null = 显示顶层列表）

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

const failRows = computed(() => {
  if (!previewResult.value?.preview) return []
  return previewResult.value.preview.filter(r => !r.success)
})

// ── 模板下载 ──────────────────────────────────────────
async function downloadTemplate() {
  const link = document.createElement('a')
  link.href = '/assets/Products.xlsx'
  link.download = 'Products.xlsx'
  link.click()
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

    const { data } = await api.post('/products/import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })

    previewResult.value = data.data
    batchId.value = data.data.batchId
    foldersData.value = data.data.folders || []
    currentFolder.value = null
    step.value = 2

    if (data.data.fail_count > 0) {
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

    const { data } = await api.post(`/products/import/${batchId.value}/rename-folder`, {
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
    const { data } = await api.post('/products/import/confirm', { batchId: batchId.value })
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
    fetch(`/api/products/import/${id}`, {
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
      fetch(`/api/products/import/${batchId.value}`, {
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
    width="min(860px, calc(100% - 24px))"
    top="4vh"
    destroy-on-close
    @closed="handleDialogClose"
  >
    <!-- 步骤1: 上传文件 -->
    <div v-if="step === 1" class="import-step">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
        <template #title>
          <div class="alert-content">
            <p><strong>导入步骤：</strong></p>
            <ol>
              <li>点击「下载导入模板」，在模板中填写商品数据（请勿修改列名或增删列）</li>
              <li>Excel 中「分类名称」必须是后台「商品分类」中已存在的分类，否则该行判定失败</li>
              <li>Excel 中「图片文件夹名称」为必填，需与压缩包内的子文件夹名称完全一致</li>
              <li>按商品分别建立子文件夹，每个子文件夹内放该商品的所有图片（如 01.jpg，支持 JPG、PNG、BMP、WebP）</li>
              <li>将所有子文件夹统一压缩为 <code>images.zip</code>（文件名必须为 images.zip）</li>
              <li>选择 Excel 文件（必选）和 images.zip（必选），点击「上传」<br><span style="color:#909399">压缩包中缺少对应文件夹、或分类不存在的行，会在预览结果中判定失败</span></li>
            </ol>
          </div>
        </template>
      </el-alert>

      <div class="template-download">
        <el-button type="primary" :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
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
          有 {{ previewResult.fail_count }} 行校验失败。图片文件夹不匹配时可尝试在上方重命名文件夹；若为「分类不存在」，请先在「商品分类」中创建该分类后重新上传。全部通过后即可导入
        </template>
      </el-alert>

      <el-table
        :data="previewResult.preview"
        border
        style="width: 100%"
        :max-height="360"
      >
        <el-table-column prop="row" label="行号" width="70" />
        <el-table-column prop="name" label="商品名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category_name" label="分类" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.category_name }}
          </template>
        </el-table-column>
        <el-table-column label="价格" width="90">
          <template #default="{ row }">{{ row.price != null ? '¥' + row.price.toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column prop="stock" label="库存" width="80" />
        <el-table-column label="图片数" width="80">
          <template #default="{ row }">{{ row.image_count }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" fixed="right">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? '通过' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="200">
          <template #default="{ row }">
            <div v-if="row.errors" class="error-list">
              <div v-for="(err, i) in row.errors" :key="i" class="error-item">{{ err }}</div>
            </div>
            <span v-else>-</span>
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
.alert-content ol {
  margin: 8px 0 0 0;
  padding-left: 20px;
}
.alert-content li {
  margin-bottom: 4px;
  line-height: 1.6;
}
.alert-content code {
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: monospace;
}
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
  color: #f56c6c;
  font-size: 13px;
  line-height: 1.5;
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
