import { test, expect } from '@playwright/test'
import { generateOrderNo, isUniqueConstraintError } from '../server/utils/orderNo.js'

// 本文件是纯函数单元测试：orderNo.js 无数据库等副作用依赖，可直接 import，
// 不依赖 webServer 拉起的后端进程（与其它接口级测试的「只打 HTTP」约定不冲突）。

test.describe('订单号生成', () => {
  test('格式：CO + 14 位秒级时间戳 + 3 位毫秒 + 6 位随机数', () => {
    const orderNo = generateOrderNo()
    expect(orderNo).toMatch(/^CO\d{23}$/)
    // 尾部 6 位随机数取值范围 [100000, 999999]，首位非零
    const random = Number(orderNo.slice(-6))
    expect(random).toBeGreaterThanOrEqual(100000)
    expect(random).toBeLessThanOrEqual(999999)
  })

  test('时间戳部分与当前时间一致（分钟级容忍）', () => {
    const now = new Date()
    const pad = v => String(v).padStart(2, '0')
    const minuteStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
    // 生成时间与断言时间可能跨分钟：允许等于当前分钟或前一分钟
    const stamp = generateOrderNo().slice(2, 14)
    const prevMinute = new Date(now.getTime() - 60_000)
    const prevStamp = `${prevMinute.getFullYear()}${pad(prevMinute.getMonth() + 1)}${pad(prevMinute.getDate())}${pad(prevMinute.getHours())}${pad(prevMinute.getMinutes())}`
    expect([minuteStamp, prevStamp]).toContain(stamp)
  })

  test('连续生成 200 个订单号互不重复', () => {
    const seen = new Set()
    for (let i = 0; i < 200; i++) seen.add(generateOrderNo())
    expect(seen.size).toBe(200)
  })
})

test.describe('唯一约束冲突判定（下单 409 兜底的识别依据）', () => {
  test('better-sqlite3 的 code 形态（SQLITE_CONSTRAINT_UNIQUE）→ true', () => {
    const error = Object.assign(new Error('UNIQUE constraint failed: customer_order.order_no'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(isUniqueConstraintError(error)).toBe(true)
  })

  test('仅 message 形态（UNIQUE constraint failed: customer_order.order_no）→ true', () => {
    expect(isUniqueConstraintError(new Error('SqliteError: UNIQUE constraint failed: customer_order.order_no'))).toBe(true)
  })

  test('其它错误 → false（不会被误判成 409）', () => {
    expect(isUniqueConstraintError(new Error('商品不存在'))).toBe(false)
    expect(isUniqueConstraintError(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }))).toBe(false)
    expect(isUniqueConstraintError(null)).toBe(false)
    expect(isUniqueConstraintError(undefined)).toBe(false)
  })
})
