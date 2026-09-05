<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productTitle } from '../../data/translations'
import { fetchSettings, saveIntentOrder } from '../../services/publicApi'
import AppImage from '../common/AppImage.vue'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible'])

const cart = useCartStore()
const language = useLanguageStore()

const dialogVisible = ref(props.visible)
const settings = ref({})
const settingsError = ref(false)
const downloaded = ref(false)
const downloading = ref(false)

watch(() => props.visible, val => {
  dialogVisible.value = val
  if (val) {
    downloaded.value = false
    loadSettings()
  }
})
watch(dialogVisible, val => emit('update:visible', val))

// 表格行数据：基于购物车状态直接渲染
const tableRows = computed(() =>
  cart.items.map(item => ({
    product: item.product,
    image: item.product.image,
    name: productTitle(item.product, language.locale),
    quantity: item.quantity,
    price: item.product.price,
    subtotal: item.product.price * item.quantity,
  }))
)

// 合计金额
const totalAmount = computed(() =>
  tableRows.value.reduce((sum, row) => sum + row.subtotal, 0)
)

// 加载联系方式
async function loadSettings() {
  settingsError.value = false
  try {
    settings.value = await fetchSettings()
  } catch (error) {
    console.error('Failed to load settings:', error)
    settingsError.value = true
  }
}

// 下载 Excel 并异步保存意向订单
async function handleDownload() {
  if (downloading.value) return
  downloading.value = true

  try {
    // 1. 前端生成 Excel 文件（不含图片，仅商品数据）
    const rows = tableRows.value.map(row => ({
      '商品名称': row.name,
      '数量': row.quantity,
      '单价': row.price.toFixed(2),
      '小计': row.subtotal.toFixed(2),
    }))
    // 追加合计行
    rows.push({ '商品名称': '合计', '数量': '', '单价': '', '小计': totalAmount.value.toFixed(2) })

    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false })
    ws['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '购物清单')

    const date = new Date()
    const stamp =
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}` +
      `${String(date.getDate()).padStart(2, '0')}` +
      `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
    XLSX.writeFile(wb, `购物清单_${stamp}.xlsx`)

    downloaded.value = true
    ElMessage.success('购物清单已下载')

    // 2. 异步保存意向订单（失败静默处理，不阻塞下载流程）
    const payload = {
      items: tableRows.value.map(row => ({
        product_id: row.product.id,
        name: row.name,
        price: row.price,
        quantity: row.quantity,
        subtotal: row.subtotal,
      })),
      totalAmount: totalAmount.value,
    }
    saveIntentOrder(payload).catch(err => {
      console.error('Failed to save intent order:', err)
    })
  } catch (error) {
    ElMessage.error('下载失败，请重试')
    console.error('Download error:', error)
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="购物清单"
    width="min(860px, calc(100% - 24px))"
    top="4vh"
    destroy-on-close
  >
    <el-alert
      v-if="downloaded"
      type="success"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      购物清单已下载，请将该文件发送给以下联系人完成购买。
    </el-alert>

    <el-table :data="tableRows" border style="width: 100%" :max-height="360">
      <el-table-column label="商品图片" width="100">
        <template #default="{ row }">
          <AppImage
            :src="row.image"
            :alt="row.name"
            style="width: 64px; height: 64px; object-fit: cover; border-radius: 2px"
          />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="商品名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="quantity" label="数量" width="80" align="center" />
      <el-table-column label="单价" width="110" align="right">
        <template #default="{ row }">¥{{ row.price.toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="小计" width="120" align="right">
        <template #default="{ row }">¥{{ row.subtotal.toFixed(2) }}</template>
      </el-table-column>
    </el-table>

    <div class="checkout-total">
      <span>合计</span>
      <strong>¥{{ totalAmount.toFixed(2) }}</strong>
    </div>

    <div class="checkout-contact">
      <div v-if="settingsError" class="contact-error">
        联系方式获取失败，请稍后重试。
      </div>
      <template v-else>
        <p class="contact-title">如有疑问，请联系我们：</p>
        <p class="contact-info">
          <span v-if="settings.contact_phone" class="contact-item">
            电话：<a :href="`tel:${settings.contact_phone}`">{{ settings.contact_phone }}</a>
          </span>
          <span v-if="settings.contact_email" class="contact-item">
            邮箱：<a :href="`mailto:${settings.contact_email}`">{{ settings.contact_email }}</a>
          </span>
        </p>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Download" :loading="downloading" @click="handleDownload">
          下载表格
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.checkout-total {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
  font-size: 1rem;
}
.checkout-total strong {
  font-size: 1.35rem;
  color: var(--clay, #c75f3e);
}
.checkout-contact {
  margin-top: 8px;
  padding: 16px;
  background: #f5f0e9;
  border-radius: 4px;
}
.contact-title {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: #5e5750;
}
.contact-info {
  margin: 0;
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}
.contact-item {
  font-size: 0.88rem;
  color: #4e4944;
}
.contact-item a {
  font-weight: 600;
  color: var(--clay, #c75f3e);
  text-decoration: none;
}
.contact-error {
  font-size: 0.85rem;
  color: #909399;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
