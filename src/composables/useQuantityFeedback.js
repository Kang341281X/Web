import { ElMessage } from 'element-plus'

/**
 * 数量变更（加购 / 改购物车数量）后的失败 / 截断提示统一收敛到这里，
 * 商品详情页与购物车页共用，避免再次出现两边文案不一致的问题。
 *
 * 后端约定（见 server/routes/customerCart.js）：
 *   - 加购：POST /api/customer/cart → { success, message, truncated, data }
 *   - 改数量：PUT  /api/customer/cart/:id → { success, message, truncated, data }
 *
 * 两接口截断时的 message 已经在后端统一为「库存仅剩 X 件，购物车数量已调整为 Y」，
 * 这里只负责按 result 字段弹出对应的 toast，不再各自维护文案。
 *
 * 行为约定：
 *   - success=true 且 truncated 未设 → 不弹任何 toast（让数字 / UI 自然反馈）
 *   - success=true 且 truncated=true → warning toast，使用 result.message
 *   - success=false 或缺失 → error toast，优先用 result.message，缺失时回退到 errorFallback
 */
export function useQuantityFeedback() {
  function handle(result, { errorFallback = '操作失败，请稍后重试' } = {}) {
    if (!result || result.success !== true) {
      ElMessage.error(result?.message || errorFallback)
      return
    }
    if (result.truncated) ElMessage.warning(result.message)
  }
  return { handle }
}