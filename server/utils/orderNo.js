// 订单号生成与唯一约束冲突判定。
// 独立成无副作用依赖的纯函数模块：单元测试可以直接 import（不会拉起数据库连接），
// 也让「订单号怎么生成」与「订单事务怎么写入」（utils/order.js）各自独立演化。

// 订单号：CO + 年月日时分秒(14 位) + 毫秒(3 位) + 6 位随机数。
//   - 时间戳精确到毫秒 + 6 位随机数：同一毫秒内两个订单撞号的概率为 1/10^6，
//     相比原先「秒 + 4 位随机」同秒撞号 1/10^4 大幅降低；
//   - 即使如此，UNIQUE 约束仍可能（极小概率）触发，路由层按 409 兜底（见 routes/customerOrder.js）。
// 种子脚本生成的假订单号以 SD 开头（见 server/scripts/seed-dev-data.js），真实下单固定用 CO 前缀，
// 两者在库里一眼可区分，也便于排查「某条订单是真实下单还是造的数据」。
export function generateOrderNo() {
  const now = new Date()
  const pad = (value, length = 2) => String(value).padStart(length, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const milliseconds = pad(now.getMilliseconds(), 3)
  const random = String(100000 + Math.floor(Math.random() * 900000))
  return `CO${stamp}${milliseconds}${random}`
}

// 唯一索引冲突判定：与 routes/products.js 的 SKU 冲突兜底同一套识别口径——
// better-sqlite3 抛出的错误 code 为 SQLITE_CONSTRAINT_UNIQUE，
// message 形如 "UNIQUE constraint failed: customer_order.order_no"（两种形态都兼容）。
export function isUniqueConstraintError(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error?.message || '')
}
