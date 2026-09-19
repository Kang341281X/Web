<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { resolve } from '../../utils/image'
import { useIsMobile } from '../../composables/useIsMobile'

// 移动端去掉操作列 fixed，避免固定列吃掉窄屏本就稀缺的可视宽度
const isMobile = useIsMobile()
const loading = ref(false); const list = ref([]); const total = ref(0); const page = ref(1); const keyword = ref('')
const dialogVisible = ref(false); const isEditing = ref(false); const selectedId = ref(null)
const form = reactive({ username: '', password: '', real_name: '', phone: '', email: '', status: 1 })
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }, { min: 3, max: 50, message: '账号为 3-50 个字符', trigger: 'blur' }],
  password: [{ required: true, message: '请输入初始密码', trigger: 'blur' }, { min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  real_name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }]
}
const formRef = ref()
function resetForm() { Object.assign(form, { username: '', password: '', real_name: '', phone: '', email: '', status: 1 }); selectedId.value = null }
async function load() {
  loading.value = true
  try { const { data } = await api.get('/admins', { params: { page: page.value, page_size: 10, keyword: keyword.value } }); list.value = data.data; total.value = data.pagination.total } catch (error) { ElMessage.error(error.response?.data?.message || '加载管理员失败') } finally { loading.value = false }
}
function openCreate() { resetForm(); isEditing.value = false; dialogVisible.value = true }
function openEdit(row) { Object.assign(form, { username: row.username, password: '', real_name: row.real_name, phone: row.phone || '', email: row.email || '', status: row.status }); selectedId.value = row.id; isEditing.value = true; dialogVisible.value = true }
async function save() {
  await formRef.value.validate()
  try {
    if (isEditing.value) await api.put(`/admins/${selectedId.value}`, { real_name: form.real_name, phone: form.phone, email: form.email, status: form.status })
    else await api.post('/admins', form)
    ElMessage.success(isEditing.value ? '管理员已更新' : '管理员已创建'); dialogVisible.value = false; load()
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') }
}
async function remove(row) {
  try { await ElMessageBox.confirm(`确认删除管理员“${row.username}”吗？`, '删除确认', { type: 'warning' }); await api.delete(`/admins/${row.id}`); ElMessage.success('已删除'); if (list.value.length === 1 && page.value > 1) page.value--; load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') }
}
async function resetPassword(row) {
  try { const { value } = await ElMessageBox.prompt(`为“${row.username}”设置新密码`, '重置密码', { inputType: 'password', inputPattern: /^.{6,}$/, inputErrorMessage: '密码至少 6 位' }); await api.put(`/admins/${row.id}/reset-password`, { password: value }); ElMessage.success('密码已重置，用户下次登录须修改密码') } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '重置失败') }
}
onMounted(load)
</script>

<template>
  <el-card shadow="never" class="admin-page-card admin-table-page">
    <template #header><div class="page-header"><span>管理员信息</span><el-button type="primary" @click="openCreate">新增管理员</el-button></div></template>
    <div class="list-toolbar"><el-input v-model="keyword" clearable placeholder="搜索账号、姓名、电话或邮箱" style="max-width: 320px" @keyup.enter="page = 1; load()" @clear="page = 1; load()" /><el-button @click="page = 1; load()">搜索</el-button></div>
    <el-table v-loading="loading" :data="list" height="100%" stripe style="width: 100%">
      <el-table-column label="管理员" min-width="160"><template #default="{ row }"><div class="user-cell"><el-avatar :src="resolve(row.avatar_url)"><template #default>{{ (row.real_name || row.username || '?').slice(0, 1) }}</template></el-avatar><span>{{ row.username }}</span></div></template></el-table-column>
      <el-table-column prop="real_name" label="姓名" width="100" />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column prop="email" label="邮箱" width="180" />
      <el-table-column label="角色" width="116"><template #default="{ row }"><el-tag :type="row.role === 'super_admin' ? 'danger' : 'info'">{{ row.role === 'super_admin' ? '超级管理员' : '管理员' }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="84"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '禁用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="214" :fixed="isMobile ? false : 'right'"><template #default="{ row }"><template v-if="row.role !== 'super_admin'"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link type="warning" @click="resetPassword(row)">重置密码</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template><span v-else class="muted">受保护</span></template></el-table-column>
    </el-table>
    <div class="pagination"><el-pagination v-model:current-page="page" :page-size="10" :total="total" layout="total, prev, pager, next" @current-change="load" /></div>
  </el-card>
  <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑管理员' : '新增管理员'" width="min(520px, calc(100% - 32px))" @closed="resetForm">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="92px"><el-form-item label="账号" prop="username"><el-input v-model="form.username" :disabled="isEditing" /></el-form-item><el-form-item v-if="!isEditing" label="初始密码" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item><el-form-item label="姓名" prop="real_name"><el-input v-model="form.real_name" /></el-form-item><el-form-item label="联系电话"><el-input v-model="form.phone" /></el-form-item><el-form-item label="邮箱" prop="email"><el-input v-model="form.email" /></el-form-item><el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" /></el-form-item></el-form>
    <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</template>

<style scoped>
.page-header,.list-toolbar,.user-cell { display:flex; align-items:center; gap:12px }.page-header { justify-content:space-between; font-size:18px; font-weight:600 }.list-toolbar { margin-bottom:16px }.user-cell { gap:8px }.pagination { display:flex; justify-content:flex-end; margin-top:18px }.muted { color:#909399; font-size:13px } @media (max-width: 600px) { .list-toolbar { align-items:stretch; flex-direction:column }.pagination { justify-content:center } }
</style>
