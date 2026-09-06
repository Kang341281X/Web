<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import ImportDialog from '../../components/admin/ImportDialog.vue'
import ImageCropDialog from '../../components/admin/ImageCropDialog.vue'

const route = useRoute(); const loading = ref(false); const products = ref([]); const categories = ref([]); const total = ref(0); const selected = ref([])
const query = reactive({ keyword: '', category_id: route.query.category_id ? Number(route.query.category_id) : '', page: 1, page_size: 20 })
const dialogVisible = ref(false); const saving = ref(false); const formRef = ref(); const form = reactive(defaultForm()); const images = ref([]); const newFiles = ref([]); const editing = computed(() => Boolean(form.id)); const importDialogVisible = ref(false)
const rules = { name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }], category_id: [{ required: true, message: '请选择分类', trigger: 'change' }], price: [{ required: true, message: '请输入售价', trigger: 'blur' }] }
// 裁剪对话框状态
const cropVisible = ref(false); const cropSrc = ref(''); const cropImageId = ref(null); const cropNewIndex = ref(null)
function defaultForm() { return { id: null, name: '', category_id: '', price: 0, original_price: null, stock: 0, sales: 0, unit: '', manufacturer: '', brand: '', description: '', detail: '', status: 1 } }
const activeCategories = computed(() => categories.value.filter(item => item.status))
async function loadCategories() { const { data } = await api.get('/categories'); categories.value = data.data }
async function load() { loading.value = true; try { const { data } = await api.get('/products', { params: query }); products.value = data.data; total.value = data.pagination.total; selected.value = [] } catch (error) { ElMessage.error(error.response?.data?.message || '商品加载失败') } finally { loading.value = false } }
function search() { query.page = 1; load() }
function clearFilter() { query.category_id = ''; search() }
function handleSelection(rows) { selected.value = rows }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function resetForm() { Object.assign(form, defaultForm()); images.value = []; newFiles.value = [] }
function openCreate() { resetForm(); dialogVisible.value = true }
async function openEdit(row) { try { const { data } = await api.get(`/products/${row.id}`); Object.assign(form, data.data); images.value = data.data.images; newFiles.value = []; dialogVisible.value = true } catch (error) { ElMessage.error(error.response?.data?.message || '商品详情加载失败') } }
async function uploadNewFiles(productId) { if (!newFiles.value.length) return null; const body = new FormData(); newFiles.value.forEach(file => body.append('images', file.raw || file)); const { data } = await api.post(`/products/${productId}/images`, body); images.value = data.data.images; newFiles.value = []; return data.data }
async function save() {
  try {
    await formRef.value.validate()
    if (!editing.value && !newFiles.value.length) return ElMessage.error('新增商品至少上传一张图片')
    saving.value = true
    let productId = form.id
    if (editing.value) await api.put(`/products/${productId}`, form)
    else { const { data } = await api.post('/products', form); productId = data.data.id; form.id = productId }
    await uploadNewFiles(productId)
    if (images.value.length) await api.put(`/products/${productId}/images/sort`, { images: images.value.map((image, index) => ({ id: image.id, sort_order: index })) })
    ElMessage.success('商品已保存'); dialogVisible.value = false; load()
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } finally { saving.value = false }
}
async function removeImage(image) { try { await ElMessageBox.confirm('确认删除这张图片吗？', '删除图片', { type: 'warning' }); await api.delete(`/products/images/${image.id}`); images.value = images.value.filter(item => item.id !== image.id); ElMessage.success('图片已删除') } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
async function setMain(image) {
  try {
    const { data } = await api.put(`/products/images/${image.id}/set-main`)
    // 主图移到第一位，原主图变为子图
    const updatedImages = data.data.images
    // 按 sort_order 排序，主图在最前
    updatedImages.sort((a, b) => (b.is_main - a.is_main) || (a.sort_order - b.sort_order))
    images.value = updatedImages
    ElMessage.success('已设为主图')
  } catch (error) { ElMessage.error(error.response?.data?.message || '设置失败') }
}
function validateUpload(file) { const allowed = ['image/jpeg', 'image/png', 'image/webp']; if (!allowed.includes(file.raw?.type || file.type)) { ElMessage.error('仅支持 JPG、PNG、WebP 图片'); return false } if ((file.raw?.size || file.size) > 5 * 1024 * 1024) { ElMessage.error('图片不能超过 5MB'); return false } return true }
async function removeProduct(row) { try { await ElMessageBox.confirm(`确认删除商品"${row.name}"吗？图片也会同步删除。`, '删除确认', { type: 'warning' }); await api.delete(`/products/${row.id}`); ElMessage.success('商品已删除'); load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
async function batchRemove() { if (!selected.value.length) return; try { await ElMessageBox.confirm(`确认删除已选的 ${selected.value.length} 个商品吗？`, '批量删除确认', { type: 'warning' }); await api.post('/products/batch-delete', { ids: selected.value.map(item => item.id) }); ElMessage.success('商品已删除'); load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
async function exportProducts(mode) { try { const { data } = await api.post('/products/export', { mode, keyword: query.keyword, category_id: query.category_id || null, ids: selected.value.map(item => item.id) }, { responseType: 'blob' }); const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = '商品数据.xlsx'; link.click(); URL.revokeObjectURL(url) } catch (error) { ElMessage.error(error.response?.data?.message || '导出失败') } }
function openProduct(row) { window.open(row.frontend_detail_url || `/product/${row.id}`, '_blank', 'noopener') }
// 点击已有图片 → 打开裁剪对话框
function openImageCrop(image) { cropSrc.value = image.image_url_full; cropImageId.value = image.id; cropNewIndex.value = null; cropVisible.value = true }
// 点击新图片 → 打开裁剪对话框
function openNewFileCrop(index) {
  const file = newFiles.value[index]
  const src = file.url || (file.raw ? URL.createObjectURL(file.raw) : '')
  cropSrc.value = src; cropImageId.value = null; cropNewIndex.value = index; cropVisible.value = true
}
// 裁剪完成回调
function onCropped(result) {
  if (result.imageId) {
    // 已有图片裁剪替换，刷新图片列表
    images.value = result.data.images
  } else if (result.blob && cropNewIndex.value != null) {
    // 新图片裁剪，替换 newFiles 中的文件
    const idx = cropNewIndex.value
    const oldFile = newFiles.value[idx]
    const newFile = new File([result.blob], oldFile?.name || 'cropped.jpg', { type: 'image/jpeg' })
    newFile.uid = oldFile?.uid || Date.now()
    newFile.url = result.url
    newFiles.value[idx] = newFile
  }
  cropImageId.value = null; cropNewIndex.value = null
}
watch(() => route.query.category_id, value => { query.category_id = value ? Number(value) : ''; query.page = 1; load() })
onMounted(async () => { try { await loadCategories(); await load() } catch (error) { ElMessage.error(error.response?.data?.message || '初始化失败') } })
</script>

<template>
  <el-card shadow="never" class="admin-page-card">
    <div class="toolbar"><div class="toolbar-search"><el-input v-model="query.keyword" clearable placeholder="商品名称、生产厂家或品牌" @keyup.enter="search" @clear="search" /><el-select v-model="query.category_id" clearable placeholder="全部分类" @change="search"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select><el-button type="primary" @click="search">搜索</el-button><el-button v-if="query.category_id" @click="clearFilter">清空分类</el-button></div><div class="toolbar-actions"><el-button type="danger" :disabled="!selected.length" @click="batchRemove">批量删除</el-button><el-dropdown @command="exportProducts"><el-button>导出<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="filter">导出筛选结果</el-dropdown-item><el-dropdown-item command="selected" :disabled="!selected.length">导出勾选项</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button type="success" @click="importDialogVisible = true">批量导入</el-button><el-button type="primary" @click="openCreate">新增商品</el-button></div></div>
    <el-table v-loading="loading" :data="products" @selection-change="handleSelection" style="width:100%"><el-table-column type="selection" width="48" /><el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column><el-table-column label="商品" min-width="250"><template #default="{ row }"><div class="product-cell"><el-image :src="row.main_image_url || '/assets/images/products/product-placeholder.svg'" fit="cover" /><div><div>{{ row.name }}</div><small>{{ row.brand || '未设置品牌' }} · {{ row.manufacturer || '未设置厂家' }}</small></div></div></template></el-table-column><el-table-column prop="category_name" label="分类" min-width="110" /><el-table-column label="售价" width="100"><template #default="{ row }">¥{{ row.price.toFixed(2) }}</template></el-table-column><el-table-column prop="stock" label="库存" width="90" /><el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '上架' : '下架' }}</el-tag></template></el-table-column><el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link @click="openProduct(row)">跳转</el-button><el-button link type="danger" @click="removeProduct(row)">删除</el-button></template></el-table-column></el-table>
    <div class="pagination"><el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" /></div>
  </el-card>
  <el-dialog v-model="dialogVisible" :title="editing ? '编辑商品' : '新增商品'" width="min(920px, calc(100% - 24px))" top="4vh" destroy-on-close @closed="resetForm"><el-form ref="formRef" :model="form" :rules="rules" label-width="86px"><el-row :gutter="16"><el-col :xs="24" :sm="12"><el-form-item label="商品名称" prop="name"><el-input v-model="form.name" /></el-form-item></el-col><el-col :xs="24" :sm="12"><el-form-item label="商品分类" prop="category_id"><el-select v-model="form.category_id" style="width:100%"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="售价" prop="price"><el-input-number v-model="form.price" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="原价"><el-input-number v-model="form.original_price" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="库存"><el-input-number v-model="form.stock" :min="0" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="单位"><el-input v-model="form.unit" placeholder="如：件、盒" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="生产厂家"><el-input v-model="form.manufacturer" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="品牌"><el-input v-model="form.brand" /></el-form-item></el-col></el-row><el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="上架" inactive-text="下架" /></el-form-item><el-form-item label="简要描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item><el-form-item label="商品详情"><el-input v-model="form.detail" type="textarea" :rows="4" placeholder="可填写富文本 HTML" /></el-form-item><el-form-item label="图片"><div class="image-manager"><draggable v-model="images" item-key="id" class="existing-images" ghost-class="dragging"><template #item="{ element }"><div class="image-card" @click="openImageCrop(element)"><el-image :src="element.image_url_full" fit="cover" /><el-tag v-if="element.is_main" size="small" type="success">主图</el-tag><div class="image-card-actions" @click.stop><el-button v-if="!element.is_main" link type="primary" @click="setMain(element)">设为主图</el-button><el-button link type="danger" @click="removeImage(element)">删除</el-button></div></div></template></draggable><el-upload v-model:file-list="newFiles" list-type="picture-card" :auto-upload="false" multiple accept=".jpg,.jpeg,.png,.webp" :on-change="file => validateUpload(file)" :limit="10"><el-icon><Plus /></el-icon><template #tip><div class="el-upload__tip">拖拽已有图片调整排序；点击图片可预览裁剪；JPG、PNG、WebP，单张不超过 5MB</div></template></el-upload><div v-if="newFiles.length" class="new-files-list"><div v-for="(file, index) in newFiles" :key="index" class="image-card new-file-card" @click="openNewFileCrop(index)"><el-image :src="file.url || (file.raw ? URL.createObjectURL(file.raw) : '')" fit="cover" /></div></div></div></el-form-item></el-form><template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存商品</el-button></template>  </el-dialog>
<ImportDialog v-model:visible="importDialogVisible" @success="load" />
<ImageCropDialog v-model:visible="cropVisible" :src="cropSrc" :image-id="cropImageId" :product-id="form.id" @cropped="onCropped" />
</template>

<style scoped>
.toolbar,.toolbar-search,.toolbar-actions,.product-cell,.existing-images { display:flex; align-items:center; gap:10px }.toolbar { justify-content:space-between; margin-bottom:16px }.toolbar-search { flex-wrap:wrap }.toolbar-search .el-input { width:260px }.toolbar-search .el-select { width:160px }.toolbar-actions { flex-wrap:wrap; justify-content:flex-end }.product-cell { gap:10px }.product-cell .el-image { width:48px; height:48px; border-radius:4px; flex:none }.product-cell small { color:#909399 }.pagination { display:flex; justify-content:flex-end; margin-top:18px }.image-manager { width:100% }.existing-images { flex-wrap:wrap; min-height:0; margin-bottom:10px }.new-files-list { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px }.new-file-card { width:118px } .image-card { width:118px; position:relative; border:1px solid #dcdfe6; border-radius:4px; padding:4px; cursor:pointer }.image-card .el-image { width:108px; height:108px }.image-card .el-tag { position:absolute; top:8px; left:8px }.image-card-actions { display:flex; justify-content:center; gap:4px }.dragging { opacity:.4 } @media (max-width: 768px) { .toolbar { align-items:stretch; flex-direction:column }.toolbar-actions { justify-content:flex-start }.toolbar-search .el-input,.toolbar-search .el-select { width:100% }.pagination { justify-content:center } }
</style>
