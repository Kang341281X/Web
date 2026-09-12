/**
 * 商品目录假数据填充脚本（可重复执行，一次性创建 400 条商品）
 *
 * 用法：npm run seed:products
 * 前置：先执行 npm run db:migrate（或启动过一次后端），确保 category / product 表已就绪。
 *       推荐顺序：npm run db:migrate → npm run seed:products → npm run seed:dev
 *
 * 设计要点：
 *  1. 幂等：本脚本插入的商品，商品编号(SKU)统一使用保留前缀 ZZZ（见 SEED_SKU_PREFIX）。
 *     每次执行先按该前缀精确清理上一轮假数据再重建，重复执行不会重复插入。
 *     选 SKU 而不是名称/描述做标记，是因为后台编辑商品时会用 htmlToPlainText 把描述里的
 *     HTML 标记抹掉，而 SKU 在后台是只读字段（见 server/routes/products.js 的 validateProduct），
 *     所以即便有人改过某个假商品的名称或描述，清理时依然能准确认出它。
 *  2. 与手工数据共存：只删除 SKU 命中的行，绝不重建整表、不重置 sqlite_sequence，
 *     管理员在后台新增/维护的商品（含 006/009 的 40 条历史演示商品）完全不受影响。
 *  3. 与历史破坏性脚本隔离：006_seed_catalog.sql / 009_reseed_catalog.sql 是
 *     「DELETE 整表 + 重建 40 条」的写法，本脚本跑完后会把它们写入 schema_migrations
 *     标记为「已执行」，保证后续 npm run db:migrate 不会再重跑它们把商品目录清空。
 *  4. 可复现：固定种子的伪随机数，同一个库重复执行得到同一批假数据，便于对比联调。
 *  5. 图片统一复用 /assets/images/placeholders/product-placeholder.svg 占位图（main_image 与
 *     product_image 各一份），不依赖任何新增图片文件。
 *  6. 注意：重跑本脚本会把这 400 条假商品连同上面对它们的评论 / 收藏 / 购物车一起删掉重建
 *     （外键 ON DELETE CASCADE），历史订单明细的商品关联会被解绑（product_id 置 NULL，
 *     但商品名 / SKU / 单价快照都完整保留）。所以如果先跑过 seed:dev，重跑本脚本之后
 *     请再执行一次 npm run seed:dev 把评论补回来。
 */
import '../config/env.js'
import { resolve } from 'node:path'
import db from '../config/db.js'

const raw = db.raw
// 开发时后端服务可能同时连着同一个库，留出等待写锁的时间
raw.pragma('busy_timeout = 10000')

// ---------------------------------------------------------------------------
// 标记与常量
// ---------------------------------------------------------------------------
const TARGET_PRODUCT_COUNT = 400
// 保留前缀：管理员的商品编号由「用户名哈希 → 3 位大写字母」生成（见 utils/productRules.js），
// 正常业务不会使用 ZZZ；配合 product.sku 的唯一索引，这里再对已存在的编号做一次避让。
const SEED_SKU_PREFIX = 'ZZZ'
const SEED_SKU_GLOB = 'ZZZ[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
const PRODUCT_PLACEHOLDER = '/assets/images/placeholders/product-placeholder.svg'
// 这两个历史脚本会把 product / category 整表清空后重建 40 条演示数据，
// 本脚本跑完必须把它们标记为已执行，否则下一次迁移会把 400 条商品清空。
const HISTORIC_DEMO_MIGRATIONS = ['006_seed_catalog.sql', '009_reseed_catalog.sql']

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
// mulberry32：固定种子的伪随机数，保证重复执行结果一致
function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
// 与 seed-dev-data.js 用不同的种子，避免两个脚本的随机序列相互关联
const random = createRandom(20260913)
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1))
const pickOne = (list) => list[randomInt(0, list.length - 1)]
function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
// 生成过去 days 天内的随机时间，格式与 SQLite CURRENT_TIMESTAMP 一致（UTC、'YYYY-MM-DD HH:MM:SS'）
const toSqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ')
const timeWithinDays = (days) => toSqlTime(new Date(Date.now() - Math.floor(random() * days * 86400000)))
const money = (value) => Math.round(value * 100) / 100

// ---------------------------------------------------------------------------
// 假数据素材：按分类给出商品名构件、品牌、价格区间与文案
//
// 命名规则：prefixes（款式/风格词，刻意不含材质）+ nouns 里的品类词，
// 这样任意组合都不会出现「藤编玻璃水杯」这类材质打架的名字；
// 品类词也刻意保留了戒指/茶杯/围巾等，好让 seed-dev-data.js 里
// PRODUCT_DETAILS_BY_KEYWORD 的关键词能命中，评论内容更贴合商品。
// 计量单位跟着品类词走（nouns 的第二个元素），不会出现「书架 / 枚」这类搭配。
// ---------------------------------------------------------------------------
const CATALOG_STYLES = {
  珠宝首饰: {
    weight: 68,
    priceRange: [98, 458],
    brands: ['月光银饰', '花屿首饰', '绳结工坊', '彩釉小作', '旧物新作', '云间银作'],
    prefixes: ['复古', '极简', '哑光', '做旧', '描金', '浮雕', '星野', '苔纹', '轻奢', '微镶', '复古宫廷', '几何'],
    // [品类词, 计量单位]：单位跟着品类走，避免出现「书架 / 枚」这类不合理的搭配
    nouns: [
      ['银戒指', '枚'], ['黄铜耳环', '对'], ['银质耳坠', '对'], ['银链项链', '条'], ['绳结手链', '条'],
      ['珐琅胸针', '枚'], ['黄铜胸针', '枚'], ['珍珠项链', '条'], ['天然石手镯', '只'], ['绞丝银戒指', '枚'],
    ],
    sellingPoints: ['保留金属自然的温度和光泽', '配色耐看，通勤和正式场合都撑得住', '手作痕迹让每一件都略有不同', '轻巧不压手，长时间佩戴也舒服'],
    detailLines: ['每一件都单独打磨抛光，锤纹与纹路略有差异属正常现象', '银饰久戴发乌后用擦银布轻擦即可恢复光泽', '接口与链扣都做过加固，日常佩戴不易松脱'],
  },
  家居装饰: {
    weight: 64,
    priceRange: [88, 628],
    brands: ['雾野香氛', '旧物新作', '光的玻璃房', '织物小屋', '白栀花婚礼'],
    prefixes: ['复古', '北欧', '日式', '做旧', '素白', '暖调', '极简', '雾面', '自然系', '小户型', '一套', '哑光'],
    nouns: [
      ['香薰蜡烛', '盒'], ['黄铜烛台', '个'], ['黄铜台灯', '盏'], ['藤编收纳篮', '个'], ['手工皂礼盒', '盒'],
      ['棉麻桌布', '条'], ['干花永生花束', '束'], ['玻璃水杯', '只'], ['粗陶花盆', '个'], ['实木相框', '个'],
    ],
    sellingPoints: ['点亮一个舒缓的夜晚，也适合当日常餐桌的点缀', '材质天然，摆在家里不显刻意', '配色低调耐看，好搭现有家具', '打理起来省事，日常擦一擦就干净'],
    detailLines: ['手工制作，尺寸与色泽略有差异属正常现象', '包装内附养护说明，长期使用也不易变形', '天然材质请避免长时间阳光直射与浸泡'],
  },
  陶瓷器皿: {
    weight: 58,
    priceRange: [88, 488],
    brands: ['陶语工作室', '泥间窑', '拾光陶社', '青屿窑'],
    prefixes: ['手作', '复古', '日式', '素白', '哑光', '写意', '极简', '描边', '轻量', '暖白', '原色', '质朴'],
    nouns: [
      ['陶瓷花瓶', '个'], ['陶瓷咖啡杯', '只'], ['柴烧茶壶', '把'], ['青瓷茶杯套装', '套'], ['粗陶花盆', '个'],
      ['窑变釉碗', '只'], ['手绘青花盘', '只'], ['冰裂纹茶杯', '只'], ['陶土茶壶', '把'], ['釉下彩碗', '只'],
    ],
    sellingPoints: ['釉色温润，日常使用也经得起看', '手拉坯成形，每一只的釉色流动都不一样', '装热饮不烫手，厚薄均匀', '好清洗，冲一下就干净'],
    detailLines: ['均为手工成形与上釉，釉色深浅、开片位置不同属正常现象', '可用洗碗机清洗，但建议避免骤冷骤热', '若出现细小开片是釉面自然现象，不影响使用'],
  },
  木工作品: {
    weight: 56,
    priceRange: [78, 598],
    brands: ['山木作', '木言工坊', '年轮手作', '一木一作'],
    prefixes: ['复古', '原木', '做旧', '日式', '极简', '白蜡木', '胡桃木', '榉木', '一整块', '加厚', '便携', '手作'],
    nouns: [
      ['首饰盒', '个'], ['小鸟摆件', '件'], ['相框', '个'], ['书架', '个'], ['砧板', '块'],
      ['书签', '枚'], ['托盘', '个'], ['手机支架', '个'], ['木勺', '把'], ['木盘', '只'],
    ],
    sellingPoints: ['木纹顺直，边角都打磨过没有毛刺', '上的是木蜡油，闻着就是木头本身的味道', '用料扎实，拿在手里就知道不是贴皮的', '榫卯与接缝处理得干净，晃动没有异响'],
    detailLines: ['天然木结疤与纹理深浅不同属正常现象，反而更有味道', '日常用干布擦拭即可，避免长时间浸泡与暴晒', '表面为木蜡油保养，定期补油可以延长使用寿命'],
  },
  礼品手作: {
    weight: 54,
    priceRange: [98, 628],
    brands: ['小熊缝纫社', '远山画室', '针线花园', '白栀花婚礼', '拾光手作'],
    prefixes: ['复古', '手作', '限定', '日式', '极简', '暖色', '自然系', '小确幸', '礼盒装', '治愈系', '原色', '森系'],
    nouns: [
      ['棉布布偶', '只'], ['手绘装饰画', '幅'], ['植物刺绣摆件', '件'], ['婚礼装饰套装', '套'], ['干花相框', '个'],
      ['手工皂花束', '束'], ['棉线挂饰', '串'], ['木质礼品盒', '个'], ['手作胸针', '枚'], ['刺绣书签', '枚'],
    ],
    sellingPoints: ['包装本身就是礼物感，不用另外买礼盒', '手工痕迹明显但不粗糙', '附了手写小卡片，送人时细节很加分', '配色比图片更耐看'],
    detailLines: ['均为手工制作，细节略有差异属正常现象', '随附手写卡片与包装袋，可直接送人', '如需定制配色或尺寸，可在下单备注里说明'],
  },
  皮具手作: {
    weight: 50,
    priceRange: [128, 598],
    brands: ['皮匠慢作', '牛皮日记', '针线皮具', '匠行皮作'],
    prefixes: ['植鞣', '复古', '极简', '做旧', '商务', '窄版', '加厚', '原色', '日式', '复古棕', '轻便', '横款'],
    nouns: [
      ['牛皮钱包', '个'], ['手缝卡包', '个'], ['皮绳钥匙扣', '个'], ['皮质笔袋', '个'],
      ['真皮腰带', '条'], ['牛皮护照夹', '个'], ['皮质零钱包', '个'], ['皮质笔记本套', '个'],
    ],
    sellingPoints: ['植鞣牛皮手工缝制，越使用越有自己的故事', '走线整齐，边缘都做过打磨封边', '五金件分量足，开合很顺', '容量比看着大，日常随身够用'],
    detailLines: ['植鞣牛皮会随使用氧化变深，颜色变化属正常现象', '真皮请避免长时间浸水与暴晒，沾湿后自然阴干即可', '手工缝线针脚略有差异属正常现象'],
  },
  纺织编织: {
    weight: 50,
    priceRange: [98, 498],
    brands: ['云朵织造', '织物小屋', '棉线工坊', '手织日记'],
    prefixes: ['手织', '复古', '北欧', '日式', '粗线', '原色', '素色', '加厚', '纯棉', '极简', '森系', '手工'],
    nouns: [
      ['羊毛围巾', '条'], ['棉线壁挂', '幅'], ['收纳篮', '个'], ['杯垫', '块'],
      ['棉麻围裙', '件'], ['编织桌旗', '条'], ['羊毛毡挂饰', '串'], ['编织手提包', '个'],
    ],
    sellingPoints: ['编得很密实，没有松垮的地方', '手感和详情页描述的比较接近', '颜色温柔，很好搭', '比同价位的更厚实一些'],
    detailLines: ['手工编织，尺寸与针脚略有差异属正常现象', '建议手洗后平铺阴干，避免机洗与拧干', '天然纤维初期可能轻微掉毛，属正常现象'],
  },
}
// 兜底模板：管理员若新增了上面没覆盖到的分类，用这套通用构件生成，保证脚本不中断
const DEFAULT_STYLE = {
  weight: 40,
  priceRange: [88, 398],
  brands: ['手作小集'],
  prefixes: ['复古', '手作', '极简', '日式', '原色', '限定', '自然系', '质朴', '轻量', '暖调', '素色', '小批量'],
  nouns: [
    ['手作摆件', '件'], ['礼品套装', '套'], ['装饰挂件', '个'], ['收纳容器', '个'], ['日常小物', '件'],
    ['手作礼盒', '盒'], ['桌面摆件', '件'], ['居家小物', '件'], ['纪念摆件', '件'], ['礼赠组合', '套'],
  ],
  sellingPoints: ['选材自然，细节经得起日常使用', '手作痕迹让每一件都略有不同', '做工比同价位的量产品更扎实', '配色耐看，搭日常场景都不违和'],
  detailLines: ['由独立创作者手工制作，下单后 3–5 天内发出', '每一件都经过手工打磨与检查，细节略有差异属正常现象', '日常使用后擦拭干净即可，避免长时间浸泡'],
}
const GENERIC_SELLING_POINTS = ['随手用都合适，不挑场合', '细节处理得比预期细致', '小批量制作，补货周期较长', '包装简洁但很稳，适合送礼']
const GENERIC_DETAIL_LINES = ['手工制作周期为 3–5 天，急单可先联系客服确认', '实物颜色会因拍摄光线略有差异', '如收到后有疑问，可在订单里直接联系创作者']

// 售价尾数规则：先取「…8」的档位再按比例换成「…9」，贴近现有 demo 商品的定价风格（269 / 128 / 89 …）
const PRICE_STEPS = Array.from({ length: 78 }, (_, index) => 58 + index * 10)
const ORIGINAL_PRICE_RATIOS = [1.15, 1.18, 1.2, 1.22, 1.25]

// ---------------------------------------------------------------------------
// 素材装配
// ---------------------------------------------------------------------------
function styleOf(categoryName) {
  return CATALOG_STYLES[categoryName] || DEFAULT_STYLE
}

// 按 weight 把 TARGET_PRODUCT_COUNT 分摊到各分类：先取整，再把余数按小数部分从大到小补齐
function distributeCounts(categories, total) {
  const weightSum = categories.reduce((sum, item) => sum + styleOf(item.name).weight, 0)
  const exact = categories.map(item => total * styleOf(item.name).weight / weightSum)
  const counts = exact.map(value => Math.floor(value))
  let remainder = total - counts.reduce((sum, value) => sum + value, 0)
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const { index } of byFraction) {
    if (remainder <= 0) break
    counts[index]++
    remainder--
  }
  return counts
}

// 生成 count 个不重复的商品名：先铺满 prefix × 品类词 的组合再打散，
// 已存在的商品名（含 40 条历史演示商品）自动跳过；返回值里带上该品类对应的计量单位
function buildProductNames(style, count, categoryName, usedNames) {
  const combos = []
  for (const [noun, unit] of style.nouns) {
    for (const prefix of style.prefixes) combos.push({ name: `${prefix}${noun}`, unit })
  }
  const picked = []
  for (const combo of shuffle(combos)) {
    if (picked.length >= count) break
    if (usedNames.has(combo.name)) continue
    usedNames.add(combo.name)
    picked.push(combo)
  }
  if (picked.length < count) {
    throw new Error(`分类「${categoryName}」只能拼出 ${picked.length} 个不重复的商品名，少于需要的 ${count} 个，请补充 CATALOG_STYLES 的 prefixes / nouns`)
  }
  return picked
}

function buildPrice(range) {
  const [min, max] = range
  const step = pickOne(PRICE_STEPS.filter(value => value >= min && value <= max))
  return step + (random() < 0.25 ? 1 : 0)
}

// 原价：按 1.15~1.25 倍上浮后取「…9」结尾，保证严格大于售价（前台据此显示「特惠」角标）
function buildOriginalPrice(price) {
  return Math.round(price * pickOne(ORIGINAL_PRICE_RATIOS) / 10) * 10 + 9
}

// 商品编号：SEED_SKU_PREFIX + 7 位数字；与库里已有编号冲突时顺延，避开 product.sku 唯一索引
function buildSkuPool(count, existingSkus) {
  const skus = []
  let sequence = 1000000
  while (skus.length < count) {
    const sku = `${SEED_SKU_PREFIX}${String(sequence).padStart(7, '0')}`
    sequence++
    if (existingSkus.has(sku)) continue
    existingSkus.add(sku)
    skus.push(sku)
  }
  return skus
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const summary = { removed: 0, created: 0, byCategory: [], markedMigrations: [] }

// 检查迁移是否已执行（否则下面的插入会因为缺表/缺字段报错，这里给出明确提示）
function assertSchema() {
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name)
  const missing = ['category', 'product', 'product_image'].filter(table => !tables.includes(table))
  if (missing.length) {
    throw new Error(`缺少 ${missing.join('、')} 表，请先执行 npm run db:migrate（或启动一次后端服务）再运行本脚本`)
  }
}

// 清理上一轮由本脚本生成的数据：单条 SQL 按 SKU 前缀删除，
// product_image / product_review / customer_favorite / cart_item 由外键 ON DELETE CASCADE 一并清理，
// order_item.product_id 由 ON DELETE SET NULL 解绑（商品名/SKU/单价已快照在明细里，历史订单不受影响）
function cleanup() {
  summary.removed = raw.prepare(`DELETE FROM product WHERE sku GLOB ?`).run(SEED_SKU_GLOB).changes
}

// 把 006/009 这类「整表清空重建」的历史演示脚本记为已执行，
// 避免后续 npm run db:migrate 重跑它们把本脚本写入的 400 条商品清空
function markHistoricDemoMigrations() {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  const mark = raw.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)')
  for (const filename of HISTORIC_DEMO_MIGRATIONS) {
    if (mark.run(filename).changes) summary.markedMigrations.push(filename)
  }
}

function createProducts(categories) {
  // updated_at 显式写入：与 created_at 一致，表示商品创建后未被修改过
  const insertProduct = raw.prepare(`INSERT INTO product
    (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, main_image, status, sku, is_customizable, rating, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
  const insertImage = raw.prepare('INSERT INTO product_image (product_id, image_url, is_main, sort_order) VALUES (?, ?, 1, 0)')

  // 已存在的商品名与 SKU 都要避让：前者避免和演示商品重名，后者避开 sku 唯一索引
  const usedNames = new Set(raw.prepare('SELECT name FROM product').all().map(row => row.name))
  const existingSkus = new Set(raw.prepare('SELECT sku FROM product WHERE sku IS NOT NULL').all().map(row => row.sku))

  const counts = distributeCounts(categories, TARGET_PRODUCT_COUNT)
  const distributions = categories.map((category, index) => {
    const style = styleOf(category.name)
    const count = counts[index]
    return { category, style, count, names: buildProductNames(style, count, category.name, usedNames) }
  })
  const skus = buildSkuPool(distributions.reduce((sum, item) => sum + item.count, 0), existingSkus)

  let skuCursor = 0
  for (const { category, style, count, names } of distributions) {
    for (const { name, unit } of names) {
      const price = buildPrice(style.priceRange)
      const brand = pickOne(style.brands)
      const sellingPoint = pickOne([...style.sellingPoints, ...GENERIC_SELLING_POINTS])
      const detailLine = pickOne([...style.detailLines, ...GENERIC_DETAIL_LINES])
      const createdAt = timeWithinDays(180)
      const productId = Number(insertProduct.run(
        name, category.id, price, buildOriginalPrice(price), randomInt(8, 120), randomInt(0, 240),
        unit, brand, brand,
        `手工${name}，${sellingPoint}。`,
        `<p>${name}，${detailLine}。</p>`,
        PRODUCT_PLACEHOLDER, skus[skuCursor++],
        random() < 0.35 ? 1 : 0,
        money(4.5 + randomInt(0, 5) / 10),
        createdAt, createdAt
      ).lastInsertRowid)
      insertImage.run(productId, PRODUCT_PLACEHOLDER)
      summary.created++
    }
    summary.byCategory.push(`${category.name} ${count}`)
  }
}

assertSchema()
const categories = raw.prepare('SELECT id, name FROM category WHERE status = 1 AND parent_id = 0 ORDER BY sort_order, id').all()
if (!categories.length) throw new Error('category 表里没有启用的顶级分类，请先执行 npm run db:migrate 准备分类数据')

// 全部写操作放进一个事务：要么全成功，要么全回滚，避免留下半套假数据
const seed = raw.transaction(() => {
  cleanup()
  createProducts(categories)
  markHistoricDemoMigrations()
})
seed()

// ---------------------------------------------------------------------------
// 汇总日志
// ---------------------------------------------------------------------------
const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const keptProducts = raw.prepare('SELECT COUNT(*) AS c FROM product').get().c
console.log(`[seed:products] 数据库：${dbPath}`)
console.log(`[seed:products] 清理上一轮假商品：${summary.removed} 条（按 SKU 前缀 ${SEED_SKU_PREFIX} 精确匹配）`)
console.log(`[seed:products] 新增假商品：${summary.created} 条，分类分布：${summary.byCategory.join(' / ')}`)
console.log(`[seed:products] 商品编号统一为 ${SEED_SKU_PREFIX} + 7 位数字，图片统一使用 ${PRODUCT_PLACEHOLDER}`)
console.log(`[seed:products] 标记历史演示脚本为已执行：${summary.markedMigrations.length ? summary.markedMigrations.join('、') : '（本次无需标记，早已记录）'}`)
console.log(`[seed:products] 当前商品总数：${keptProducts} 条（其中 ${keptProducts - summary.created} 条为脚本之外的数据，已原样保留）`)
console.log('[seed:products] 提示：本脚本可重复执行；请勿删除 schema_migrations 表，否则 006/009 可能在下次迁移时重跑并清空商品目录')
console.log('[seed:products] 提示：重跑会连带删除这些商品的评论/收藏/购物车（订单明细只解绑商品关联、快照仍保留），若已跑过 seed:dev 请再跑一次补回评论')
console.log('[seed:products] 完成')

await db.end()
