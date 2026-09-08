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
const dialogVisible = ref(false); const saving = ref(false); const formRef = ref(); const form = reactive(defaultForm()); const images = ref([]); const editing = computed(() => Boolean(form.id)); const importDialogVisible = ref(false)
const rules = { name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }], category_id: [{ required: true, message: '请选择分类', trigger: 'change' }], price: [{ required: true, message: '请输入售价', trigger: 'blur' }] }
// 裁剪对话框状态
const cropVisible = ref(false); const cropSrc = ref(''); const cropImageId = ref(null); const cropNewUid = ref(null)
// 主图（第一层）和子图（第二层）的计算属性
const mainImage = computed(() => images.value.find(img => img.is_main) || null)
const subImages = computed(() => images.value.filter(img => !img.is_main))
// 新文件计数器，用于生成临时 ID
let newFileSeq = 0
function defaultForm() { return { id: null, name: '', category_id: '', price: 0, original_price: null, stock: 0, sales: 0, unit: '', manufacturer: '', brand: '', description: '', detail: '', status: 1 } }
const activeCategories = computed(() => categories.value.filter(item => item.status))
async function loadCategories() { const { data } = await api.get('/categories'); categories.value = data.data }
async function load() { loading.value = true; try { const { data } = await api.get('/products', { params: query }); products.value = data.data; total.value = data.pagination.total; selected.value = [] } catch (error) { ElMessage.error(error.response?.data?.message || '商品加载失败') } finally { loading.value = false } }
function search() { query.page = 1; load() }
function clearFilter() { query.category_id = ''; search() }
function handleSelection(rows) { selected.value = rows }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function resetForm() { Object.assign(form, defaultForm()); images.value = [] }
function openCreate() { resetForm(); dialogVisible.value = true }
async function openEdit(row) { try { const { data } = await api.get(`/products/${row.id}`); Object.assign(form, data.data); images.value = data.data.images; dialogVisible.value = true } catch (error) { ElMessage.error(error.response?.data?.message || '商品详情加载失败') } }
async function uploadNewFiles(productId) {
  const newImgs = images.value.filter(img => img.is_new)
  if (!newImgs.length) return null
  const body = new FormData()
  newImgs.forEach(img => body.append('images', img._file))
  // 设置第一张新图是否为主图
  const hasExistingMain = images.value.some(img => img.is_main && !img.is_new)
  if (!hasExistingMain) {
    // 没有已有主图，第一张新图作为主图
    body.append('first_is_main', 'true')
  }
  const { data } = await api.post(`/products/${productId}/images`, body)
  images.value = data.data.images
  return data.data
}
async function save() {
  try {
    await formRef.value.validate()
    saving.value = true
    let productId = form.id
    if (editing.value) await api.put(`/products/${productId}`, form)
    else { const { data } = await api.post('/products', form); productId = data.data.id; form.id = productId }
    await uploadNewFiles(productId)
    // 只对已保存的图片排序（新图已在上传时处理）
    const savedImages = images.value.filter(img => !img.is_new)
    if (savedImages.length) await api.put(`/products/${productId}/images/sort`, { images: savedImages.map((image, index) => ({ id: image.id, sort_order: index })) })
    ElMessage.success('商品已保存'); dialogVisible.value = false; load()
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } finally { saving.value = false }
}
async function removeImage(image) {
  // 新图片直接从前端移除，无需调用后端
  if (image.is_new) {
    const wasMain = image.is_main
    images.value = images.value.filter(item => item._uid !== image._uid)
    // 删除的是主图 → 第一张子图自动顶替
    if (wasMain) promoteFirstSubToMain()
    ElMessage.success('图片已移除')
    return
  }
  try {
    await ElMessageBox.confirm('确认删除这张图片吗？', '删除图片', { type: 'warning' })
    await api.delete(`/products/images/${image.id}`)
    const wasMain = image.is_main
    images.value = images.value.filter(item => item.id !== image.id)
    // 删除的是主图 → 第一张子图自动顶替
    if (wasMain) promoteFirstSubToMain()
    ElMessage.success('图片已删除')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') }
}
// 主图被删除后，将第一张子图提升为主图
function promoteFirstSubToMain() {
  const first = images.value[0]
  if (first) {
    images.value = images.value.map((img, idx) => ({ ...img, is_main: idx === 0 ? 1 : 0 }))
    // 如果顶替的是已保存的图片，调后端更新
    if (!first.is_new && first.id) {
      api.put(`/products/images/${first.id}/set-main`).catch(() => {})
    }
  }
}
async function setMain(image) {
  // 新图片设为主图：前端切换即可，保存时后端会处理
  if (image.is_new) {
    images.value = images.value.map(img => ({ ...img, is_main: img._uid === image._uid ? 1 : 0 }))
    ElMessage.success('已设为主图')
    return
  }
  try {
    const { data } = await api.put(`/products/images/${image.id}/set-main`)
    images.value = data.data.images
    ElMessage.success('已设为主图')
  } catch (error) { ElMessage.error(error.response?.data?.message || '设置失败') }
}
function onSubImageReorder() {
  // subImages 的顺序通过 draggable 修改后，重建 images 数组：主图在前，子图在后
  const main = images.value.find(img => img.is_main) || null
  images.value = main ? [main, ...subImages.value] : [...subImages.value]
}
function onFileChange(uploadFile) {
  const file = uploadFile.raw
  const allowed = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp']
  if (!allowed.includes(file?.type)) { ElMessage.error('仅支持 JPG、PNG、BMP、WebP 图片'); return false }
  if (file.size > 5 * 1024 * 1024) { ElMessage.error('图片不能超过 5MB'); return false }
  // 创建虚拟图片对象，混入 images 数组
  const uid = `_new_${++newFileSeq}`
  const url = URL.createObjectURL(file)
  const hasMain = images.value.some(img => img.is_main)
  const newImg = {
    _uid: uid,
    _file: file,
    is_new: true,
    image_url_full: url,
    is_main: hasMain ? 0 : 1,
  }
  images.value.push(newImg)
}
async function removeProduct(row) { try { await ElMessageBox.confirm(`确认删除商品"${row.name}"吗？图片也会同步删除。`, '删除确认', { type: 'warning' }); await api.delete(`/products/${row.id}`); ElMessage.success('商品已删除'); load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
async function batchRemove() { if (!selected.value.length) return; try { await ElMessageBox.confirm(`确认删除已选的 ${selected.value.length} 个商品吗？`, '批量删除确认', { type: 'warning' }); await api.post('/products/batch-delete', { ids: selected.value.map(item => item.id) }); ElMessage.success('商品已删除'); load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') } }
async function exportProducts(mode) { try { const { data } = await api.post('/products/export', { mode, keyword: query.keyword, category_id: query.category_id || null, ids: selected.value.map(item => item.id) }, { responseType: 'blob' }); const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = '商品数据.xlsx'; link.click(); URL.revokeObjectURL(url) } catch (error) { ElMessage.error(error.response?.data?.message || '导出失败') } }
function openProduct(row) { window.open(row.frontend_detail_url || `/product/${row.id}`, '_blank', 'noopener') }
// 点击图片 → 打开裁剪对话框（已有图片和新图片统一处理）
function openImageCrop(image) {
  cropSrc.value = image.image_url_full
  cropImageId.value = image.is_new ? null : image.id
  cropNewUid.value = image.is_new ? image._uid : null
  cropVisible.value = true
}
// 裁剪完成回调
function onCropped(result) {
  if (result.imageId) {
    // 已有图片裁剪替换，刷新图片列表
    images.value = result.data.images
  } else if (result.blob && cropNewUid.value != null) {
    // 新图片裁剪，替换 images 中对应的虚拟图片
    const idx = images.value.findIndex(img => img._uid === cropNewUid.value)
    if (idx !== -1) {
      const oldImg = images.value[idx]
      const newFile = new File([result.blob], 'cropped.jpg', { type: 'image/jpeg' })
      images.value[idx] = {
        ...oldImg,
        _file: newFile,
        image_url_full: result.url,
      }
    }
  }
  cropImageId.value = null; cropNewUid.value = null
}
watch(() => route.query.category_id, value => { query.category_id = value ? Number(value) : ''; query.page = 1; load() })
onMounted(async () => { try { await loadCategories(); await load() } catch (error) { ElMessage.error(error.response?.data?.message || '初始化失败') } })
</script>

<template>
  <el-card shadow="never" class="admin-page-card">
    <div class="toolbar"><div class="toolbar-search"><el-input v-model="query.keyword" clearable placeholder="商品名称、生产厂家或品牌" @keyup.enter="search" @clear="search" /><el-select v-model="query.category_id" clearable placeholder="全部分类" @change="search"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select><el-button type="primary" @click="search">搜索</el-button><el-button v-if="query.category_id" @click="clearFilter">清空分类</el-button></div><div class="toolbar-actions"><el-button type="danger" :disabled="!selected.length" @click="batchRemove">批量删除</el-button><el-dropdown @command="exportProducts"><el-button>导出<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="filter">导出全部数据</el-dropdown-item><el-dropdown-item command="selected" :disabled="!selected.length">导出勾选项</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button type="success" @click="importDialogVisible = true">批量导入</el-button><el-button type="primary" @click="openCreate">新增商品</el-button></div></div>
    <el-table v-loading="loading" :data="products" @selection-change="handleSelection" style="width:100%"><el-table-column type="selection" width="48" /><el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column><el-table-column label="商品" min-width="250"><template #default="{ row }"><div class="product-cell"><el-image :src="row.main_image_url || '/assets/images/products/product-placeholder.svg'" fit="cover" /><div><div>{{ row.name }}</div><small>{{ row.brand || '未设置品牌' }} · {{ row.manufacturer || '未设置厂家' }}</small></div></div></template></el-table-column><el-table-column prop="category_name" label="分类" min-width="110" /><el-table-column label="售价" width="100"><template #default="{ row }">¥{{ row.price.toFixed(2) }}</template></el-table-column><el-table-column prop="stock" label="库存" width="90" /><el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '上架' : '下架' }}</el-tag></template></el-table-column><el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link @click="openProduct(row)">跳转</el-button><el-button link type="danger" @click="removeProduct(row)">删除</el-button></template></el-table-column></el-table>
    <div class="pagination"><el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" /></div>
  </el-card>
  <el-dialog v-model="dialogVisible" :title="editing ? '编辑商品' : '新增商品'" width="min(920px, calc(100% - 24px))" top="4vh" destroy-on-close @closed="resetForm"><el-form ref="formRef" :model="form" :rules="rules" label-width="86px"><el-row :gutter="16"><el-col :xs="24" :sm="12"><el-form-item label="商品名称" prop="name"><el-input v-model="form.name" /></el-form-item></el-col><el-col :xs="24" :sm="12"><el-form-item label="商品分类" prop="category_id"><el-select v-model="form.category_id" style="width:100%"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="售价" prop="price"><el-input-number v-model="form.price" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="原价"><el-input-number v-model="form.original_price" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="库存"><el-input-number v-model="form.stock" :min="0" style="width:100%" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="单位"><el-input v-model="form.unit" placeholder="如：件、盒" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="生产厂家"><el-input v-model="form.manufacturer" /></el-form-item></el-col><el-col :xs="24" :sm="8"><el-form-item label="品牌"><el-input v-model="form.brand" /></el-form-item></el-col></el-row><el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="上架" inactive-text="下架" /></el-form-item><el-form-item label="简要描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item><el-form-item label="商品详情"><el-input v-model="form.detail" type="textarea" :rows="4" placeholder="可填写富文本 HTML" /></el-form-item><el-form-item label="图片"><div class="image-manager"><div class="image-tier"><div class="image-tier-label">主图</div><div v-if="mainImage" class="image-card main-image-card" @click="openImageCrop(mainImage)"><el-image :src="mainImage.image_url_full" fit="cover" /><el-tag size="small" type="success">主图</el-tag><div class="image-card-actions" @click.stop><el-button link type="primary" @click="openImageCrop(mainImage)">裁剪</el-button><el-button link type="danger" @click="removeImage(mainImage)">删除</el-button></div></div><div v-else class="no-main-placeholder">暂无主图，上传后第一张自动设为主图</div></div><div class="image-tier"><div class="image-tier-label">子图 <span v-if="subImages.length" class="image-tier-count">({{ subImages.length }})</span></div><draggable v-if="subImages.length" :list="subImages" :item-key="item => item.is_new ? item._uid : item.id" class="existing-images" ghost-class="dragging" @end="onSubImageReorder"><template #item="{ element }"><div class="image-card sub-image-card" @click="openImageCrop(element)"><el-image :src="element.image_url_full" fit="cover" /><div class="image-card-actions" @click.stop><el-button link type="primary" @click="setMain(element)">设为主图</el-button><el-button link type="primary" @click="openImageCrop(element)">裁剪</el-button><el-button link type="danger" @click="removeImage(element)">删除</el-button></div></div></template></draggable><div v-else class="no-sub-placeholder">暂无子图</div></div><div class="image-tier"><div class="image-tier-label">上传新图</div><div class="upload-row"><el-upload :show-file-list="false" :auto-upload="false" multiple accept=".jpg,.jpeg,.png,.bmp,.webp" :on-change="onFileChange" :limit="10"><div class="upload-trigger"><el-icon><Plus /></el-icon></div></el-upload><span class="upload-tip">JPG、PNG、BMP、WebP，单张不超过 5MB</span></div></div></div></el-form-item></el-form><template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存商品</el-button></template>  </el-dialog>
<ImportDialog v-model:visible="importDialogVisible" @success="load" />
<ImageCropDialog v-model:visible="cropVisible" :src="cropSrc" :image-id="cropImageId" :product-id="form.id" @cropped="onCropped" />
</template>

<style scoped>
.toolbar,.toolbar-search,.toolbar-actions,.product-cell,.existing-images { display:flex; align-items:center; gap:10px }.toolbar { justify-content:space-between; margin-bottom:16px }.toolbar-search { flex-wrap:wrap }.toolbar-search .el-input { width:260px }.toolbar-search .el-select { width:160px }.toolbar-actions { flex-wrap:wrap; justify-content:flex-end }.product-cell { gap:10px }.product-cell .el-image { width:48px; height:48px; border-radius:4px; flex:none }.product-cell small { color:#909399 }.pagination { display:flex; justify-content:flex-end; margin-top:18px }
.image-manager { width:100% }
.image-tier { margin-bottom:16px }
.image-tier-label { font-size:13px; color:#909399; margin-bottom:8px; font-weight:500 }
.image-tier-count { color:#c0c4cc }
.existing-images { flex-wrap:wrap; min-height:0; gap:10px }
.main-image-card { width:200px; border:2px solid #67c23a }
.sub-image-card { width:148px }
.image-card { position:relative; border:1px solid #dcdfe6; border-radius:6px; padding:4px; cursor:pointer; display:inline-block }
.main-image-card .el-image { width:190px; height:190px }
.sub-image-card .el-image { width:138px; height:138px }
.image-card .el-tag { position:absolute; top:8px; left:8px; z-index:1 }
.image-card-actions { display:flex; justify-content:center; gap:2px; padding-top:4px; flex-wrap:wrap }
.no-main-placeholder, .no-sub-placeholder { font-size:13px; color:#c0c4cc; padding:24px; border:1px dashed #dcdfe6; border-radius:6px; text-align:center }
.dragging { opacity:.4 }
.upload-row { display:flex; align-items:center; gap:12px }
.upload-trigger { width:80px; height:80px; border:1px dashed #dcdfe6; border-radius:6px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#909399; font-size:24px; transition:border-color .2s,color .2s }
.upload-trigger:hover { border-color:#409eff; color:#409eff }
.upload-tip { font-size:13px; color:#909399 }
@media (max-width: 768px) { .toolbar { align-items:stretch; flex-direction:column }.toolbar-actions { justify-content:flex-start }.toolbar-search .el-input,.toolbar-search .el-select { width:100% }.pagination { justify-content:center } }
</style>
