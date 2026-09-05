<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'

const formRef = ref(null); const loading = ref(false); const saving = ref(false)
const form = reactive({ contact_email: '', contact_phone: '', xiaohongshu: '', douyin: '', tiktok: '', telegram: '' })
const labels = { contact_email: '联系邮箱', contact_phone: '联系电话', xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok', telegram: 'Telegram' }

// 社交媒体二维码
const socialKeys = ['xiaohongshu', 'douyin', 'tiktok', 'telegram']
const qrImages = reactive({ xiaohongshu_qr: '', douyin_qr: '', tiktok_qr: '', telegram_qr: '' })
const qrKeyMap = { xiaohongshu: 'xiaohongshu_qr', douyin: 'douyin_qr', tiktok: 'tiktok_qr', telegram: 'telegram_qr' }
const qrUploading = reactive({ xiaohongshu_qr: false, douyin_qr: false, tiktok_qr: false, telegram_qr: false })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/settings')
    for (const item of data.data) {
      if (item.setting_key in form) form[item.setting_key] = item.setting_value || ''
      if (item.setting_key in qrImages) qrImages[item.setting_key] = item.setting_value || ''
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

async function uploadQr(socialKey, file) {
  if (!file.raw) return
  const qrKey = qrKeyMap[socialKey]
  if (file.raw.size > 5 * 1024 * 1024) { ElMessage.error('图片不能超过 5MB'); return false }
  qrUploading[qrKey] = true
  try {
    const body = new FormData()
    body.append('key', qrKey)
    body.append('image', file.raw)
    const { data } = await api.post('/settings/qr', body)
    qrImages[qrKey] = data.data.url
    ElMessage.success('二维码已上传')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '上传失败')
  } finally {
    qrUploading[qrKey] = false
  }
  return false
}

async function deleteQr(socialKey) {
  const qrKey = qrKeyMap[socialKey]
  try {
    await ElMessageBox.confirm('确认删除此二维码图片吗？', '删除确认', { type: 'warning' })
    await api.delete(`/settings/qr/${qrKey}`)
    qrImages[qrKey] = ''
    ElMessage.success('二维码已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败')
  }
}

onMounted(load)
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

    <el-divider content-position="left">社交媒体二维码</el-divider>

    <div class="qr-grid">
      <div v-for="socialKey in socialKeys" :key="socialKey" class="qr-item">
        <div class="qr-label">{{ labels[socialKey] }}</div>
        <div class="qr-preview">
          <el-image v-if="qrImages[qrKeyMap[socialKey]]" :src="qrImages[qrKeyMap[socialKey]]" fit="cover" class="qr-image" />
          <div v-else class="qr-placeholder">暂无二维码</div>
        </div>
        <div class="qr-actions">
          <el-upload :show-file-list="false" :auto-upload="false" accept=".jpg,.jpeg,.png,.webp" :on-change="file => uploadQr(socialKey, file)">
            <el-button size="small" :loading="qrUploading[qrKeyMap[socialKey]]">{{ qrImages[qrKeyMap[socialKey]] ? '更换' : '上传' }}</el-button>
          </el-upload>
          <el-button v-if="qrImages[qrKeyMap[socialKey]]" size="small" type="danger" @click="deleteQr(socialKey)">删除</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; max-width: 700px }
.qr-item { display: flex; flex-direction: column; align-items: center; gap: 10px }
.qr-label { font-weight: 600; font-size: 14px; color: #303133 }
.qr-preview { width: 120px; height: 120px; border: 1px dashed #dcdfe6; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center }
.qr-image { width: 100%; height: 100% }
.qr-placeholder { font-size: 12px; color: #909399 }
.qr-actions { display: flex; gap: 8px }
</style>
