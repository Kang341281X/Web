<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useCustomerOrderStore } from '../stores/customerOrder'
import { useCustomerStore } from '../stores/customer'
import { useLanguageStore } from '../stores/language'
import { useUserStore } from '../stores/user'
import EmptyState from '../components/common/EmptyState.vue'
import { formatAmount } from '../utils/order'

/**
 * 顾客端「我的订单」：列表 + 详情 + 取消。
 * 下单入口在购物车结算弹窗（CheckoutDialog），这里只负责查看与取消。
 * 未登录时复用前台登录弹窗（与个人中心 / 地址页一致），不做独立登录页。
 */
const router = useRouter()
const orders = useCustomerOrderStore()
const customer = useCustomerStore()
const language = useLanguageStore()
const user = useUserStore()

const STATUS_FILTERS = ['', 'pending', 'confirmed', 'shipped', 'completed', 'cancelled']
const status = ref('')
const detail = ref(null)
const detailLoading = ref(false)
const confirmingCancel = ref(false)
const cancelling = ref(false)
const page = ref(1)
const pageSize = 10

const statusLabel = value => language.t(`orderStatus_${value}`) || value
const canCancel = computed(() => ['pending', 'confirmed'].includes(detail.value?.status))

// 订单详情内商品金额合计：明细每行已快照 subtotal，独立累加展示「商品金额」，
// 与数据库里 customer_order.total_amount（= 商品金额 + shipping_fee）口径对应拆分
const goodsSubtotal = computed(() => {
  const items = detail.value?.items
  if (!Array.isArray(items)) return 0
  return items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
})

const pages = computed(() => Math.max(Math.ceil(orders.total / pageSize), 1))

function formatTime(value) {
  return value ? new Date(value).toLocaleString(language.locale, { hour12: false }) : '-'
}

const goHome = async () => {
  user.openLogin()
  await router.replace('/')
}

async function load() {
  const result = await orders.fetchList({ page: page.value, page_size: pageSize, status: status.value })
  if (!result.success) {
    ElMessage.error(result.message)
    if (!customer.isLoggedIn) goHome()
  }
}

function changeStatus(value) {
  status.value = value
  page.value = 1
  load()
}

function goPage(next) {
  page.value = next
  load()
}

async function openDetail(order) {
  detail.value = order
  confirmingCancel.value = false
  detailLoading.value = true
  const result = await orders.fetchDetail(order.id)
  detailLoading.value = false
  if (!result.success) return ElMessage.error(result.message)
  detail.value = result.data
}

async function cancelOrder() {
  if (!detail.value) return
  cancelling.value = true
  const result = await orders.cancelOrder(detail.value.id)
  cancelling.value = false
  if (!result.success) return ElMessage.error(result.message)
  ElMessage.success(result.message)
  detail.value = result.data
  confirmingCancel.value = false
  await load()
}

onMounted(() => {
  if (!customer.isLoggedIn) return goHome()
  load()
})
</script>

<template>
  <section v-if="customer.isLoggedIn" class="container page orders-page">
    <div class="page-intro">
      <span class="eyebrow">{{ language.t('account') }}</span>
      <h1>{{ language.t('myOrders') }}</h1>
      <p>{{ language.t('ordersText') }}</p>
    </div>

    <div class="orders-filters" role="tablist">
      <button
        v-for="value in STATUS_FILTERS"
        :key="value || 'all'"
        type="button"
        role="tab"
        :aria-selected="status === value"
        :class="{ active: status === value }"
        @click="changeStatus(value)"
      >
        {{ value ? statusLabel(value) : language.t('all') }}
      </button>
    </div>

    <p v-if="orders.loading" class="orders-hint">{{ language.t('loading') }}</p>

    <EmptyState
      v-else-if="!orders.list.length"
      icon="📦"
      :title="language.t('ordersEmpty')"
      :action="language.t('continueShopping')"
    />

    <div v-else class="orders-list">
      <article v-for="order in orders.list" :key="order.id" class="order-card">
        <header class="order-card__head">
          <span class="order-card__no">{{ language.t('orderNo') }} {{ order.order_no }}</span>
          <span class="order-status" :class="`is-${order.status}`">{{ order.status_label }}</span>
        </header>
        <p class="order-card__meta">
          <span>{{ formatTime(order.created_at) }}</span>
          <span>{{ order.item_quantity }} {{ language.t('items') }}</span>
        </p>
        <div class="order-card__body">
          <p class="order-card__receiver">{{ order.receiver_name }} · {{ order.receiver_phone }}</p>
          <strong class="order-card__amount">{{ formatAmount(order.total_amount) }}</strong>
        </div>
        <footer class="order-card__foot">
          <span class="order-card__address">{{ order.receiver_address }}</span>
          <button type="button" class="text-button" @click="openDetail(order)">{{ language.t('orderDetail') }}</button>
        </footer>
      </article>
    </div>

    <div v-if="pages > 1" class="orders-pagination">
      <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
      <span>{{ page }} / {{ pages }}</span>
      <button type="button" :disabled="page >= pages" @click="goPage(page + 1)">›</button>
    </div>

    <Teleport to="body">
      <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
        <div class="order-modal" role="dialog" aria-modal="true">
          <button type="button" class="icon-button modal-close" :aria-label="language.t('close')" @click="detail = null">×</button>
          <span class="eyebrow">{{ language.t('orderDetail') }}</span>
          <h2>{{ detail.order_no }}</h2>
          <p class="order-modal__status">
            <span class="order-status" :class="`is-${detail.status}`">{{ detail.status_label }}</span>
            <span>{{ formatTime(detail.created_at) }}</span>
          </p>

          <div v-if="detailLoading" class="orders-hint">{{ language.t('loading') }}</div>

          <template v-else>
            <div class="order-modal__section">
              <h3>{{ language.t('receiverInfo') }}</h3>
              <p>{{ detail.receiver_name }} · {{ detail.receiver_phone }}</p>
              <p>{{ detail.receiver_address }}</p>
              <p v-if="detail.remark" class="order-modal__remark">{{ language.t('buyerRemark') }}：{{ detail.remark }}</p>
            </div>

            <div class="order-modal__section">
              <h3>{{ language.t('orderItems') }}</h3>
              <ul class="order-items">
                <li v-for="item in detail.items" :key="item.id">
                  <span class="order-item__name">
                    {{ item.product_name }}
                    <small v-if="item.product_sku">{{ item.product_sku }}</small>
                  </span>
                  <span class="order-item__qty">{{ formatAmount(item.price) }} × {{ item.quantity }}</span>
                  <strong>{{ formatAmount(item.subtotal) }}</strong>
                </li>
              </ul>
              <div class="order-modal__breakdown">
                <p><span>{{ language.t('orderGoodsAmount') }}</span><b>{{ formatAmount(goodsSubtotal) }}</b></p>
                <p>
                  <span>{{ language.t('orderShipping') }}</span>
                  <b>{{ Number(detail.shipping_fee) > 0 ? formatAmount(detail.shipping_fee) : language.t('shippingFree') }}</b>
                </p>
                <p class="order-modal__total">{{ language.t('total') }}：<strong>{{ formatAmount(detail.total_amount) }}</strong></p>
              </div>
            </div>

            <div v-if="confirmingCancel" class="order-modal__confirm">
              <span>{{ language.t('cancelOrderConfirm') }}</span>
              <button type="button" class="text-button" :disabled="cancelling" @click="cancelOrder">{{ language.t('cancelOrder') }}</button>
              <button type="button" class="text-button" @click="confirmingCancel = false">{{ language.t('cancel') }}</button>
            </div>
          </template>

          <div class="order-modal__actions">
            <button type="button" class="button" @click="detail = null">{{ language.t('close') }}</button>
            <button
              v-if="canCancel && !confirmingCancel"
              type="button"
              class="button primary"
              @click="confirmingCancel = true"
            >{{ language.t('cancelOrder') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
/* 全局 .text-button 是零内边距的小号文字按钮，移动端点击区域不足，这里补足到 40px 以上 */
.text-button { display: inline-flex; align-items: center; min-height: 40px; padding: 8px 4px }
.modal-close { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center }

.orders-filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 20px; -webkit-overflow-scrolling: touch }
.orders-filters button { flex: none; border: 1px solid var(--line); background: var(--paper); color: var(--muted); border-radius: 99px; padding: 9px 16px; font-size: .82rem; min-height: 40px; transition: border-color .18s, color .18s, background .18s }
.orders-filters button.active { border-color: var(--clay); background: rgba(199, 95, 62, .1); color: var(--clay); font-weight: 600 }
.orders-hint { color: var(--muted); text-align: center; padding: 40px 0; font-size: .86rem }

.orders-list { display: flex; flex-direction: column; gap: 14px }
.order-card { background: var(--cream); border: 1px solid var(--line); padding: 18px }
.order-card__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap }
.order-card__no { font-size: .8rem; color: var(--muted); word-break: break-all }
.order-card__meta { display: flex; gap: 16px; flex-wrap: wrap; margin: 10px 0; font-size: .76rem; color: var(--muted) }
.order-card__body { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap }
.order-card__receiver { margin: 0; font-size: .86rem }
.order-card__amount { font-size: 1.05rem; color: var(--clay) }
.order-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line) }
.order-card__address { font-size: .76rem; color: var(--muted); line-height: 1.5; word-break: break-word }

.order-status { flex: none; font-size: .72rem; font-weight: 600; padding: 4px 10px; border-radius: 99px; background: #eee7df; color: #574d43 }
.order-status.is-pending { background: #fdf0d9; color: #a86b12 }
.order-status.is-confirmed { background: #e2ebfa; color: #2f5da8 }
.order-status.is-shipped { background: #e6eef0; color: #3f6b74 }
.order-status.is-completed { background: #e3efe4; color: #3d7a48 }
.order-status.is-cancelled { background: #f4e4e2; color: #a4443b }

.orders-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 22px; color: var(--muted); font-size: .84rem }
.orders-pagination button { width: 40px; height: 40px; border: 1px solid var(--line); background: var(--paper); border-radius: 50%; font-size: 1.1rem; line-height: 1 }
.orders-pagination button:disabled { opacity: .4 }

.order-modal { position: relative; width: min(560px, calc(100% - 32px)); max-height: calc(100vh - 40px); overflow-y: auto; background: var(--paper); padding: 30px; box-shadow: var(--shadow) }
.order-modal h2 { font: 600 1.6rem 'Playfair Display', serif; letter-spacing: -.03em; margin: 14px 0 8px; word-break: break-all }
.order-modal__status { display: flex; align-items: center; gap: 12px; margin: 0 0 6px; font-size: .78rem; color: var(--muted) }
.order-modal__section { margin-top: 20px }
.order-modal__section h3 { font-size: .82rem; font-weight: 700; margin: 0 0 10px }
.order-modal__section p { margin: 0 0 6px; font-size: .84rem; line-height: 1.6; color: #55504a }
.order-modal__remark { color: var(--muted) }
.order-items { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line) }
.order-items li { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); font-size: .84rem }
.order-item__name { display: flex; flex-direction: column; gap: 3px; word-break: break-word }
.order-item__name small { color: var(--muted); font-size: .72rem }
.order-item__qty { color: var(--muted); white-space: nowrap }
.order-modal__total { text-align: right; font-size: .88rem }
.order-modal__total strong { font-size: 1.15rem; color: var(--clay) }

/* 订单金额拆为「商品金额 + 运费 + 合计」三行展示，明细下方、合计上方 */
.order-modal__breakdown { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line) }
.order-modal__breakdown p {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: .82rem;
  color: var(--muted);
}
.order-modal__breakdown p b { color: #292622; font-weight: 600 }
.order-modal__confirm { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; padding: 10px 12px; background: rgba(179, 38, 30, .06); color: #b3261e; font-size: .78rem; line-height: 1.5 }
.order-modal__confirm .text-button { color: #b3261e }
.order-modal__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; flex-wrap: wrap }

@media (max-width: 760px) {
  .orders-filters { margin-inline: -16px; padding-inline: 16px }
  .order-card { padding: 15px }
  .order-card__amount { font-size: 1rem }
  .order-modal { padding: 22px; width: calc(100% - 24px); max-height: calc(100vh - 24px) }
  .order-modal__actions .button { flex: 1 }
  .order-items li { grid-template-columns: 1fr auto; row-gap: 4px }
  .order-item__qty { grid-column: 1 }
  .order-items li strong { grid-row: 1 / span 2; grid-column: 2 }
}
</style>
