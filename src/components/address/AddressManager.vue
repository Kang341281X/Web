<script setup>
/**
 * 收货地址列表 + 新增/编辑/删除/设为默认。
 *
 * 两种模式：
 * - mode="manage"（默认）：个人中心的地址管理，卡片上展示完整操作（设为默认 / 编辑 / 删除）。
 * - mode="select"：结算页选择地址（阶段 11 复用）。卡片整体可点选，配合
 *   `v-model:selected-id` 使用；列表加载完成后会自动选中默认地址（没有默认地址时选第一条），
 *   因此结算页不需要再自己判断初始选中项。
 *
 * 用法：
 *   <AddressManager />                                   // 管理
 *   <AddressManager mode="select" v-model:selected-id="addressId" @select="onSelect" />
 */
import { computed, onMounted, ref } from 'vue'
import { useAddressStore } from '../../stores/address'
import { useCustomerStore } from '../../stores/customer'
import { useLanguageStore } from '../../stores/language'
import { regionText } from '../../utils/address'
import AddressFormDialog from './AddressFormDialog.vue'

const props = defineProps({
  mode: { type: String, default: 'manage' },
  selectedId: { type: [Number, String], default: null },
})
const emit = defineEmits(['update:selectedId', 'select', 'load-error'])

const address = useAddressStore()
const customer = useCustomerStore()
const language = useLanguageStore()

const formVisible = ref(false)
const editing = ref(null)
const pendingDeleteId = ref(null)
const note = ref(null)

const isSelect = computed(() => props.mode === 'select')
const isSelected = item => isSelect.value && Number(props.selectedId) === item.id

const setNote = (type, text) => { note.value = { type, text } }

const select = item => {
  if (!isSelect.value) return
  emit('update:selectedId', item.id)
  emit('select', item)
}

const openCreate = () => {
  editing.value = null
  formVisible.value = true
}

const openEdit = item => {
  editing.value = item
  formVisible.value = true
}

// 列表已由 store 重新拉取，这里只负责提示与关闭弹窗
const onSaved = () => {
  formVisible.value = false
  setNote('success', language.t('addressSaved'))
}

const toggleDefault = async item => {
  const result = await address.setDefault(item.id)
  if (!result.success) return setNote('error', result.message)
  setNote('success', language.t('addressSetDefault'))
}

const remove = async id => {
  const result = await address.remove(id)
  pendingDeleteId.value = null
  if (!result.success) return setNote('error', result.message)
  setNote('success', language.t('addressDeleted'))
}

onMounted(async () => {
  if (!customer.isLoggedIn) return
  const result = await address.fetchList()
  if (!result.success) {
    setNote('error', result.message)
    emit('load-error', result.message)
    return
  }
  // 列表按「默认地址优先」排序，所以第一条就是默认地址
  if (isSelect.value && props.selectedId == null && address.list.length) select(address.list[0])
})
</script>

<template>
  <div class="address-manager">
    <div class="address-toolbar">
      <p v-if="isSelect">{{ language.t('selectAddress') }}</p>
      <button type="button" class="button primary" @click="openCreate">+ {{ language.t('addAddress') }}</button>
    </div>

    <p v-if="note" class="account-note" :class="note.type" role="status">{{ note.text }}</p>

    <div v-if="address.list.length" class="address-grid">
      <article
        v-for="item in address.list"
        :key="item.id"
        class="address-card"
        :class="{ selectable: isSelect, selected: isSelected(item) }"
        :role="isSelect ? 'radio' : null"
        :aria-checked="isSelect ? isSelected(item) : null"
        :tabindex="isSelect ? 0 : null"
        @click="select(item)"
        @keydown.enter.prevent="select(item)"
        @keydown.space.prevent="select(item)"
      >
        <span v-if="isSelect" class="address-radio" aria-hidden="true"></span>
        <div class="address-head">
          <span class="address-name">{{ item.receiver_name }}</span>
          <span class="address-phone">{{ item.receiver_phone }}</span>
          <span v-if="item.is_default" class="address-badge">{{ language.t('defaultAddress') }}</span>
        </div>
        <span v-if="regionText(item)" class="address-region">{{ regionText(item) }}</span>
        <p class="address-detail">{{ item.detail_address }}</p>

        <div v-if="pendingDeleteId !== item.id" class="address-actions">
          <button v-if="!isSelect && !item.is_default" type="button" class="text-button" @click.stop="toggleDefault(item)">{{ language.t('setAsDefault') }}</button>
          <button type="button" class="text-button" @click.stop="openEdit(item)">{{ language.t('edit') }}</button>
          <button v-if="!isSelect" type="button" class="text-button" @click.stop="pendingDeleteId = item.id">{{ language.t('delete') }}</button>
        </div>
        <div v-else class="address-confirm">
          <span>{{ language.t('deleteAddressConfirm') }}</span>
          <button type="button" class="text-button" :disabled="address.saving" @click.stop="remove(item.id)">{{ language.t('delete') }}</button>
          <button type="button" class="text-button" @click.stop="pendingDeleteId = null">{{ language.t('cancel') }}</button>
        </div>
      </article>
    </div>

    <!-- 复用 EmptyState 的视觉（empty-state / empty-icon），但动作用按钮触发弹窗而不是跳商品页 -->
    <div v-else class="empty-state">
      <div class="empty-icon">📍</div>
      <h2>{{ language.t('addressEmpty') }}</h2>
      <p>{{ language.t('addressEmptyText') }}</p>
      <button type="button" class="button primary" @click="openCreate">{{ language.t('addAddress') }}</button>
    </div>

    <AddressFormDialog v-model:visible="formVisible" :address="editing" @saved="onSaved" />
  </div>
</template>
