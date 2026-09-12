import db from '../config/db.js'
import storageService from '../services/storageService.js'

// 顾客端（购物车 / 收藏）联表商品时共用的字段。
// p.id 统一别名为 product_id，避免与 cart_item.id / customer_favorite.id 冲突。
// manufacturer / brand / sku 是前台展示与结算清单（Excel 的 SKU 列）需要的字段，
// 与 /api/public/products 的口径保持一致，前端购物车才能复用同一个商品适配器。
export const PRODUCT_FIELDS = `p.id AS product_id, p.name, p.category_id, c.name AS category_name, p.price, p.original_price, p.stock, p.sales, p.unit, p.manufacturer, p.brand, p.sku, p.main_image, p.status`

// 对外输出：价格转数值、主图补全为可直接访问的地址
export function publicProduct(product) {
  return {
    ...product,
    price: Number(product.price),
    original_price: product.original_price === null ? null : Number(product.original_price),
    main_image_url: storageService.getUrl(product.main_image),
  }
}

// 商品 id 解析：非法（非正整数）返回 null
export function parseProductId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 数量校验：必须是 >= 1 的整数；未传时按 1 处理（required 为真则报错）
export function requiredQuantity(value, { required = false, label = '数量' } = {}) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw Object.assign(new Error(`${label}不能为空`), { status: 400 })
    return 1
  }
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw Object.assign(new Error(`${label}必须是大于 0 的整数`), { status: 400 })
  }
  return quantity
}

// 读取单个商品（含库存 / 上架状态）；可传入事务连接 connection
export async function findProduct(productId, connection = db) {
  const [rows] = await connection.execute(
    `SELECT ${PRODUCT_FIELDS} FROM product p JOIN category c ON c.id = p.category_id WHERE p.id = ?`,
    [productId]
  )
  return rows[0] || null
}
