<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import ImportDialog from '../../components/admin/ImportDialog.vue'
import ImageCropDialog from '../../components/admin/ImageCropDialog.vue'
import { IMG_FALLBACK, resolve } from '../../utils/image'

const route = useRoute(); const loading = ref(false); const products = ref([]); const categories = ref([]); const total = ref(0); const selected = ref([])
const query = reactive({ keyword: '', category_id: route.query.category_id ? Number(route.query.category_id) : '', page: 1, page_size: 20 })
const dialogVisible = ref(false); const saving = ref(false); const formRef = ref(); const form = reactive(defaultForm()); const images = ref([]); const editing = computed(() => Boolean(form.id)); const importDialogVisible = ref(false)
const rules = { name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }], category_id: [{ required: true, message: '请选择分类', trigger: 'change' }], price: [{ required: true, message: '请输入售价', trigger: 'blur' }] }
// 裁剪对话框状态
const cropVisible = ref(false); const cropSrc = ref(''); const cropImageId = ref(null); const cropNewUid = ref(null)
// 新文件计数器，用于生成临时 ID
let newFileSeq = 0
function defaultForm() { return { id: null, name: '', category_id: '', price: 0, original_price: null, stock: 0, sales: 0, unit: '', manufacturer: '', brand: '', sku: '', is_customizable: '0', rating: 5, description: '', detail: '', status: 1 } }
// 富文本 HTML → 纯文本：商品详情按纯文本编辑展示，避免文本框里出现 <p> 等标签对
function htmlToPlainText(html) {
  if (!html) return ''
  const text = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  const decoder = document.createElement('textarea')
  decoder.innerHTML = text
  return decoder.value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
const activeCategories = computed(() => categories.value.filter(item => item.status))
async function loadCategories() { const { data } = await api.get('/categories'); categories.value = data.data }
async function load() { loading.value = true; try { const { data } = await api.get('/products', { params: query }); products.value = data.data; total.value = data.pagination.total; selected.value = [] } catch (error) { ElMessage.error(error.response?.data?.message || '商品加载失败') } finally { loading.value = false } }
function search() { query.page = 1; load() }
function clearFilter() { query.category_id = ''; search() }
function handleSelection(rows) { selected.value = rows }
function pageIndex(index) { return (query.page - 1) * query.page_size + index + 1 }
function resetForm() { Object.assign(form, defaultForm()); images.value = [] }
function openCreate() { resetForm(); dialogVisible.value = true }
async function openEdit(row) { try { const { data } = await api.get(`/products/${row.id}`); const product = data.data; Object.assign(form, product, { sku: product.sku || '', is_customizable: product.is_customizable ? '1' : '0', rating: Number(product.rating) || 5, detail: htmlToPlainText(product.detail || '') }); images.value = data.data.images; dialogVisible.value = true } catch (error) { ElMessage.error(error.response?.data?.message || '商品详情加载失败') } }
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
  const keyOf = img => (img.is_new ? img._uid : img.id)
  const list = [...images.value]
  const targetIdx = list.findIndex(img => keyOf(img) === keyOf(image))
  if (targetIdx === -1) return
  const oldMainIdx = list.findIndex(img => img.is_main)

  let reordered
  if (targetIdx === oldMainIdx) {
    // 目标本身就是主图：只需保证主图排在第一位
    if (targetIdx === 0) return
    const [main] = list.splice(targetIdx, 1)
    reordered = [{ ...main, is_main: 1 }, ...list.map(img => ({ ...img, is_main: 0 }))]
  } else {
    // 目标图设为主图并移到第一位，原主图“交换”到目标图原来的位置，其余图顺序不变
    const [target] = list.splice(targetIdx, 1)
    let oldMain = null
    if (oldMainIdx !== -1) {
      const oIdx = list.findIndex(img => img.is_main)
      ;[oldMain] = list.splice(oIdx, 1)
    }
    reordered = oldMain
      ? [{ ...target, is_main: 1 }, ...list.slice(0, targetIdx - 1), { ...oldMain, is_main: 0 }, ...list.slice(targetIdx - 1)]
      : [{ ...target, is_main: 1 }, ...list]
  }
  images.value = reordered

  // 已保存图片需要同步服务端的主图标记；新图片的主图与顺序在“保存商品”时再整体提交
  if (!image.is_new) {
    try { await api.put(`/products/images/${image.id}/set-main`) } catch (error) { ElMessage.error(error.response?.data?.message || '设置失败'); return }
  }
  ElMessage.success('已设为主图')
}
// 统一图片网格拖拽结束后执行：主图锁定在第一位（改动最小，且避免未保存新图与服务端主图逻辑冲突）
function onImagesReorder() {
  const list = [...images.value]
  const mainIndex = list.findIndex(img => img.is_main)
  if (mainIndex > 0) {
    const main = list.splice(mainIndex, 1)[0]
    images.value = [main, ...list]
  }
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
    <el-table v-loading="loading" :data="products" @selection-change="handleSelection" style="width:100%"><el-table-column type="selection" width="48" /><el-table-column label="序号" width="70"><template #default="{ $index }">{{ pageIndex($index) }}</template></el-table-column><el-table-column label="商品" min-width="250"><template #default="{ row }"><div class="product-cell"><el-image :src="resolve(row.main_image_url)" fit="cover"><template #error><img class="image-fallback" :src="IMG_FALLBACK" alt="" /></template></el-image><div><div>{{ row.name }}</div><small>{{ row.brand || '未设置品牌' }} · {{ row.manufacturer || '未设置厂家' }}</small><small style="display:block;margin-top:2px">SKU: {{ row.sku || '未设置' }}</small></div></div></template></el-table-column><el-table-column prop="category_name" label="分类" min-width="110" /><el-table-column label="售价" width="100"><template #default="{ row }">¥{{ row.price.toFixed(2) }}</template></el-table-column><el-table-column prop="stock" label="库存" width="90" /><el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '上架' : '下架' }}</el-tag></template></el-table-column><el-table-column label="评分" width="90" align="center"><template #default="{ row }">★ {{ row.rating ?? 5 }}</template></el-table-column><el-table-column label="定制" width="80" align="center"><template #default="{ row }"><el-tag :type="row.is_customizable ? 'warning' : 'info'" size="small">{{ row.is_customizable ? '支持' : '不支持' }}</el-tag></template></el-table-column><el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link @click="openProduct(row)">跳转</el-button><el-button link type="danger" @click="removeProduct(row)">删除</el-button></template></el-table-column></el-table>
    <div class="pagination"><el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="query.page = 1; load()" /></div>
  </el-card>
  <el-dialog v-model="dialogVisible" class="product-dialog" :title="editing ? '编辑商品' : '新增商品'" width="min(960px, calc(100% - 24px))" top="4vh" destroy-on-close @closed="resetForm">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <!-- 基础信息 -->
      <div class="form-section">
        <div class="form-section__title">基础信息</div>
        <el-row :gutter="24">
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="商品名称" prop="name"><el-input v-model="form.name" placeholder="请输入商品名称" /></el-form-item>
          </el-col>
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="商品编号（SKU）"><el-input v-model="form.sku" placeholder="留空自动生成" clearable /></el-form-item>
          </el-col>
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="商品分类" prop="category_id"><el-select v-model="form.category_id" placeholder="请选择分类" style="width:100%"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          </el-col>
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="品牌"><el-input v-model="form.brand" placeholder="如：XX 手作坊" /></el-form-item>
          </el-col>
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="生产厂家"><el-input v-model="form.manufacturer" placeholder="如：XX 工艺工作室" /></el-form-item>
          </el-col>
          <el-col :xs="24" :md="12" :lg="8">
            <el-form-item label="单位"><el-input v-model="form.unit" placeholder="如：件、盒" /></el-form-item>
          </el-col>
        </el-row>
      </div>

      <!-- 价格与库存 -->
      <div class="form-section">
        <div class="form-section__title">价格与库存</div>
        <el-row :gutter="24">
          <el-col :xs="24" :sm="12" :lg="6">
            <el-form-item label="售价" prop="price"><el-input-number v-model="form.price" :min="0" :precision="2" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :lg="6">
            <el-form-item label="原价"><el-input-number v-model="form.original_price" :min="0" :precision="2" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :lg="6">
            <el-form-item label="库存"><el-input-number v-model="form.stock" :min="0" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :lg="6">
            <el-form-item label="商品评分"><el-input-number v-model="form.rating" :min="0" :max="5" :step="0.5" :precision="1" style="width:100%" /></el-form-item>
          </el-col>
        </el-row>
      </div>

      <!-- 商品状态 -->
      <div class="form-section">
        <div class="form-section__title">商品状态</div>
        <div class="status-card-box">
          <div class="switch-card">
            <span class="switch-card__label">商品状态</span>
            <el-switch v-model="form.status" :active-value="1" :inactive-value="0" aria-label="商品状态" />
            <span class="switch-card__state" :class="{ 'is-on-success': form.status }">{{ form.status ? '上架' : '下架' }}</span>
          </div>
          <div class="switch-card">
            <span class="switch-card__label">支持定制</span>
            <el-switch v-model="form.is_customizable" :active-value="'1'" :inactive-value="'0'" aria-label="支持定制" />
            <span class="switch-card__state" :class="{ 'is-on-primary': form.is_customizable === '1' }">{{ form.is_customizable === '1' ? '支持定制' : '不支持定制' }}</span>
          </div>
        </div>
      </div>

      <!-- 商品描述 -->
      <div class="form-section">
        <div class="form-section__title">商品描述</div>
        <el-form-item label="简要描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="商品详情"><el-input v-model="form.detail" type="textarea" :rows="4" placeholder="请输入商品详情（纯文本，会自动去除 HTML 标签）" /></el-form-item>
      </div>

      <!-- 商品图片 -->
      <div class="form-section">
        <div class="form-section__title">商品图片</div>
        <div class="image-grid">
          <draggable v-if="images.length" v-model="images" :item-key="img => (img.is_new ? img._uid : img.id)" class="image-sortable" ghost-class="dragging" @end="onImagesReorder">
            <template #item="{ element }">
              <div class="image-tile">
                <div class="image-tile__thumb" :class="{ 'is-main': element.is_main }" @click="openImageCrop(element)">
                  <el-image :src="resolve(element.image_url_full)" fit="cover">
                    <template #error><img class="image-fallback" :src="IMG_FALLBACK" alt="" /></template>
                  </el-image>
                  <el-tag v-if="element.is_main" type="success" size="small" class="image-tile__badge" effect="dark">主图</el-tag>
                </div>
                <div class="image-tile__bar">
                  <button v-if="!element.is_main" type="button" class="tile-action" @click="setMain(element)">设为主图</button>
                  <button type="button" class="tile-action" @click="openImageCrop(element)">裁剪</button>
                  <button type="button" class="tile-action tile-action--danger" @click="removeImage(element)">删除</button>
                </div>
              </div>
            </template>
          </draggable>
          <div v-if="!images.length" class="image-empty-tile">暂无图片</div>
          <div class="image-upload-tile">
            <el-upload :show-file-list="false" :auto-upload="false" multiple accept=".jpg,.jpeg,.png,.bmp,.webp" :on-change="onFileChange" :limit="10">
              <div class="image-upload-tile__trigger"><el-icon><Plus /></el-icon></div>
            </el-upload>
          </div>
        </div>
        <div class="image-upload-tip">支持 JPG、PNG、BMP、WebP，单张不超过 5MB；可直接拖拽图片调整顺序，第一张固定为主图</div>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存商品</el-button>
    </template>
  </el-dialog>
<ImportDialog v-model:visible="importDialogVisible" @success="load" />
<ImageCropDialog v-model:visible="cropVisible" :src="cropSrc" :image-id="cropImageId" :product-id="form.id" @cropped="onCropped" />
</template>

<style scoped>
.toolbar,.toolbar-search,.toolbar-actions,.product-cell { display:flex; align-items:center; gap:10px }.toolbar { justify-content:space-between; margin-bottom:16px; flex-wrap:wrap }.toolbar-search { flex-wrap:wrap }.toolbar-search .el-input { width:260px }.toolbar-search .el-select { width:160px }.toolbar-actions { flex-wrap:wrap; justify-content:flex-end }.product-cell { gap:10px }.product-cell .el-image { width:48px; height:48px; border-radius:4px; flex:none }.product-cell small { color:#909399 }.image-fallback { width:100%; height:100%; object-fit:cover; display:block }.pagination { display:flex; justify-content:flex-end; margin-top:18px }
/* 分组区块标题：小字号浅灰加粗 + 细分隔线 */
.form-section__title { font-size:13px; font-weight:600; color:#909399; letter-spacing:.3px; margin:0 0 22px; padding-bottom:10px; border-bottom:1px solid #ebeef5 }
.form-section + .form-section { margin-top:28px }
/* 状态开关卡片：浅灰圆角容器内横向排布 */
.status-card-box { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; background:#f8f9fb; border-radius:8px; padding:16px 18px }
/* 卡片内字段名、开关、状态文字紧凑排布，彼此距离均匀且贴近 */
.switch-card { display:flex; align-items:center; justify-content:center; gap:8px; min-width:0 }
.switch-card__label { flex:none; font-size:13px; color:#606266; font-weight:500 }
.switch-card__state { flex:none; width:90px; font-size:13px; color:#909399; font-weight:500; text-align:left; transition:color .2s }
/* 状态文字区固定宽度：开关位置不随“上架/下架、支持定制/不支持定制”字数变化而左右移动 */
.switch-card__state.is-on-success { color:#67c23a }
.switch-card__state.is-on-primary { color:#409eff }
/* 统一图片网格：上方图片方块 + 下方常显操作按钮，整格对应同一张图 */
.image-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:16px; width:100%; align-items:start }
.image-sortable { display:contents }
.image-tile { display:flex; flex-direction:column; gap:6px; min-width:0; width:100% }
.image-tile__thumb { position:relative; width:100%; aspect-ratio:1; border:1px solid #dcdfe6; border-radius:6px; overflow:hidden; background:#f5f7fa; cursor:pointer; transition:border-color .2s }
.image-tile__thumb:hover { border-color:#c0c4cc }
.image-tile__thumb.is-main { border-color:#67c23a }
.image-tile__thumb .el-image { width:100%; height:100%; display:block }
.image-tile__badge { position:absolute; top:6px; left:6px; z-index:2; pointer-events:none }
.image-tile__bar { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:2px 0; min-height:24px }
.tile-action { padding:2px 4px; border:0; border-radius:4px; background:transparent; color:#409eff; font-size:12px; line-height:1.6; cursor:pointer; white-space:nowrap }
.tile-action:hover { color:#66b1ff; background:#ecf5ff }
.tile-action--danger { color:#f56c6c }
.tile-action--danger:hover { color:#f78989; background:#fef0f0 }
.image-empty-tile, .image-upload-tile { align-self:start }
.image-empty-tile { aspect-ratio:1; display:flex; align-items:center; justify-content:center; border:1px dashed #dcdfe6; border-radius:6px; color:#c0c4cc; font-size:12px; background:#fafafa }
.image-upload-tile { aspect-ratio:1; display:flex; align-items:center; justify-content:center; border:1px dashed #dcdfe6; border-radius:6px; color:#909399; font-size:22px; cursor:pointer; transition:border-color .2s,color .2s,background .2s }
.image-upload-tile:hover { border-color:#409eff; color:#409eff; background:#f5f9ff }
.image-upload-tile__trigger { width:100%; height:100%; display:flex; align-items:center; justify-content:center }
.image-upload-tile :deep(.el-upload) { width:100%; height:100%; display:flex; align-items:center; justify-content:center }
.image-upload-tip { margin-top:12px; font-size:12px; color:#909399; line-height:1.6 }
.dragging { opacity:.4 }
@media (max-width:768px) {
  .toolbar { align-items:stretch; flex-direction:column }
  .toolbar-actions { justify-content:flex-start }
  .toolbar-search .el-input,.toolbar-search .el-select { width:100% }
  .pagination { justify-content:center }
  .form-section + .form-section { margin-top:20px }
  .form-section__title { margin-bottom:16px }
  .status-card-box { grid-template-columns:1fr; padding:12px 14px }
  .image-grid { grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:10px }
  .image-upload-tip { margin-top:10px }
}
</style>
<style>
/* el-dialog 内部结构（teleport 到 body）用唯一类前缀的全局样式覆写 */
.product-dialog .el-dialog__body { padding:10px 26px 26px; max-height:calc(100vh - 190px); overflow-y:auto }
.product-dialog .el-form-item { margin-bottom:22px }
.product-dialog .el-form-item__label { line-height:20px; padding-bottom:8px; color:#606266 }
.product-dialog .el-dialog__footer { padding-top:4px }
@media (max-width:768px) {
  .product-dialog .el-dialog__body { padding:6px 16px 18px }
  .product-dialog .el-form-item { margin-bottom:18px }
}
</style>
