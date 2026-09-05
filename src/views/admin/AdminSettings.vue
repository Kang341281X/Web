<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../services/api'

const formRef = ref(null); const loading = ref(false); const saving = ref(false)
const form = reactive({ contact_email: '', contact_phone: '', xiaohongshu: '', douyin: '', tiktok: '', telegram: '' })
const labels = { contact_email: '联系邮箱', contact_phone: '联系电话', xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok', telegram: 'Telegram' }

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
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
</style>
