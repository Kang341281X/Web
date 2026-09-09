<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { IMG_FALLBACK, resolve } from '../../utils/image'

const formRef = ref(null); const loading = ref(false); const saving = ref(false)
const form = reactive({ contact_email: '', contact_email2: '', contact_phone: '', contact_phone2: '' })
const labels = { contact_email: '联系邮箱', contact_email2: '联系邮箱2', contact_phone: '联系电话', contact_phone2: '联系电话2' }

// 社交媒体：本地暂存，点「保存修改」后统一提交
const socials = ref([])
const socialLoading = ref(false)
const savingSocial = ref(false)
let draftKey = 0

function isRowDirty(row) {
  return row.new || row.removed || !!row.pendingImage || String(row.name || '').trim() !== row.originalName
}
const pendingCount = computed(() => socials.value.reduce((n, row) => n + (isRowDirty(row) ? 1 : 0), 0))
const hasChanges = computed(() => pendingCount.value > 0)

function displayImage(row) {
  return row.image_preview || row.image_url || ''
}

function clearDraft(row) {
  if (row.image_preview) { URL.revokeObjectURL(row.image_preview) }
  row.image_preview = null
  row.pendingImage = null
}

function toRow(item) {
  return {
    key: ++draftKey,
    id: item.id,
    new: false,
    removed: false,
    name: item.name,
    originalName: item.name,
    image_url: item.image_url || '',
    image_preview: null,
    pendingImage: null,
  }
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/settings')
    for (const item of data.data) {
      if (item.setting_key in form) form[item.setting_key] = item.setting_value || ''
    }
  } catch (error) { ElMessage.error(error.response?.data?.message || '设置加载失败') } finally { loading.value = false }
}

async function save() {
  saving.value = true
  try {
    const { data } = await api.put('/settings', { settings: { ...form } })
    for (const item of data.data) {
      if (item.setting_key in form) form[item.setting_key] = item.setting_value || ''
    }
    ElMessage.success('设置已保存')
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } finally { saving.value = false }
}

async function loadSocials() {
  socialLoading.value = true
  try {
    const { data } = await api.get('/settings/socials')
    socials.value = data.data.map(toRow)
  } catch (error) { ElMessage.error(error.response?.data?.message || '社交媒体加载失败') } finally { socialLoading.value = false }
}

// 新增（暂存本地，保存时生效）
async function addSocial() {
  let name = ''
  try {
    const { value } = await ElMessageBox.prompt('请输入平台名称，该名称将显示在二维码图片下方', '新增社交媒体', {
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      inputPattern: /\S/,
      inputErrorMessage: '平台名称不能为空',
      inputMaxlength: 30,
    })
    name = String(value || '').trim()
  } catch (error) { return }
  if (!name) return
  socials.value.push(toRow({ id: null, name, image_url: '' }))
}

// 选择二维码图片（暂存本地，保存时上传）
function pickImage(row, file) {
  if (row.removed || !file?.raw) return false
  const raw = file.raw
  if (!/^image\//.test(raw.type)) { ElMessage.error('请选择图片文件'); return false }
  clearDraft(row)
  row.pendingImage = raw
  row.image_preview = URL.createObjectURL(raw)
  return false
}

// 删除：新平台直接移除；已保存的平台标记删除，点「保存修改」后移除
async function removeSocial(row) {
  if (row.new) {
    clearDraft(row)
    socials.value = socials.value.filter(r => r.key !== row.key)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」及其二维码图片吗？删除后需点击「保存修改」生效。`, '删除确认', { type: 'warning' })
  } catch (error) { return }
  clearDraft(row)
  row.removed = true
}

// 统一保存修改：新增 → 上传二维码 → 改名 → 删除
async function saveSocial() {
  for (const row of socials.value) {
    if (row.removed) continue
    const name = String(row.name || '').trim()
    if (!name) { ElMessage.error(`请为平台填写名称后再保存`); return }
    if ([...name].length > 30) { ElMessage.error('平台名称不能超过30个字符'); return }
  }
  savingSocial.value = true
  try {
    // 1. 新增平台
    for (const row of socials.value.filter(r => r.new && !r.removed)) {
      const { data } = await api.post('/settings/socials', { name: String(row.name).trim() })
      row.id = data.data.id
      row.image_url = data.data.image_url || ''
      row.originalName = data.data.name
      row.name = data.data.name
      row.new = false
    }
    // 2. 上传/更换二维码
    for (const row of socials.value.filter(r => !r.removed && r.pendingImage)) {
      const body = new FormData()
      body.append('image', row.pendingImage)
      const { data } = await api.post(`/settings/socials/${row.id}/image`, body)
      clearDraft(row)
      row.image_url = data.data.url
    }
    // 3. 名称修改
    for (const row of socials.value.filter(r => !r.removed && String(r.name || '').trim() !== r.originalName)) {
      const { data } = await api.put(`/settings/socials/${row.id}`, { name: String(row.name).trim() })
      row.originalName = data.data.name
      row.name = data.data.name
    }
    // 4. 删除平台
    for (const row of socials.value.filter(r => r.removed && r.id)) {
      await api.delete(`/settings/socials/${row.id}`)
    }
    await loadSocials()
    ElMessage.success('修改已保存')
  } catch (error) {
    await loadSocials()
    ElMessage.error(error.response?.data?.message || '保存失败，请重试')
  } finally { savingSocial.value = false }
}

onMounted(() => { load(); loadSocials() })
onBeforeUnmount(() => { socials.value.forEach(clearDraft) })
</script>

<template>
  <el-card shadow="never" class="admin-page-card" v-loading="loading">
    <template #header>
      <div class="page-header">
        <span>其他设置</span>
        <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 20px">
      <template #title>
        这些联系方式将显示在购物网站底部，上线前请替换为真实数据。
      </template>
    </el-alert>

    <el-form ref="formRef" :model="form" label-width="120px" style="max-width: 600px">
      <el-form-item v-for="(label, key) in labels" :key="key" :label="label">
        <el-input v-model="form[key]" :placeholder="`请输入${label}`" maxlength="500" show-word-limit />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">社交媒体</el-divider>

    <div class="social-section" v-loading="socialLoading">
      <div v-for="row in socials" :key="row.key" class="social-item" :class="{ 'is-removed': row.removed }">
        <div class="social-info">
          <div class="social-name-line">
            <el-input
              v-model="row.name"
              maxlength="30"
              class="social-name-input"
              :disabled="row.removed"
              placeholder="平台名称"
            />
            <el-tag v-if="row.removed" type="danger" size="small" effect="light">将删除</el-tag>
            <el-tag v-else-if="isRowDirty(row)" type="warning" size="small" effect="light">未保存</el-tag>
          </div>
          <div class="social-hint">显示在二维码图片下方的名称</div>
        </div>
        <div class="qr-preview">
          <el-image :src="resolve(displayImage(row))" fit="cover" class="qr-image"><template #error><img class="image-fallback" :src="IMG_FALLBACK" alt="" /></template></el-image>
        </div>
        <div class="qr-actions">
          <template v-if="!row.removed">
            <el-upload :show-file-list="false" :auto-upload="false" accept=".jpg,.jpeg,.png,.bmp,.webp" :on-change="file => pickImage(row, file)">
              <el-button size="small">
                <template v-if="row.pendingImage">重新选择</template>
                <template v-else>{{ row.image_url ? '更换二维码' : '上传二维码' }}</template>
              </el-button>
            </el-upload>
            <el-button size="small" type="danger" plain @click="removeSocial(row)">删除</el-button>
          </template>
          <el-button v-else size="small" type="primary" plain @click="row.removed = false">撤销删除</el-button>
        </div>
      </div>

      <div class="social-empty" v-if="!socials.length">尚未添加社交媒体，请点击下方按钮新增。</div>

      <div class="social-bar">
        <span class="social-bar-hint" :class="{ 'is-active': hasChanges }">
          {{ hasChanges ? `有 ${pendingCount} 项修改待保存` : '暂无未保存的修改' }}
        </span>
        <div class="social-bar-btns">
          <el-button type="primary" :loading="savingSocial" :disabled="!hasChanges" @click="saveSocial">保存修改</el-button>
          <el-button type="primary" plain @click="addSocial">＋ 新增社交媒体</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.social-section { display: flex; flex-direction: column; gap: 14px; max-width: 640px; min-height: 60px }
.social-item { display: flex; align-items: center; gap: 16px; border: 1px solid #ebeef5; border-radius: 8px; padding: 12px 16px; transition: opacity 0.2s }
.social-item.is-removed { opacity: 0.55 }
.social-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px }
.social-name-line { display: flex; align-items: center; gap: 8px; width: 100% }
.social-name-input { max-width: 240px }
.social-hint { font-size: 12px; color: #909399 }
.social-empty { color: #909399; font-size: 13px }
.qr-preview { width: 88px; height: 88px; border: 1px dashed #dcdfe6; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0 }
.qr-image { width: 100%; height: 100% }
.image-fallback { width: 100%; height: 100%; object-fit: cover; display: block }
.qr-placeholder { font-size: 12px; color: #909399 }
.qr-actions { display: flex; gap: 8px; flex-shrink: 0 }
.social-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px }
.social-bar-hint { font-size: 12px; color: #909399 }
.social-bar-hint.is-active { color: #e6a23c }
.social-bar-btns { display: flex; gap: 10px }
</style>
