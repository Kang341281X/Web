// 临时脚本：在服务启动（迁移重跑、目录重建）之后补建订单夹具，用完即删。
// 注意：必须在服务启动之后执行，否则订单明细的 product_id 会被 006/009 的 DELETE FROM product 置空。
import Database from 'better-sqlite3'

const db = new Database('./server/tmp12test.db')
db.pragma('busy_timeout = 5000')
db.prepare('DELETE FROM order_item').run()
db.prepare('DELETE FROM customer_order').run()

const address = '广东省 深圳市 南山区 科技园南路 1 号 101 室'
const products = db.prepare('SELECT id, name, sku, price, stock FROM product ORDER BY id LIMIT 8').all()
const today = new Date().toISOString().slice(0, 19).replace('T', ' ')
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')

function createOrder({ orderNo, customerId, status, createdAt, items }) {
  const total = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2))
  const orderId = db.prepare(`INSERT INTO customer_order (order_no, customer_id, receiver_name, receiver_phone, receiver_address, total_amount, status, remark, created_at, updated_at)
    VALUES (?, ?, '张小明', '13900001111', ?, ?, ?, ?, ?, ?)`).run(orderNo, customerId, address, total, status, status === 'pending' ? '麻烦尽快发货，谢谢' : null, createdAt, createdAt).lastInsertRowid
  for (const item of items) {
    db.prepare('INSERT INTO order_item (order_id, product_id, product_name, product_sku, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(orderId, item.id, item.name, item.sku, item.price, item.quantity, Number((item.price * item.quantity).toFixed(2)))
    if (status !== 'cancelled') db.prepare('UPDATE product SET stock = stock - ?, sales = sales + ? WHERE id = ?').run(item.quantity, item.quantity, item.id)
  }
  return orderId
}

const pick = (index, quantity) => ({ ...products[index], quantity })
const orders = {
  pendingToday: createOrder({ orderNo: 'CO260912100001', customerId: 1, status: 'pending', createdAt: today, items: [pick(0, 2), pick(1, 1)] }),
  confirmedToday: createOrder({ orderNo: 'CO260912100002', customerId: 1, status: 'confirmed', createdAt: today, items: [pick(2, 2)] }),
  shippedOld: createOrder({ orderNo: 'CO260909100003', customerId: 1, status: 'shipped', createdAt: daysAgo(3), items: [pick(3, 1)] }),
  completedOld: createOrder({ orderNo: 'CO260909100004', customerId: 1, status: 'completed', createdAt: daysAgo(3), items: [pick(4, 3), pick(5, 1)] }),
  cancelledOld: createOrder({ orderNo: 'CO260909100005', customerId: 1, status: 'cancelled', createdAt: daysAgo(3), items: [pick(6, 1)] }),
  pendingOther: createOrder({ orderNo: 'CO260912100006', customerId: 2, status: 'pending', createdAt: today, items: [pick(7, 1)] }),
}

console.log(JSON.stringify({
  orders,
  seeds: products.map(item => ({ id: item.id, stock: item.stock })),
  nowStocks: db.prepare('SELECT id, stock FROM product WHERE id IN (3, 40)').all(),
  expectedAmount: db.prepare("SELECT ROUND(SUM(total_amount), 2) AS total FROM customer_order WHERE status <> 'cancelled'").get().total,
  itemsWithProductId: db.prepare('SELECT COUNT(*) AS total FROM order_item WHERE product_id IS NOT NULL').get().total,
  totalItems: db.prepare('SELECT COUNT(*) AS total FROM order_item').get().total,
}, null, 2))
db.close()
