// 临时脚本：阶段 12 接口自测（跑完即删）
const base = 'http://localhost:3101'
let failures = 0

function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} wanted=${JSON.stringify(wanted)}`)
}

function money(value) { return Math.round(Number(value) * 100) / 100 }

async function call(method, path, { token, body, silent } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!silent) console.log(`--- ${method} ${path} -> ${res.status}\n${JSON.stringify(json)}`)
  return { status: res.status, json }
}

console.log('===== 登录 =====')
const login = await call('POST', '/api/admin/login', { body: { username: 'superadmin', password: '123456' } })
const token = login.json?.token
if (!token) { console.log('登录失败，后续用例无法继续'); process.exit(1) }

console.log('\n===== 统计接口 =====')
const orderStats = await call('GET', '/api/admin-orders/stats', { token })
expect('订单统计-总数', orderStats.json.data.total_orders, 6)
expect('订单统计-待处理', orderStats.json.data.pending_orders, 2)
expect('订单统计-今日', orderStats.json.data.today_orders, 3)
expect('订单统计-已取消', orderStats.json.data.cancelled_orders, 1)
expect('订单统计-有效金额', money(orderStats.json.data.total_amount), 2503)

const customerStats = await call('GET', '/api/admin-customers/stats', { token })
expect('顾客统计-总数', customerStats.json.data.total_customers, 2)
expect('顾客统计-启用', customerStats.json.data.active_customers, 1)
expect('顾客统计-禁用', customerStats.json.data.disabled_customers, 1)

const productStats = await call('GET', '/api/products/stats', { token })
expect('商品统计-总数', productStats.json.data.total_products, 40)
expect('商品统计-分类数', productStats.json.data.total_categories, 7)
expect('商品统计-分类占比求和', productStats.json.data.category_distribution.reduce((sum, item) => sum + item.value, 0), 40)
expect('商品统计-趋势天数', productStats.json.data.daily_new.length, 7)
expect('商品统计-低库存阈值', productStats.json.data.low_stock_threshold, 10)

console.log('\n===== 订单列表筛选 / 详情 =====')
const allOrders = await call('GET', '/api/admin-orders?page=1&page_size=20', { token, silent: true })
expect('订单列表条数', allOrders.json.data.length, 6)
const pending = await call('GET', '/api/admin-orders?status=pending', { token, silent: true })
expect('按状态筛选-pending', pending.json.data.every(row => row.status === 'pending') && pending.json.data.length, 2)
const byOrderNo = await call('GET', '/api/admin-orders?keyword=CO260912100001', { token, silent: true })
expect('按订单号搜索', byOrderNo.json.data.map(row => row.order_no), ['CO260912100001'])
const byPhone = await call('GET', '/api/admin-orders?phone=13900002222', { token, silent: true })
expect('按顾客手机号查询', byPhone.json.data.map(row => row.order_no), ['CO260912100006'])
const detail = await call('GET', '/api/admin-orders/7', { token, silent: true })
expect('订单详情-明细数', detail.json.data.items.length, 2)
expect('订单详情-收货地址', detail.json.data.receiver_address.includes('科技园南路'), true)
expect('订单详情-明细金额合计', money(detail.json.data.items.reduce((sum, item) => sum + item.subtotal, 0)), money(detail.json.data.total_amount))
// 顾客详情放在任何写操作之前检查，保证断言口径干净
const customerDetail = await call('GET', '/api/admin-customers/1', { token, silent: true })
expect('顾客详情-地址数', customerDetail.json.data.addresses.length, 2)
expect('顾客详情-订单数', customerDetail.json.data.order_count, 5)
expect('顾客详情-已取消数', customerDetail.json.data.cancelled_count, 1)

console.log('\n===== 订单状态流转 =====')
const shippedCancel = await call('PUT', '/api/admin-orders/9/status', { token, body: { status: 'cancelled' } })
expect('已发货订单不可取消', [shippedCancel.status, shippedCancel.json.message], [400, '订单不能从「已发货」变更为「已取消」'])

const productBefore = await call('GET', '/api/products/3', { token, silent: true })
const stockBefore = productBefore.json.data.stock
const cancelConfirmed = await call('PUT', '/api/admin-orders/8/status', { token, body: { status: 'cancelled' } })
expect('取消已确认订单', [cancelConfirmed.status, cancelConfirmed.json.data.status, cancelConfirmed.json.restored], [200, 'cancelled', 1])
const productAfter = await call('GET', '/api/products/3', { token, silent: true })
expect('取消后退还库存', productAfter.json.data.stock - stockBefore, 2)
const statsAfterCancel = await call('GET', '/api/admin-orders/stats', { token, silent: true })
expect('取消后有效金额', money(statsAfterCancel.json.data.total_amount), 1925)
expect('取消后已取消数', statsAfterCancel.json.data.cancelled_orders, 2)

const confirmOrder = await call('PUT', '/api/admin-orders/7/status', { token, body: { status: 'confirmed' } })
expect('确认订单', [confirmOrder.status, confirmOrder.json.data.status, confirmOrder.json.data.handled_by_name], [200, 'confirmed', '超级管理员'])
const shipOrder = await call('PUT', '/api/admin-orders/7/status', { token, body: { status: 'shipped' } })
expect('标记发货', [shipOrder.status, shipOrder.json.data.status], [200, 'shipped'])
const completeOrder = await call('PUT', '/api/admin-orders/7/status', { token, body: { status: 'completed' } })
expect('标记完成', [completeOrder.status, completeOrder.json.data.status], [200, 'completed'])
const completedCancel = await call('PUT', '/api/admin-orders/7/status', { token, body: { status: 'cancelled' } })
expect('已完成订单不可取消', [completedCancel.status, completedCancel.json.message], [400, '订单不能从「已完成」变更为「已取消」'])

console.log('\n===== 用户列表 / 详情 / 启用禁用 =====')
const customers = await call('GET', '/api/admin-customers?page=1&page_size=20', { token, silent: true })
expect('顾客列表条数', customers.json.data.length, 2)
const disabledList = await call('GET', '/api/admin-customers?status=0', { token, silent: true })
expect('按状态筛选顾客', disabledList.json.data.map(row => row.phone), ['13900002222'])
const searchCustomer = await call('GET', '/api/admin-customers?keyword=13900001111', { token, silent: true })
expect('按手机号搜索顾客', searchCustomer.json.data.map(row => row.id), [1])
const disabledLogin = await call('POST', '/api/customer/login', { body: { phone: '13900002222', password: '123456' } })
expect('禁用顾客无法登录', [disabledLogin.status, disabledLogin.json.message], [403, '该账号已被禁用'])
const enable = await call('PUT', '/api/admin-customers/2/status', { token, body: { status: 1 } })
expect('启用顾客', [enable.status, enable.json.data.status], [200, 1])
const enabledLogin = await call('POST', '/api/customer/login', { body: { phone: '13900002222', password: '123456' } })
expect('启用后可登录', enabledLogin.status, 200)
const disable = await call('PUT', '/api/admin-customers/2/status', { token, body: { status: 0 } })
expect('禁用顾客', [disable.status, disable.json.data.status], [200, 0])

console.log('\n===== 商品统计低库存口径 =====')
const productOne = await call('GET', '/api/products/40', { token, silent: true })
const target = productOne.json.data
await call('PUT', '/api/products/40', { token, body: { ...target, stock: 3 } })
const lowStockStats = await call('GET', '/api/products/stats', { token, silent: true })
expect('低库存计数', lowStockStats.json.data.low_stock, 1)
await call('PUT', '/api/products/40', { token, body: { ...target, stock: target.stock } })

console.log(`\n===== 失败用例数：${failures} =====`)
