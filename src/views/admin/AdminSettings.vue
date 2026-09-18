<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../services/api'
import { IMG_FALLBACK, resolve } from '../../utils/image'
import { COL } from '../../constants/tableColumn'

const formRef = ref(null); const loading = ref(false); const saving = ref(false)
const form = reactive({ contact_email: '', contact_email2: '', contact_phone: '', contact_phone2: '' })
const labels = { contact_email: '联系邮箱', contact_email2: '联系邮箱2', contact_phone: '联系电话', contact_phone2: '联系电话2' }

const activeTab = ref('general')

// 汇率设置：商品价格以人民币为基准，这里维护「1 人民币可兑换的目标货币数量」
const rates = ref([])
const ratesLoading = ref(false)
const savingLocale = ref(null)
const rateDrafts = reactive({})

// 运费设置：按「语言分组」（区域）维护人民币预估运费，0 表示包邮
const shippingRates = ref([])
const shippingLoading = ref(false)
const savingRegion = ref(null)
const shippingDrafts = reactive({})
const REGION_LABELS = { CN: '中国大陆', TW: '中国台湾', JP: '日本', KR: '韩国', OTHER: '其他海外地区' }

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
    await ElMessageBox.confirm(`确认删除「${row.name}」及其二维码图片吗？删除后需点击右上角「保存设置」生效。`, '删除确认', { type: 'warning' })
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

function isRateDirty(row) {
  return Number(rateDrafts[row.locale]) !== Number(row.rate_from_cny)
}

const hasRateChanges = computed(() => rates.value.some(isRateDirty))

async function loadRates() {
  ratesLoading.value = true
  try {
    const { data } = await api.get('/admin/exchange-rates')
    rates.value = data.data
    for (const item of data.data) rateDrafts[item.locale] = String(item.rate_from_cny)
  } catch (error) { ElMessage.error(error.response?.data?.message || '汇率加载失败') } finally { ratesLoading.value = false }
}

// 批量保存全部有改动的汇率（逐行调用单条接口）
async function saveAllRates() {
  const dirty = rates.value.filter(isRateDirty)
  if (!dirty.length) return
  for (const row of dirty) {
    const value = Number(rateDrafts[row.locale])
    if (!Number.isFinite(value) || value <= 0) { ElMessage.error(`「${row.locale}」的汇率必须是大于 0 的数字`); return }
  }
  savingLocale.value = 'all'
  try {
    for (const row of dirty) {
      const { data } = await api.put(`/admin/exchange-rates/${row.locale}`, { rate_from_cny: Number(rateDrafts[row.locale]) })
      const index = rates.value.findIndex(item => item.locale === row.locale)
      if (index !== -1) rates.value[index] = data.data
      rateDrafts[row.locale] = String(data.data.rate_from_cny)
    }
    ElMessage.success('汇率已保存')
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } finally { savingLocale.value = null }
}

function isShippingDirty(row) {
  return Number(shippingDrafts[row.region_key]) !== Number(row.fee_cny)
}

const hasShippingChanges = computed(() => shippingRates.value.some(isShippingDirty))

async function loadShippingRates() {
  shippingLoading.value = true
  try {
    const { data } = await api.get('/admin/shipping-rates')
    shippingRates.value = data.data
    for (const item of data.data) shippingDrafts[item.region_key] = String(item.fee_cny)
  } catch (error) { ElMessage.error(error.response?.data?.message || '运费加载失败') } finally { shippingLoading.value = false }
}

// 批量保存全部有改动的运费（接口本身支持数组）
async function saveAllShippingRates() {
  const dirty = shippingRates.value.filter(isShippingDirty)
  if (!dirty.length) return
  for (const row of dirty) {
    const value = Number(shippingDrafts[row.region_key])
    if (!Number.isFinite(value) || value < 0) { ElMessage.error('运费必须是大于或等于 0 的数字'); return }
  }
  savingRegion.value = 'all'
  try {
    const { data } = await api.put('/admin/shipping-rates', { rates: dirty.map(r => ({ region_key: r.region_key, fee_cny: Number(shippingDrafts[r.region_key]) })) })
    shippingRates.value = data.data
    for (const item of data.data) shippingDrafts[item.region_key] = String(item.fee_cny)
    ElMessage.success('运费已保存')
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') } finally { savingRegion.value = null }
}

// ── 右上角统一的「保存设置」按钮：按当前标签页分发保存 ──
const tabSaving = computed(() => saving.value || savingSocial.value || savingLocale.value !== null || savingRegion.value !== null)
const tabDisabled = computed(() => {
  if (tabSaving.value) return true
  if (activeTab.value === 'socials') return !hasChanges.value
  if (activeTab.value === 'rates') return !hasRateChanges.value
  if (activeTab.value === 'shipping') return !hasShippingChanges.value
  return false
})

function saveCurrentTab() {
  if (activeTab.value === 'socials') return saveSocial()
  if (activeTab.value === 'rates') return saveAllRates()
  if (activeTab.value === 'shipping') return saveAllShippingRates()
  return save()
}

onMounted(() => { load(); loadSocials(); loadRates(); loadShippingRates() })
onBeforeUnmount(() => { socials.value.forEach(clearDraft) })
</script>

<template>
  <el-card shadow="never" class="admin-page-card" v-loading="loading">
    <template #header>
      <div class="page-header">
        <span>其他设置</span>
        <el-button type="primary" :loading="tabSaving" :disabled="tabDisabled" @click="saveCurrentTab">保存设置</el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="联系方式" name="general">
    <el-form ref="formRef" :model="form" label-width="120px" style="max-width: 600px">
      <el-form-item v-for="(label, key) in labels" :key="key" :label="label">
        <el-input v-model="form[key]" :placeholder="`请输入${label}`" maxlength="500" show-word-limit />
      </el-form-item>
    </el-form>
      </el-tab-pane>

      <el-tab-pane label="社交媒体" name="socials">
    <el-table :data="socials" v-loading="socialLoading" style="width: 100%" empty-text="尚未添加社交媒体，请点击下方按钮新增">
      <el-table-column label="平台名称" min-width="260">
        <template #default="{ row }">
          <el-input v-model="row.name" maxlength="30" :disabled="row.removed" placeholder="平台名称" style="max-width: 240px" />
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.removed" type="danger" size="small" effect="light">将删除</el-tag>
          <el-tag v-else-if="isRowDirty(row)" type="warning" size="small" effect="light">未保存</el-tag>
          <el-tag v-else type="info" size="small" effect="light">已保存</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="二维码" width="120" align="center">
        <template #default="{ row }">
          <el-image :src="resolve(displayImage(row))" fit="cover" class="qr-image"><template #error><img class="image-fallback" :src="IMG_FALLBACK" alt="" /></template></el-image>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <div class="social-actions">
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
        </template>
      </el-table-column>
    </el-table>

    <div class="social-bar">
      <span class="social-bar-hint" :class="{ 'is-active': hasChanges }">
        {{ hasChanges ? `有 ${pendingCount} 项修改待保存` : '暂无未保存的修改' }}
      </span>
      <div class="social-bar-btns">
        <el-button type="primary" plain @click="addSocial">＋ 新增社交媒体</el-button>
      </div>
    </div>
      </el-tab-pane>

      <el-tab-pane label="汇率设置" name="rates">

        <el-table :data="rates" v-loading="ratesLoading" style="width: 100%">
          <el-table-column prop="locale" label="语言" width="110" />
          <el-table-column prop="currency_code" label="币种" width="90" />
          <el-table-column prop="currency_symbol" label="符号" width="84" />
          <!-- 汇率输入框为主内容列（min-width 吸收多余宽度），其余列固定宽度 -->
          <el-table-column label="汇率（1 人民币 =）" min-width="300">
            <template #default="{ row }">
              <!-- 主内容列会吸收多余宽度，这里限制输入框自身宽度，避免在 2K/4K 屏上被拉成一条超长输入框 -->
              <el-input v-model="rateDrafts[row.locale]" type="number" min="0" step="0.01" style="max-width: 320px">
                <template #append>{{ row.currency_code }}</template>
              </el-input>
            </template>
          </el-table-column>
          <el-table-column prop="updated_at" label="更新时间" :width="COL.DATETIME" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="运费设置" name="shipping">
        <el-table :data="shippingRates" v-loading="shippingLoading" style="width: 100%">
          <el-table-column label="区域" width="150">
            <template #default="{ row }">{{ REGION_LABELS[row.region_key] || row.region_key }}</template>
          </el-table-column>
          <el-table-column prop="locale" label="语言" width="100" />
          <!-- 运费输入框 / 说明为弹性列（min-width），两者按比例分摊剩余宽度，输入框自身限宽防止拉成超长输入框 -->
          <el-table-column label="预估运费（人民币）" min-width="280">
            <template #default="{ row }">
              <el-input v-model="shippingDrafts[row.region_key]" type="number" min="0" step="1" style="max-width: 320px">
                <template #append>¥</template>
              </el-input>
            </template>
          </el-table-column>
          <el-table-column prop="note" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column prop="updated_at" label="更新时间" :width="COL.DATETIME" />
        </el-table>
        <p class="shipping-tip">提示：未单独列出的国家和地区，统一使用「其他海外地区」这一行估算运费。</p>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 600 }
.social-actions { display: flex; align-items: center; gap: 10px }
.qr-image { width: 64px; height: 64px; border-radius: 6px; overflow: hidden }
.image-fallback { width: 100%; height: 100%; object-fit: cover; display: block }
.social-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px }
.social-bar-hint { font-size: 12px; color: #909399 }
.social-bar-hint.is-active { color: #e6a23c }
.social-bar-btns { display: flex; gap: 10px }
.shipping-tip { margin: 12px 0 0; font-size: 12px; color: #909399 }
</style>
