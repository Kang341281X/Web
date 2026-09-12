// 后台订单展示常量与工具：状态筛选项 / 标签颜色 / 金额格式化。
// 「用户管理」详情里的历史订单概览与「订单管理」页共用这一份映射，避免两处各写一套。
// 状态取值与 server/utils/order.js 的 ORDER_STATUSES 保持一致。
export const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: '待确认' },
  { value: 'confirmed', label: '已确认' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]

// 五种状态对应五种颜色，便于在列表里快速扫读
const ORDER_STATUS_TAGS = {
  pending: 'warning',
  confirmed: 'primary',
  shipped: 'info',
  completed: 'success',
  cancelled: 'danger',
}

export function orderStatusTag(status) {
  return ORDER_STATUS_TAGS[status] || 'info'
}

export function formatAmount(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}
