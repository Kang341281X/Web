<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'

const categories = ref([]); const loading = ref(false); const dialogVisible = ref(false); const editingId = ref(null); const formRef = ref()
const form = reactive({ name: '', parent_id: 0, sort_order: 0, status: 1 })
const rules = { name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }] }
const parentOptions = computed(() => categories.value.filter(item => item.id !== editingId.value))
async function load() { loading.value = true; try { const { data } = await api.get('/categories'); categories.value = data.data } catch (error) { ElMessage.error(error.response?.data?.message || '分类加载失败') } finally { loading.value = false } }
function reset() { Object.assign(form, { name: '', parent_id: 0, sort_order: 0, status: 1 }); editingId.value = null }
function create() { reset(); dialogVisible.value = true }
function edit(row) { Object.assign(form, { name: row.name, parent_id: row.parent_id, sort_order: row.sort_order, status: row.status }); editingId.value = row.id; dialogVisible.value = true }
async function save() { await formRef.value.validate(); try { if (editingId.value) await api.put(`/categories/${editingId.value}`, form); else await api.post('/categories', form); ElMessage.success('分类已保存'); dialogVisible.value = false; load() } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } }
async function remove(row) { try { await ElMessageBox.confirm(`确认删除分类“${row.name}”吗？`, '删除确认', { type: 'warning' }); await api.delete(`/categories/${row.id}`); ElMessage.success('分类已删除'); load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
function parentName(parentId) { return parentId ? categories.value.find(item => item.id === parentId)?.name || '-' : '顶级分类' }
onMounted(load)
</script>

<template>
  <el-card shadow="never" class="admin-page-card">
    <template #header><div class="page-header"><span>商品分类</span><el-button type="primary" @click="create">新增分类</el-button></div></template>
    <el-table v-loading="loading" :data="categories" row-key="id" stripe><el-table-column type="index" label="序号" width="70" /><el-table-column prop="name" label="分类名称" min-width="180" /><el-table-column label="父级分类" min-width="130"><template #default="{ row }">{{ parentName(row.parent_id) }}</template></el-table-column><el-table-column prop="sort_order" label="排序" width="100" /><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '禁用' }}</el-tag></template></el-table-column><el-table-column label="操作" width="140"><template #default="{ row }"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column></el-table>
  </el-card>
  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑分类' : '新增分类'" width="min(500px, calc(100% - 32px))" @closed="reset"><el-form ref="formRef" :model="form" :rules="rules" label-width="88px"><el-form-item label="分类名称" prop="name"><el-input v-model="form.name" maxlength="50" show-word-limit /></el-form-item><el-form-item label="父级分类"><el-select v-model="form.parent_id" style="width:100%"><el-option :value="0" label="顶级分类" /><el-option v-for="item in parentOptions" :key="item.id" :value="item.id" :label="item.name" /></el-select></el-form-item><el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item><el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" /></el-form-item></el-form><template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template></el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; font-size:18px; font-weight:600 }
</style>
