<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../../stores/user'
import api from '../../services/api'
import { resolve } from '../../utils/image'

const userStore = useUserStore(); const profile = ref(null); const contact = reactive({ phone: '', email: '' }); const password = reactive({ current_password: '', new_password: '', confirm: '' }); const avatarFile = ref(null); const avatarPreview = ref('')
const loading = ref(false)
async function load() { const { data } = await api.get('/admin/profile'); profile.value = data.user; contact.phone = data.user.phone || ''; contact.email = data.user.email || ''; avatarPreview.value = data.user.avatar_url || '' }
async function saveContact() { try { const { data } = await api.put('/admin/profile', contact); userStore.setAdminUser(data.user); profile.value = data.user; ElMessage.success('联系方式已更新') } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } }
async function savePassword() { if (password.new_password !== password.confirm) return ElMessage.error('两次输入的新密码不一致'); try { const { data } = await api.put('/admin/profile', { current_password: password.current_password, new_password: password.new_password }); userStore.setAdminUser(data.user); profile.value = data.user; Object.assign(password, { current_password: '', new_password: '', confirm: '' }); ElMessage.success('密码已更新') } catch (error) { ElMessage.error(error.response?.data?.message || '修改失败') } }
function chooseAvatar(uploadFile) { if (!uploadFile.raw) return; if (uploadFile.raw.size > 5 * 1024 * 1024) return ElMessage.error('图片不能超过 5MB'); avatarFile.value = uploadFile.raw; avatarPreview.value = URL.createObjectURL(uploadFile.raw) }
async function saveAvatar() { if (!avatarFile.value) return ElMessage.info('请先选择图片'); const body = new FormData(); body.append('avatar', avatarFile.value); try { const { data } = await api.put('/admin/profile', body); userStore.setAdminUser(data.user); profile.value = data.user; avatarPreview.value = data.user.avatar_url; avatarFile.value = null; ElMessage.success('头像已更新') } catch (error) { ElMessage.error(error.response?.data?.message || '上传失败') } }
onMounted(load)
</script>

<template>
  <div v-if="profile" class="profile-grid"><el-card shadow="never"><template #header>个人资料</template><div class="avatar-panel"><el-avatar :size="104" :src="resolve(avatarPreview)"><template #default>{{ (profile.username || '?').slice(0, 1) }}</template></el-avatar><el-upload :show-file-list="false" :auto-upload="false" accept=".jpg,.jpeg,.png,.bmp,.webp" :on-change="chooseAvatar"><el-button>选择头像</el-button></el-upload><el-button type="primary" :disabled="!avatarFile" @click="saveAvatar">上传</el-button><small>支持 JPG、PNG、BMP、WebP，最大 5MB</small></div><el-descriptions :column="1" border><el-descriptions-item label="账号">{{ profile.username }}</el-descriptions-item><el-descriptions-item label="角色">{{ profile.role === 'super_admin' ? '超级管理员' : '管理员' }}</el-descriptions-item></el-descriptions></el-card>
    <div class="profile-forms"><el-alert v-if="profile.must_change_password" type="warning" :closable="false" title="这是初始密码，请先修改密码后再使用后台其他功能。" style="margin-bottom:16px" /><el-card shadow="never" header="联系方式"><el-form :model="contact" label-width="72px"><el-form-item label="电话"><el-input v-model="contact.phone" /></el-form-item><el-form-item label="邮箱"><el-input v-model="contact.email" /></el-form-item><el-button type="primary" :loading="loading" @click="saveContact">保存联系方式</el-button></el-form></el-card><el-card shadow="never" header="修改密码" style="margin-top:16px"><el-form :model="password" label-width="92px"><el-form-item label="原密码"><el-input v-model="password.current_password" type="password" show-password /></el-form-item><el-form-item label="新密码"><el-input v-model="password.new_password" type="password" show-password /></el-form-item><el-form-item label="确认新密码"><el-input v-model="password.confirm" type="password" show-password /></el-form-item><el-button type="primary" @click="savePassword">更新密码</el-button></el-form></el-card></div>
  </div>
</template>

<style scoped>
.profile-grid { display:grid; grid-template-columns:minmax(260px, .8fr) minmax(360px, 1.2fr); gap:20px }.avatar-panel { display:flex; flex-direction:column; align-items:center; gap:12px; margin-bottom:24px }.avatar-panel small { color:#909399; text-align:center } @media (max-width: 768px) { .profile-grid { grid-template-columns:1fr } }
</style>
