<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import { useCartStore } from '../../stores/cart'
import { useLanguageStore } from '../../stores/language'
import { productTitle } from '../../data/translations'
import { fetchSettings, saveIntentOrder, exportCheckoutList } from '../../services/publicApi'
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
    // 1. 调用后端接口，基于 public/assets/结算清单.xlsx 模板生成文件并返回
    const { blob, filename } = await exportCheckoutList(tableRows.value.map(row => ({
      sku: row.product.sku || '',
      name: row.name,
      quantity: row.quantity,
      price: row.price,
    })))
    // 触发浏览器下载，文件名固定为 结算清单.xlsx（优先取后端 Content-Disposition）
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || '结算清单.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

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
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #title>
        本站暂不支持在线支付。请下载购物清单表格，通过以下联系方式与卖家沟通后完成下单。
      </template>
    </el-alert>

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
