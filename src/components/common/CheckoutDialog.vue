<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, ShoppingCart } from '@element-plus/icons-vue'
import { useCartStore } from '../../stores/cart'
import { useCustomerStore } from '../../stores/customer'
import { useAddressStore } from '../../stores/address'
import { useCustomerOrderStore } from '../../stores/customerOrder'
import { useUserStore } from '../../stores/user'
import { useLanguageStore } from '../../stores/language'
import { productTitle } from '../../data/translations'
import { formatAddress } from '../../utils/address'
import { fetchSettings, saveIntentOrder, exportCheckoutList } from '../../services/publicApi'
import AppImage from '../common/AppImage.vue'

/**
 * 购物清单 / 结算弹窗：两条并行路径，互不替代。
 *  1) 提交订单（仅登录顾客）：选定收货地址后写入 customer_order + order_item，由后台人工确认发货；
 *  2) 下载结算清单（Excel）：无需登录，导出后可与客服核对再下单。
 * 本站不涉及任何在线支付。
 */
const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible'])

const router = useRouter()
const cart = useCartStore()
const customer = useCustomerStore()
const address = useAddressStore()
const orderStore = useCustomerOrderStore()
const user = useUserStore()
const language = useLanguageStore()

const dialogVisible = ref(props.visible)
const settings = ref({})
const settingsError = ref(false)
const downloaded = ref(false)
const downloading = ref(false)
const submitting = ref(false)
const selectedAddressId = ref(null)
const remark = ref('')

watch(() => props.visible, val => {
  dialogVisible.value = val
  if (val) {
    downloaded.value = false
    remark.value = ''
    selectedAddressId.value = null
    loadSettings()
    loadAddresses()
  }
})
watch(dialogVisible, val => emit('update:visible', val))
// 弹窗内点了「去登录」会先关闭弹窗，登录成功后再打开时由上面这个 watcher 重新加载地址
watch(() => customer.isLoggedIn, loggedIn => {
  if (loggedIn && dialogVisible.value) loadAddresses()
})

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

const canSubmit = computed(() => customer.isLoggedIn && !!selectedAddressId.value && tableRows.value.length > 0)

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

// 已登录时加载收货地址，并默认选中第一条（列表按「默认地址优先」排序，第一条即默认地址）
async function loadAddresses() {
  if (!customer.isLoggedIn) return
  const result = await address.fetchList()
  if (result.success && address.list.length) selectedAddressId.value = address.list[0].id
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

// 未登录时先关闭弹窗再唤起前台登录弹窗（登录弹窗层级低于 el-dialog，同屏会被盖住）
function goLogin() {
  dialogVisible.value = false
  user.openLogin()
}

// 提交订单：收货地址在下单时快照进订单，服务端事务内校验并扣减库存、清空对应购物车项
async function handleSubmit() {
  if (submitting.value) return
  if (!customer.isLoggedIn) return goLogin()
  if (!selectedAddressId.value) return ElMessage.warning(language.t('checkoutAddressEmpty'))
  if (!tableRows.value.length) return ElMessage.warning(language.t('checkoutNoItems'))

  submitting.value = true
  try {
    const result = await orderStore.createOrder({
      address_id: selectedAddressId.value,
      remark: remark.value.trim(),
      items: tableRows.value.map(row => ({ product_id: row.product.id, quantity: row.quantity })),
    })
    if (!result.success) return ElMessage.error(result.message)
    ElMessage.success(language.t('checkoutSubmitted'))
    dialogVisible.value = false
    // 服务端已在事务内清掉已下单的购物车项，这里同步最新购物车
    await cart.fetchFromServer()
    router.push('/orders')
  } finally {
    submitting.value = false
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
        本站暂不支持在线支付。{{ customer.isLoggedIn ? '提交订单后我们会人工确认并发货；也可以下载结算清单留存。' : language.t('checkoutLoginNeeded') }}
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

    <!-- 已登录：选择收货地址 + 买家备注，用于提交订单 -->
    <section v-if="customer.isLoggedIn" class="checkout-section">
      <div class="checkout-section__head">
        <h4>{{ language.t('checkoutAddress') }}</h4>
        <RouterLink class="text-button" to="/account/addresses" @click="dialogVisible = false">{{ language.t('manageAddress') }}</RouterLink>
      </div>

      <p v-if="address.loading" class="checkout-muted">{{ language.t('loading') }}</p>
      <ul v-else-if="address.list.length" class="checkout-addresses">
        <li
          v-for="item in address.list"
          :key="item.id"
          class="checkout-address"
          :class="{ selected: selectedAddressId === item.id }"
          role="radio"
          :aria-checked="selectedAddressId === item.id"
          tabindex="0"
          @click="selectedAddressId = item.id"
          @keydown.enter.prevent="selectedAddressId = item.id"
          @keydown.space.prevent="selectedAddressId = item.id"
        >
          <span class="checkout-address__radio" aria-hidden="true"></span>
          <div class="checkout-address__body">
            <p>
              <strong>{{ item.receiver_name }}</strong>
              <span class="checkout-address__phone">{{ item.receiver_phone }}</span>
              <span v-if="item.is_default" class="checkout-address__badge">{{ language.t('defaultAddress') }}</span>
            </p>
            <p class="checkout-address__text">{{ formatAddress(item) }}</p>
          </div>
        </li>
      </ul>
      <div v-else class="checkout-empty-address">
        <p>{{ language.t('checkoutAddressEmpty') }}</p>
        <RouterLink class="button primary" to="/account/addresses" @click="dialogVisible = false">{{ language.t('checkoutGoAddAddress') }}</RouterLink>
      </div>

      <label class="checkout-remark">{{ language.t('checkoutRemark') }}
        <textarea v-model="remark" rows="2" maxlength="200" :placeholder="language.t('checkoutRemarkPlaceholder')"></textarea>
      </label>
    </section>

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
        <el-button @click="dialogVisible = false">{{ language.t('close') }}</el-button>
        <el-button :icon="Download" :loading="downloading" @click="handleDownload">{{ language.t('checkoutDownload') }}</el-button>
        <el-button v-if="customer.isLoggedIn" type="primary" :icon="ShoppingCart" :loading="submitting" :disabled="!canSubmit" @click="handleSubmit">{{ language.t('checkoutSubmit') }}</el-button>
        <el-button v-else type="primary" @click="goLogin">{{ language.t('goLogin') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 全局 .text-button 是零内边距的小号文字按钮，移动端点击区域不足，这里补足 */
.text-button { display: inline-flex; align-items: center; min-height: 36px; padding: 8px 4px }

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

.checkout-section { margin-bottom: 16px }
.checkout-section__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px }
.checkout-section__head h4 { margin: 0; font-size: .95rem }
.checkout-muted { color: #909399; font-size: .84rem; margin: 0 0 12px }

.checkout-addresses { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px }
.checkout-address { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 12px 12px 12px 34px; border: 1px solid #e7e0d6; background: #fffdf9; cursor: pointer; transition: border-color .18s, box-shadow .18s }
.checkout-address.selected { border-color: var(--clay, #c75f3e); box-shadow: 0 0 0 2px rgba(199, 95, 62, .14) }
.checkout-address__radio { position: absolute; left: 12px; top: 15px; width: 15px; height: 15px; border: 1px solid #d9d0c4; border-radius: 50%; background: #fff }
.checkout-address.selected .checkout-address__radio { border-color: var(--clay, #c75f3e); background: radial-gradient(circle, var(--clay, #c75f3e) 0 45%, transparent 46%) }
.checkout-address__body { min-width: 0; flex: 1 }
.checkout-address__body p { margin: 0 0 4px; font-size: .84rem; line-height: 1.5; word-break: break-word }
.checkout-address__phone { color: #746f68; margin-left: 6px }
.checkout-address__badge { margin-left: 8px; font-size: .66rem; font-weight: 700; color: var(--clay, #c75f3e); background: rgba(199, 95, 62, .12); border-radius: 99px; padding: 2px 8px }
.checkout-address__text { color: #55504a }

.checkout-empty-address { padding: 16px; background: #f7f4ee; text-align: center; margin-bottom: 12px }
.checkout-empty-address p { margin: 0 0 12px; font-size: .84rem; color: #746f68 }

.checkout-remark { display: block; font-size: .82rem; font-weight: 600; color: #4e4944 }
.checkout-remark textarea { display: block; width: 100%; margin-top: 8px; padding: 10px; border: 1px solid #e7e0d6; background: #fff; color: #292622; resize: vertical; font: inherit; min-height: 62px }
.checkout-remark textarea:focus { outline: 2px solid var(--clay, #c75f3e); outline-offset: 1px }

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
  flex-wrap: wrap;
}

@media (max-width: 760px) {
  .checkout-addresses { grid-template-columns: 1fr }
  /* 移动端把按钮铺满一行、点击区域加大，避免误触 */
  .dialog-footer { flex-direction: column-reverse; gap: 8px }
  .dialog-footer :deep(.el-button) { width: 100%; margin-left: 0; min-height: 44px }
  .checkout-remark textarea { font-size: 16px }
}
</style>
