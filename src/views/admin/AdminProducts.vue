<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useAdminStore } from '../../stores/admin'
import { categories } from '../../data/categories'
import { useExcel } from '../../composables/useExcel'
import {
  Search, Plus, Download, Upload, View, Edit, Delete,
  Picture, MagicStick
} from '@element-plus/icons-vue'

const admin = useAdminStore()
const router = useRouter()
const { exportProducts, downloadTemplate, parseProductFile } = useExcel()

// --- 搜索与筛选 ---
const searchText = ref('')
const filterCategory = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const importMode = ref('add')
const importLoading = ref(false)

const categoryList = computed(() => categories)

// 前端筛选
const filteredData = computed(() => {
  let list = [...admin.products]
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    list = list.filter(p =>
      p.title.toLowerCase().includes(kw) ||
      p.seller.toLowerCase().includes(kw) ||
      String(p.id).includes(kw)
    )
  }
  if (filterCategory.value) {
    list = list.filter(p => p.category === filterCategory.value)
  }
  return list
})

// 分页数据
const pagedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredData.value.slice(start, start + pageSize.value)
})

// 搜索时重置页码
function onSearchChange() {
  currentPage.value = 1
}

// --- el-table 排序 ---
const tableSort = ref({ prop: 'id', order: 'ascending' })

function handleSortChange({ prop, order }) {
  tableSort.value = { prop, order }
}

const sortedPagedData = computed(() => {
  const list = [...pagedData.value]
  const { prop, order } = tableSort.value
  if (!prop || !order) return list
  const dir = order === 'ascending' ? 1 : -1
  list.sort((a, b) => {
    const va = a[prop]
    const vb = b[prop]
    if (typeof va === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb)) * dir
  })
  return list
})

// --- 表单弹窗 ---
const dialogVisible = ref(false)
const formRef = ref(null)
const submitting = ref(false)

const defaultForm = () => ({
  id: null,
  title: '',
  category: 'gifts',
  price: 0,
  originalPrice: 0,
  rating: 5.0,
  reviewCount: 0,
  seller: '',
  badge: '',
  description: '',
  stock: 0,
  sales: 0,
  image: '',
  images: '',
  isPublished: true,
  createdAt: Date.now()
})

const formData = ref(defaultForm())

const formRules = {
  title: [
    { required: true, message: '请输入商品名称', trigger: 'blur' },
    { min: 2, max: 50, message: '名称长度 2-50 个字符', trigger: 'blur' }
  ],
  seller: [
    { required: true, message: '请输入卖家名称', trigger: 'blur' }
  ],
  category: [
    { required: true, message: '请选择分类', trigger: 'change' }
  ],
  price: [
    { required: true, message: '请输入价格', trigger: 'blur' },
    { type: 'number', min: 0, message: '价格不能为负', trigger: 'blur' }
  ],
  originalPrice: [
    { type: 'number', min: 0, message: '原价不能为负', trigger: 'blur' }
  ],
  stock: [
    { type: 'number', min: 0, message: '库存不能为负', trigger: 'blur' }
  ],
  rating: [
    { type: 'number', min: 0, max: 5, message: '评分 0-5', trigger: 'blur' }
  ]
}

const dialogTitle = computed(() => formData.value.id ? '编辑商品' : '新增商品')

function openCreate() {
  formData.value = defaultForm()
  dialogVisible.value = true
}

function openEdit(row) {
  formData.value = {
    ...row,
    images: Array.isArray(row.images) ? row.images.join(',') : (row.images || ''),
    isPublished: true
  }
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
  formRef.value?.resetFields()
}

// 自动生成图片路径
function autoFillImagePaths() {
  const p = formData.value
  const tempId = p.id || Math.max(0, ...admin.products.map(x => x.id)) + 1
  const dir = `/assets/products/${tempId}/`
  const paths = []
  for (let i = 1; i <= 3; i++) paths.push(`${dir}${i}.jpg`)
  p.image = paths[0]
  p.images = paths.join(',')
  ElMessage.success('图片路径已自动生成')
}

// 保存
async function handleSave() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) {
      ElMessage.warning('请完成表单验证')
      return
    }
    submitting.value = true
    setTimeout(() => {
      const data = { ...formData.value }
      if (data.id) {
        admin.updateProduct(data.id, { ...data })
        ElNotification.success({ title: '成功', message: `商品「${data.title}」已更新` })
      } else {
        const created = admin.addProduct({ ...data })
        ElNotification.success({ title: '成功', message: `商品「${created.title}」已添加` })
      }
      submitting.value = false
      closeDialog()
    }, 500)
  })
}

// 删除
function handleDelete(row) {
  ElMessageBox.confirm(
    `确认删除商品「${row.title}」吗？此操作不可撤销。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }
  ).then(() => {
    admin.deleteProduct(row.id)
    ElMessage.success('删除成功')
  }).catch(() => {})
}

// 查看详情
function viewDetail(row) {
  router.push(`/product/${row.id}`)
}

// 导出
function handleExport() {
  exportProducts(admin.products)
  ElNotification.success({ title: '导出成功', message: `已导出 ${admin.products.length} 条商品数据` })
}

// 下载模板
function handleTemplate() {
  downloadTemplate()
  ElMessage.success('模板已下载')
}

// 导入
async function handleImport(file) {
  if (!file) return
  importLoading.value = true
  try {
    const parsed = await parseProductFile(file)
    let count
    if (importMode.value === 'replace') {
      count = admin.batchReplace(parsed)
      ElNotification.success({ title: '导入成功', message: `已替换全部数据，共 ${count} 条商品` })
    } else {
      count = admin.batchAdd(parsed)
      ElNotification.success({ title: '导入成功', message: `已追加 ${count} 条商品` })
    }
  } catch (err) {
    ElNotification.error({ title: '导入失败', message: err.message })
  }
  importLoading.value = false
  return false // 阻止 el-upload 默认上传
}

// 格式化分类标签
function categoryTagType(cat) {
  const types = { ceramics: '', jewelry: 'success', home: 'warning', woodwork: 'info', textile: 'danger', clothing: '', art: 'success', gifts: 'warning', wedding: 'info' }
  return types[cat] || ''
}

// 格式化价格
function formatPrice(row, col, val) {
  return '¥' + Number(val).toFixed(2)
}
</script>

<template>
  <div>
    <!-- 工具栏 -->
    <div class="admin-toolbar">
      <div class="admin-toolbar-left">
        <el-input
          v-model="searchText"
          placeholder="搜索商品名称 / 卖家 / ID"
          clearable
          :prefix-icon="Search"
          style="max-width: 280px;"
          @input="onSearchChange"
        />
        <el-select
          v-model="filterCategory"
          placeholder="全部分类"
          clearable
          style="width: 150px;"
          @change="onSearchChange"
        >
          <el-option
            v-for="c in categoryList"
            :key="c.id"
            :label="c.icon + ' ' + c.id"
            :value="c.id"
          />
        </el-select>
      </div>
      <div class="admin-toolbar-right">
        <el-button :icon="Download" @click="handleTemplate">下载模板</el-button>
        <el-upload
          :show-file-list="false"
          :before-upload="handleImport"
          accept=".xlsx,.xls,.csv"
        >
          <el-button :icon="Upload" :loading="importLoading">导入表格</el-button>
        </el-upload>
        <el-button type="success" :icon="Download" @click="handleExport">导出表格</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增商品</el-button>
      </div>
    </div>

    <!-- 导入模式 -->
    <el-radio-group v-model="importMode" style="margin-bottom: 16px;" @change="onSearchChange">
      <el-radio value="add">追加导入</el-radio>
      <el-radio value="replace">替换全部</el-radio>
    </el-radio-group>

    <!-- 数据表格 -->
    <el-table
      :data="sortedPagedData"
      border
      stripe
      style="width: 100%;"
      @sort-change="handleSortChange"
    >
      <el-table-column prop="id" label="ID" width="70" sortable align="center" />
      <el-table-column label="图片" width="80" align="center">
        <template #default="{ row }">
          <el-image
            :src="row.image"
            :preview-src-list="[row.image]"
            fit="cover"
            class="product-row-thumb"
          />
        </template>
      </el-table-column>
      <el-table-column prop="title" label="商品名称" min-width="160" show-overflow-tooltip sortable />
      <el-table-column prop="category" label="分类" width="100" sortable align="center">
        <template #default="{ row }">
          <el-tag :type="categoryTagType(row.category)" size="small">{{ row.category }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="price" label="现价" width="90" sortable align="right" :formatter="formatPrice" />
      <el-table-column prop="originalPrice" label="原价" width="90" sortable align="right" :formatter="formatPrice" />
      <el-table-column prop="stock" label="库存" width="80" sortable align="center">
        <template #default="{ row }">
          <el-text :type="row.stock < 10 ? 'danger' : 'default'">{{ row.stock }}</el-text>
        </template>
      </el-table-column>
      <el-table-column prop="sales" label="销量" width="80" sortable align="center" />
      <el-table-column prop="seller" label="卖家" width="120" show-overflow-tooltip />
      <el-table-column prop="rating" label="评分" width="80" sortable align="center">
        <template #default="{ row }">
          <el-rate v-model="row.rating" disabled size="small" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right" align="center">
        <template #default="{ row }">
          <el-button size="small" :icon="View" @click="viewDetail(row)" />
          <el-button size="small" type="primary" :icon="Edit" @click="openEdit(row)" />
          <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)" />
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="没有匹配的商品" />
      </template>
    </el-table>

    <!-- 分页 -->
    <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredData.length"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        background
      />
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="680px"
      :close-on-click-modal="false"
      @close="closeDialog"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="100px"
        label-position="right"
      >
        <el-row :gutter="20">
          <el-col :span="24">
            <el-form-item label="商品名称" prop="title">
              <el-input v-model="formData.title" placeholder="请输入商品名称" maxlength="50" show-word-limit />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类" prop="category">
              <el-select v-model="formData.category" placeholder="请选择分类" style="width: 100%;">
                <el-option v-for="c in categories" :key="c.id" :label="c.icon + ' ' + c.id" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="卖家" prop="seller">
              <el-input v-model="formData.seller" placeholder="请输入卖家名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="现价" prop="price">
              <el-input-number v-model="formData.price" :min="0" :precision="2" controls-position="right" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="原价" prop="originalPrice">
              <el-input-number v-model="formData.originalPrice" :min="0" :precision="2" controls-position="right" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库存" prop="stock">
              <el-input-number v-model="formData.stock" :min="0" controls-position="right" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="销量" prop="sales">
              <el-input-number v-model="formData.sales" :min="0" controls-position="right" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="评分" prop="rating">
              <el-rate v-model="formData.rating" :max="5" allow-half />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="评论数" prop="reviewCount">
              <el-input-number v-model="formData.reviewCount" :min="0" controls-position="right" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="标签">
              <el-select v-model="formData.badge" placeholder="选择标签" clearable style="width: 100%;">
                <el-option label="新品" value="新品" />
                <el-option label="热卖" value="热卖" />
                <el-option label="限量" value="限量" />
                <el-option label="特惠" value="特惠" />
                <el-option label="原创" value="原创" />
                <el-option label="预订" value="预订" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="上架状态">
              <el-switch v-model="formData.isPublished" active-text="上架" inactive-text="下架" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="商品描述">
              <el-input
                v-model="formData.description"
                type="textarea"
                :rows="3"
                placeholder="请输入商品描述"
                maxlength="200"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="主图路径">
              <el-input v-model="formData.image" placeholder="/assets/products/ID/1.jpg">
                <template #prefix><el-icon><Picture /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="图片路径">
              <el-input
                v-model="formData.images"
                type="textarea"
                :rows="2"
                placeholder="/assets/products/ID/1.jpg,/assets/products/ID/2.jpg"
              />
              <el-button type="primary" :icon="MagicStick" link @click="autoFillImagePaths">
                自动生成图片路径
              </el-button>
              <div class="form-tip-text">
                图片文件存放在 <code>public/assets/products/{商品ID}/</code> 目录下，每个商品1-6张图，文件名 1.jpg ~ 6.jpg
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template #footer>
        <el-button @click="closeDialog">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
