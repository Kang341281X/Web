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
import { fetchSettings, exportCheckoutList } from '../../services/publicApi'
import { useIsMobile } from '../../composables/useIsMobile'
import AppImage from '../common/AppImage.vue'

/**
 * 购物清单 / 结算弹窗：两条并行路径，互不替代。
 *  1) 提交订单：选定收货地址后写入 customer_order + order_item，由后台人工确认发货；
 *  2) 下载结算清单（Excel）：导出后可与客服核对再下单。
 * 本站不涉及任何在线支付。
 * 注：游客无法加购，购物车为空，因此本弹窗只有已登录用户才会看到有商品的状态。
 */
const props = defineProps({
  visible: Boolean,
  // 由 Cart.vue 传入：当前语言对应的 shipping_rate.fee_cny，即页面展示给顾客的运费；
  // 0 表示包邮。仅用于提交给后端做一致性校验（后端按 shipping_rate 重新计算，
  // 两值不一致会拒绝下单），最终写入订单的金额以服务端为准。
  shippingFee: { type: Number, default: 0 },
})
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

// 移动端断点：桌面用表格、手机用卡片列表渲染商品明细（表格最小宽 570px，窄屏会横向滚动）。
// 复用 useIsMobile（matchMedia + change 实时切换，组件卸载自动移除监听），断点保持原 760px。
const isMobile = useIsMobile(760)

// 与 Cart.vue 保持一致：feeCny <= 0 视为包邮，提示文案相应切换
const shippingFree = computed(() => (Number(props.shippingFee) || 0) <= 0)
const shippingFee = computed(() => Number(props.shippingFee) || 0)

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

// 合计金额 = 商品小计 + 运费（与后端 customer_order.total_amount 口径一致）
const totalAmount = computed(() =>
  tableRows.value.reduce((sum, row) => sum + row.subtotal, 0) + shippingFee.value
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

// 下载 Excel（不再写入意向单：游客无法加购，该功能已下线）
async function handleDownload() {
  if (downloading.value) return
  downloading.value = true

  try {
    // 调用后端接口，基于 public/assets/结算清单.xlsx 模板生成文件并返回
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
      // 运费：声明界面语言 locale + 页面展示的运费值。后端按 locale 查 shipping_rate
      // 重新计算并以服务端金额为准写入订单；与展示值不一致（后台刚调价）会拒绝下单
      // 并提示刷新重试，保证顾客不会被收取页面上没显示过的金额
      locale: language.locale,
      shipping_fee: shippingFee.value,
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
        本站暂不支持在线支付。提交订单后我们会人工确认并发货；也可以下载结算清单留存。
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

    <!-- 商品明细：桌面端保留表格；移动端换卡片式竖排列表，避免窄屏横向滚动 -->
    <el-table v-if="!isMobile" :data="tableRows" border style="width: 100%" :max-height="360">
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
    <ul v-else class="checkout-items-mobile">
      <li v-for="row in tableRows" :key="row.product.id">
        <AppImage :src="row.image" :alt="row.name" class="checkout-item__thumb" />
        <div class="checkout-item__main">
          <p class="checkout-item__name">{{ row.name }}</p>
          <p class="checkout-item__meta">¥{{ row.price.toFixed(2) }} × {{ row.quantity }}</p>
        </div>
        <strong class="checkout-item__subtotal">¥{{ row.subtotal.toFixed(2) }}</strong>
      </li>
    </ul>

    <div class="checkout-total">
      <span>{{ language.t('subtotal') }}</span>
      <b>¥{{ tableRows.reduce((s, r) => s + r.subtotal, 0).toFixed(2) }}</b>
    </div>
    <div class="checkout-total checkout-total--shipping">
      <span>{{ language.t('shippingEstimate') }}</span>
      <b>{{ shippingFree ? language.t('shippingFree') : `¥${shippingFee.toFixed(2)}` }}</b>
    </div>
    <p v-if="!shippingFree" class="checkout-shipping-hint">{{ language.t('shippingEstimateHint') }}</p>
    <div class="checkout-total checkout-total--grand">
      <span>{{ language.t('total') }}</span>
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
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  padding: 4px 0;
  font-size: .92rem;
  color: #55504a;
}
.checkout-total strong {
  font-size: 1.35rem;
  color: var(--clay, #c75f3e);
}
.checkout-total--shipping { color: var(--muted, #746f68) }
.checkout-total--grand {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line, #e7e0d6);
  font-size: 1rem;
}
.checkout-shipping-hint {
  margin: -2px 0 8px;
  font-size: 12px;
  color: #909399;
  text-align: right;
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

/* 移动端商品明细卡片（替代 el-table）：视觉与 Orders.vue 的 .order-items 移动端卡片保持一致 */
.checkout-items-mobile { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line) }
.checkout-items-mobile li {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.checkout-item__thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); background: var(--cream) }
.checkout-item__main { min-width: 0 }
.checkout-item__name { font-size: .88rem; font-weight: 600; margin: 0; word-break: break-word }
.checkout-item__meta { font-size: .78rem; color: var(--muted); margin: 4px 0 0; white-space: nowrap }
.checkout-item__subtotal { font-size: .88rem }

@media (max-width: 760px) {
  .checkout-addresses { grid-template-columns: 1fr }
  /* 移动端把按钮铺满一行、点击区域加大，避免误触 */
  .dialog-footer { flex-direction: column-reverse; gap: 8px }
  .dialog-footer :deep(.el-button) { width: 100%; margin-left: 0; min-height: 44px }
  .checkout-remark textarea { font-size: 16px }
}
</style>
