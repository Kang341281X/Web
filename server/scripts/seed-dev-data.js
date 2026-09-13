/**
 * 开发联调假数据填充脚本（可重复执行）
 *
 * 用法：npm run seed:dev
 * 前置：先执行 npm run db:migrate（或启动过一次后端，server/index.js 会自动迁移），
 *       确保 product_review 表与 product.review_count 字段存在。
 *       推荐顺序：npm run db:migrate → npm run seed:products → npm run seed:dev
 *
 * 数据量（都集中在下方常量里，按需调整）：
 *   - 顾客 100 位（CUSTOMER_COUNT）
 *   - 订单 500 条（ORDER_TARGET_COUNT），按 pending 20% / confirmed 20% / shipped 20% /
 *     completed 30% / cancelled 10% 分布，摊到 100 位顾客后人均恰好 5 单
 *   - 评论 1000 条（REVIEW_TARGET_COUNT），在全部上架商品之间长尾分布
 *     （多数商品 1~3 条，少数热门商品 8 条以上）
 *
 * 设计要点：
 *  1. 幂等：脚本生成的数据全部带可识别标记，每次执行先按标记清理上一轮假数据再重建，
 *     重复执行不会重复插入，也不会误删真实数据。标记如下：
 *       - customer.phone          13800000001 ~ 13800000100
 *       - customer.email          seed_XXX@example.com
 *       - customer.nickname       测试用户XXX
 *       - customer_order.order_no 以 SD 开头（真实下单为 CO 开头）
 *       - product_review.customer_name 以「测试用户」开头（昵称快照，账号被删也认得出）
 *  2. 不扣库存：补的是历史订单，其库存扣减视为早已完成，不再回扣 product.stock，
 *     避免把当前库存拉成负数、或与真实库存对不上。
 *  3. 可复现：使用固定种子的伪随机数，同一个库重复执行得到同一批假数据，便于对比联调。
 *  4. 总量可控：订单 / 评论都按「固定目标值 + 精确配平」生成，不再跟着顾客数、商品数浮动；
 *     订单数的顾客分配、评论数的商品分配都用「先按权重取整、再逐条 ±1 配平」的方式，
 *     保证实际生成数量与目标值严格一致。
 */
import '../config/env.js'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import db from '../config/db.js'

const raw = db.raw
// 开发时后端服务可能同时连着同一个库，留出等待写锁的时间
raw.pragma('busy_timeout = 10000')

// ---------------------------------------------------------------------------
// 标记与常量
// ---------------------------------------------------------------------------
const CUSTOMER_COUNT = 100
const SEED_PASSWORD = '123456'
const SEED_PHONE_PREFIX = '13800000'
const SEED_EMAIL_PREFIX = 'seed_'
const SEED_NICKNAME_PREFIX = '测试用户'
const SEED_USERNAME_PREFIX = 'seeduser'
const SEED_ORDER_PREFIX = 'SD'

// 订单总量固定为 500 条，不再跟着「顾客数 × 随机(2~5)」浮动
const ORDER_TARGET_COUNT = 500
// 单个顾客的订单条数区间：活跃度权重分摊后夹在这个范围内。
// 100 位顾客 / 500 条订单 => 人均恰好 5 单，重度用户会到 10 单上下，轻度用户被夹到 2 单。
const ORDER_MIN_PER_CUSTOMER = 2
const ORDER_MAX_PER_CUSTOMER = 12

// 评论总量固定为 1000 条，不再跟着「商品数 × 7」浮动
const REVIEW_TARGET_COUNT = 1000
// 单个商品的评论条数区间与长尾权重：[条数, 权重]，条数越少越常见
const REVIEW_MIN_PER_PRODUCT = 1
const REVIEW_MAX_PER_PRODUCT = 12
const REVIEW_COUNT_WEIGHTS = [[1, 26], [2, 24], [3, 18], [4, 12], [5, 8], [6, 5], [7, 3], [8, 2], [9, 1], [10, 1]]

const seedPhones = Array.from({ length: CUSTOMER_COUNT }, (_, index) => `${SEED_PHONE_PREFIX}${String(index + 1).padStart(3, '0')}`)
// 序号统一补到 3 位（seed_001 / 测试用户001 / seeduser001），避免 100 个账号出现「01 和 100 混排」的宽度不一致
const seedEmail = (index) => `${SEED_EMAIL_PREFIX}${String(index + 1).padStart(3, '0')}@example.com`
const seedNickname = (index) => `${SEED_NICKNAME_PREFIX}${String(index + 1).padStart(3, '0')}`
const seedUsername = (index) => `${SEED_USERNAME_PREFIX}${String(index + 1).padStart(3, '0')}`

// 订单状态目标分布：pending 20% / confirmed 20% / shipped 20% / completed 30% / cancelled 10%
const ORDER_STATUS_RATIOS = [
  ['pending', 0.2],
  ['confirmed', 0.2],
  ['shipped', 0.2],
  ['completed', 0.3],
  ['cancelled', 0.1],
]
// 评分分布沿用原来的 [5,5,5,5,4,4,3]（约 57% 5 星 / 29% 4 星 / 14% 3 星）：
// 现在按每个商品的实际评论条数循环取值再打散，不再假设「每个商品固定 7 条」
const RATING_TEMPLATE = [5, 5, 5, 5, 4, 4, 3]

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
const random = createRandom(20260912)
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
// 不重复抽样（数量超过长度时返回全部）
const sample = (list, size) => shuffle(list).slice(0, size)
// 生成过去 days 天内的随机时间，格式与 SQLite CURRENT_TIMESTAMP 一致（UTC、'YYYY-MM-DD HH:MM:SS'）
const toSqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ')
function timeWithinDays(days) {
  return toSqlTime(new Date(Date.now() - Math.floor(random() * days * 86400000)))
}
// 订单之后 days 天内的时间（评论不能早于下单），并保证不晚于当前时间
function timeAfter(orderTime, maxDays) {
  const base = new Date(`${orderTime.replace(' ', 'T')}Z`).getTime() + Math.floor(random() * maxDays * 86400000) + 3600000
  return toSqlTime(new Date(Math.min(base, Date.now())))
}
const money = (value) => Math.round(value * 100) / 100
const inClause = (ids) => (ids.length ? ids.map(() => '?').join(', ') : 'NULL') // IN (NULL) 不匹配任何行
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
// 按 [[取值, 权重], ...] 加权抽一个取值
function pickWeighted(weights) {
  const weightSum = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let hit = random() * weightSum
  for (const [value, weight] of weights) {
    hit -= weight
    if (hit <= 0) return value
  }
  return weights[weights.length - 1][0]
}
// 从素材池里取 count 条：池子够长时天然不重复，不够长时循环复用，避免取到 undefined
function fillFrom(pool, count) {
  return Array.from({ length: count }, (_, index) => pool[index % pool.length])
}
// 按权重取整后总数会和目标值有偏差：按随机顺序逐条 ±1 挪动，直到严格等于目标值
function balanceToTarget(counts, target, min, max, label) {
  let diff = target - counts.reduce((sum, value) => sum + value, 0)
  while (diff !== 0) {
    const step = diff > 0 ? 1 : -1
    const movable = counts
      .map((count, index) => ({ count, index }))
      .filter(item => (step > 0 ? item.count < max : item.count > min))
      .map(item => item.index)
    if (!movable.length) {
      throw new Error(`${label}无法配平到目标值 ${target}：所有取值都触到了 ${min}~${max} 的边界，请调整区间或目标值`)
    }
    counts[pickOne(movable)] += step
    diff -= step
  }
  return counts
}

// ---------------------------------------------------------------------------
// 假数据素材：地址
// ---------------------------------------------------------------------------
const ADDRESS_REGIONS = [
  { province: '广东省', city: '深圳市', district: '南山区', streets: ['科技园南路 128 号', '海岸城购物中心 3 层', '南山大道 1088 号'] },
  { province: '广东省', city: '广州市', district: '天河区', streets: ['珠江新城花城大道 88 号', '天河北路 233 号', '体育西路 103 号'] },
  { province: '浙江省', city: '杭州市', district: '西湖区', streets: ['文三路 200 号', '古墩路 98 号', '文一西路 100 号'] },
  { province: '江苏省', city: '南京市', district: '鼓楼区', streets: ['中山北路 105 号', '广州路 12 号', '中央路 302 号'] },
  { province: '上海市', city: '上海市', district: '浦东新区', streets: ['张杨路 500 号', '世纪大道 1000 号', '东方路 738 号'] },
  { province: '四川省', city: '成都市', district: '武侯区', streets: ['天府大道北段 1480 号', '科华北路 62 号', '人民南路四段 15 号'] },
  { province: '北京市', city: '北京市', district: '朝阳区', streets: ['建国路 87 号', '望京街 10 号', '东三环中路 39 号'] },
  { province: '湖北省', city: '武汉市', district: '洪山区', streets: ['珞喻路 1037 号', '光谷大道 77 号', '雄楚大道 568 号'] },
  { province: '福建省', city: '厦门市', district: '思明区', streets: ['软件园二期观日路 24 号', '湖滨南路 66 号'] },
  { province: '陕西省', city: '西安市', district: '雁塔区', streets: ['高新路 25 号', '小寨东路 168 号'] },
  { province: '山东省', city: '青岛市', district: '市南区', streets: ['香港中路 61 号', '南京路 122 号'] },
  { province: '辽宁省', city: '沈阳市', district: '和平区', streets: ['南京南街 211 号', '青年大街 386 号'] },
]
const RECEIVER_FAMILY_NAMES = ['张', '李', '王', '陈', '刘', '杨', '赵', '周', '吴', '徐', '孙', '马', '郑', '黄']
const RECEIVER_GIVEN_NAMES = ['小明', '小雅', '子涵', '一诺', '雨桐', '浩然', '思远', '嘉怡', '思彤', '梓萱', '明轩', '若曦']

function buildAddress(index) {
  const region = ADDRESS_REGIONS[index % ADDRESS_REGIONS.length]
  const street = pickOne(region.streets)
  return {
    province: region.province,
    city: region.city,
    district: region.district,
    detailAddress: `${street} ${randomInt(1, 20)} 栋 ${randomInt(101, 2608)} 室`,
  }
}
// 与前端 src/utils/address.js 的 formatAddress 保持一致：省 市 区 详细地址
const formatAddress = (address) => [address.province, address.city, address.district, address.detailAddress].filter(Boolean).join(' ')

// ---------------------------------------------------------------------------
// 假数据素材：评论文案（按分类给出具体的观察点，避免千篇一律的「很好，满意」）
// ---------------------------------------------------------------------------
// 分类级观察点：只写这一品类通用的感受，句子不能和 PRODUCT_DETAILS_BY_KEYWORD 重复
// （同一个商品会把两类短语合在一起抽 7 条，出现重复句就说明池子有交集）
const CATEGORY_DETAILS = {
  珠宝首饰: [
    '戴了一周多，皮肤没有发红发痒',
    '包装盒有绒布内衬，收起来不怕刮花',
    '和详情页标注的尺寸一致，没有偏差',
    '配色很耐看，搭日常衣服都能配',
    '当礼物送人挺合适，包装也体面',
  ],
  家居装饰: [
    '摆在原来的位置很搭，家里一下有了氛围感',
    '尺寸和想象中差不多，不占地方',
    '和家里原木色的家具很配',
    '打理起来方便，擦一下就干净',
    '朋友来家里看到都问在哪买的',
  ],
  陶瓷器皿: [
    '表面没有磕碰和针孔，品相比想象中好',
    '装热的东西不烫手，日常用着放心',
    '手作痕迹很明显，比量产的耐看',
    '好清洗，冲一下就干净',
    '每一只的釉色深浅都略有差别，手作里算正常',
  ],
  木工作品: [
    '打磨得很到位，摸上去没有毛刺',
    '凑近闻有一股淡淡的木头味',
    '和家里的原木家具很搭',
    '用料扎实，拿在手里就知道不是贴皮的',
    '用了一段时间很稳定，没有变形',
  ],
  礼品手作: [
    '包装本身就是礼物感，不用另外买礼盒',
    '手工痕迹明显但不粗糙',
    '配色比图片更耐看',
    '附了手写小卡片，细节很加分',
    '尺寸小巧，当伴手礼刚好',
  ],
  皮具手作: [
    '走线很整齐，看得出是手工做的',
    '皮质偏硬挺，用久了应该会更有味道',
    '五金件分量足，开合很顺',
    '有淡淡的皮味，不刺鼻',
    '内衬做得很规整，不会蹭脏东西',
  ],
  纺织编织: [
    '编得很密实，没有松垮的地方',
    '手感和详情页描述的比较接近',
    '颜色很温柔，很好搭',
    '收边很干净，没有多余的线头',
    '比同价位的厚实一些',
  ],
}
// 通用优点：只写「东西本身」的感受，不提物流/外箱，避免和 SHIPPING_NOTES、MINOR_COMPLAINTS 撞车
// 按商品名关键词给出更贴合的观察点（数组顺序即匹配优先级：
// 例如「编织绳结手链」要命中「手链」而不是「编织」，「植物刺绣摆件」要命中「刺绣」而不是「木作」）。
// 命中的短语会优先用于该商品的评论，剩下的位置再用分类/通用短语补足。
const PRODUCT_DETAILS_BY_KEYWORD = [
  { keywords: ['戒指'], details: [
    '戒圈内侧打磨得很光滑，戴一整天也不勒手',
    '尺寸按客服建议选的，戴着正合适',
    '表面的纹理比图片上更有层次',
    '洗手沾了水擦干后也没有发乌',
  ] },
  { keywords: ['耳环', '耳坠'], details: [
    '耳钩很轻，戴一整天耳朵不酸',
    '耳钩做过防过敏处理，戴了几天没有发痒',
    '垂坠感和图片一致，戴出去被问过链接',
    '耳钩扣合很紧，不用担心走着走着掉了',
  ] },
  { keywords: ['项链'], details: [
    '链长刚好落在锁骨位置，配圆领很好看',
    '吊坠有分量，正反面都一样精致',
    '链扣做工扎实，扣上不容易松',
    '珠子的成色比图片还通透一点',
  ] },
  { keywords: ['手链'], details: [
    '长度可以自己调节，手腕细也能戴',
    '绳子编得很紧实，洗手沾水也没散开',
    '戴了两周没有起毛边',
  ] },
  { keywords: ['胸针'], details: [
    '别针很利落，扎在针织衫上也不勾丝',
    '上色很均匀，不是那种廉价的塑料感',
    '尺寸小巧，配大衣领口刚好',
  ] },
  { keywords: ['蜡烛', '香薰'], details: [
    '雪松香气不冲，烧起来是暖暖的木质调',
    '燃烧时没有黑烟，烛芯也不用频繁修剪',
    '烧了十几个小时还剩大半，很经用',
  ] },
  { keywords: ['烛台'], details: [
    '插上蜡烛很稳，不会晃',
    '黄铜的做旧感很好看，摆在餐桌上很有仪式感',
    '底座配了防滑垫，不会刮花桌面',
  ] },
  { keywords: ['台灯', '灯'], details: [
    '暖光很柔和，晚上看书不刺眼',
    '黄铜灯身带自然的旧感，越看越喜欢',
    '开关手感扎实，电线也够长',
    '底座很稳，家里有猫也没被碰倒过',
  ] },
  { keywords: ['花盆', '花瓶'], details: [
    '盆底带排水孔，透气不积水',
    '盆口粗陶的颗粒感很明显，很像手作',
    '盆壁厚度均匀，装土后很结实',
    '摆在阳台和绿植很配，显得很干净',
  ] },
  { keywords: ['杯', '茶壶', '壶'], details: [
    '杯口修得很圆润，喝水不刮嘴',
    '装热水不烫手，厚薄也很均匀',
    '釉色有自然的流动感，每只都不一样',
    '洗过几次没有挂茶渍，好清洗',
  ] },
  { keywords: ['碗', '盘'], details: [
    '釉色流动很自然，每只都不一样',
    '碗口圆润，边缘没有磕手的地方',
    '微波炉和洗碗机都试过，没有开裂',
    '装上菜很好看，日常用也不违和',
  ] },
  { keywords: ['收纳篮', '收纳'], details: [
    '藤条编得很密，放小东西不会漏下去',
    '装毛巾和零食刚好，摆在架子上也好看',
    '提手不硌手，收口处编得很干净',
  ] },
  { keywords: ['皂', '花束', '干花'], details: [
    '五种味道区分得很清楚，泡沫细腻不假滑',
    '花材保存得很好，到手没有掉瓣',
    '送人时对方很喜欢，包装很体面',
  ] },
  { keywords: ['首饰盒', '相框', '书架', '砧板', '书签', '托盘', '支架', '摆件', '木'], details: [
    '木纹顺直，边角都打磨过没有毛刺',
    '上的是木蜡油，闻着就是木头本身的味道',
    '接缝处严丝合缝，晃动没有异响',
    '用了两周没有开裂变形',
    '天然木结疤保留着，反而更有味道',
  ] },
  { keywords: ['围巾'], details: [
    '羊毛很柔软，围在脖子上不扎',
    '针脚细密，边缘收得很干净',
    '颜色很温柔，配深色大衣好看',
    '洗过一次没有缩水也没有起球',
  ] },
  { keywords: ['桌布'], details: [
    '铺上去很平整，桌角垂下来也好看',
    '棉麻手感偏挺括，铺上去很有质感',
    '洗过一次没有褪色也没有缩水',
    '油渍擦一下就掉，好打理',
  ] },
  { keywords: ['壁挂', '编织'], details: [
    '编得很密，挂上去很有层次',
    '摸着柔软不掉毛',
    '边缘收得很干净，没有多余的线头',
    '比同价位的手感更厚实',
  ] },
  { keywords: ['钱包', '包'], details: [
    '缝线很整齐，针脚均匀没有跳线',
    '皮质刚开始偏硬，用了一周就软下来了',
    '边油收得干净，没有毛边',
    '容量比看着大，卡片和零钱都能放',
  ] },
  { keywords: ['布偶'], details: [
    '棉花填得很饱满，抱着很有安全感',
    '缝口收在背面，不明显也不硌手',
    '表情和图片一致，看着很治愈',
  ] },
  { keywords: ['装饰画', '刺绣', '婚礼'], details: [
    '配色比屏幕上看更耐看，不俗气',
    '装框后挂在墙上很有氛围',
    '针脚细密，凑近看也很精致',
  ] },
]
const getSpecificDetails = (name) => {
  const matched = PRODUCT_DETAILS_BY_KEYWORD.find(entry => entry.keywords.some(keyword => name.includes(keyword)))
  return matched ? [...matched.details] : []
}

const GENERIC_DETAILS = [
  '实物和详情页描述一致，没有色差',
  '做工比同价位的细致，凑近看也经得起',
  '客服回复很快，问的尺寸问题都答清楚了',
  '发货前客服还特意确认了一次收货地址，挺细心',
  '配件和说明都齐全，上手没难度',
  '有点小瑕疵但在可接受范围内',
  '重量尺寸标得很准，下单前不用猜',
  '细节图拍得实在，收到的和图片基本一致',
  '用了一周多，暂时没发现质量问题',
  '比之前在别家买的同款要耐用',
]
// 物流感受：只写速度与服务，不写外箱完好/破损，避免和「外包装压变形」这类吐槽自相矛盾
const SHIPPING_NOTES = [
  '下单第二天就发货了，物流三天到',
  '发的顺丰，隔天就收到',
  '物流信息更新很及时，中途没有长时间停滞',
  '发货速度一般，等了四天才出库',
  '快递放驿站自取的，取件码发得很及时',
  '拍下当天就出库了，配送很快',
  '物流比预期慢了两天，不过东西没问题',
  '跨省发货第五天收到，属于正常速度',
  '驿站短信通知很及时，取件方便',
  '快递员送上门，服务态度挺好',
  '赶上节假日物流慢一点，耐心等到了',
  '中途改过一次收货时间，客服配合得挺爽快',
]
const MINOR_COMPLAINTS = [
  '外包装盒在运输中有点压变形',
  '随附的说明比较简略',
  '价格如果再便宜一点就更好了',
  '细节处还能再打磨一下',
  '发货速度偏慢',
  '外盒没有塑封，送人前自己重新包了一下',
  '尺寸可选的范围有点少',
  '附赠的收纳袋做工比较一般',
]
// 3 星专用：中性偏平淡的描述，避免和「只能算中规中矩」的结论打架
const NEUTRAL_DETAILS = [
  '做工看着还行，谈不上惊艳',
  '功能上没毛病，只是质感比预期普通一些',
  '到手能用，细节比宣传图看着朴素一点',
  '整体和同价位的东西差别不大',
  '包装和配件都齐全，但惊喜感一般',
]
const FIVE_STAR_TEMPLATES = [
  ({ name, detail, shipping }) => `关注这家店挺久了，这次终于下单「${name}」。${detail}，${shipping}，整体比预期好。`,
  ({ category, detail, shipping }) => `${detail}。${shipping}。这个价位能买到这样的${category}算是很良心，已经推荐给同事了。`,
  ({ name, detail }) => `第二次回购了，上次买给家里人反馈不错，这次自己又入了「${name}」。${detail}，依旧满意。`,
  ({ name, detail, shipping }) => `「${name}」到手就和详情页对了一遍，${detail}。${shipping}，会继续关注店里的新品。`,
]
const FOUR_STAR_TEMPLATES = [
  ({ detail, shipping, minor }) => `东西本身没问题，${detail}，${shipping}。扣一星是因为${minor}，不影响使用。`,
  ({ name, detail, minor }) => `「${name}」整体符合预期，${detail}。就是${minor}，希望以后能改进。`,
]
// 3 星不引用物流感受：物流池里既有「发货很快」也有「发货偏慢」，一旦撞上吐槽项就会自相矛盾
const THREE_STAR_TEMPLATE = ({ detail, minor }) => `用了一周来补个评价：${detail}。不过${minor}，整体只能算中规中矩，先给中评。`

function buildReviewContent(template, product, fragments) {
  return template({ name: product.name, category: product.category_name, ...fragments })
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const summary = { removed: {}, created: {} }

// 检查迁移是否已执行（否则下面的插入会因为缺表/缺字段报错，这里给出明确提示）
function assertSchema() {
  const hasReviewTable = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_review'").get()
  const productColumns = raw.prepare('PRAGMA table_info(product)').all().map(column => column.name)
  const missing = []
  if (!hasReviewTable) missing.push('product_review 表')
  if (!productColumns.includes('review_count')) missing.push('product.review_count 字段')
  if (missing.length) {
    throw new Error(`缺少 ${missing.join('、')}，请先执行 npm run db:migrate（或启动一次后端服务）再运行本脚本`)
  }
}

// 清理上一轮由本脚本生成的数据（先子表后主表：评论 → 订单 → 购物车 → 收藏 → 地址 → 顾客）
function cleanup() {
  const seedCustomerIds = raw.prepare(`SELECT id FROM customer WHERE phone IN (${inClause(seedPhones)})`).all(...seedPhones).map(row => row.id)
  const seedOrderIds = raw.prepare(`SELECT id FROM customer_order WHERE order_no LIKE ?`).all(`${SEED_ORDER_PREFIX}%`).map(row => row.id)

  summary.removed.reviews = raw.prepare(
    `DELETE FROM product_review
      WHERE customer_name LIKE ?
         OR customer_id IN (${inClause(seedCustomerIds)})
         OR order_id IN (${inClause(seedOrderIds)})`
  ).run(`${SEED_NICKNAME_PREFIX}%`, ...seedCustomerIds, ...seedOrderIds).changes

  // order_item 由外键 ON DELETE CASCADE 一并清理
  summary.removed.orders = raw.prepare(
    `DELETE FROM customer_order WHERE order_no LIKE ? OR customer_id IN (${inClause(seedCustomerIds)})`
  ).run(`${SEED_ORDER_PREFIX}%`, ...seedCustomerIds).changes
  summary.removed.cartItems = raw.prepare(`DELETE FROM cart_item WHERE customer_id IN (${inClause(seedCustomerIds)})`).run(...seedCustomerIds).changes
  summary.removed.favorites = raw.prepare(`DELETE FROM customer_favorite WHERE customer_id IN (${inClause(seedCustomerIds)})`).run(...seedCustomerIds).changes
  summary.removed.addresses = raw.prepare(`DELETE FROM customer_address WHERE customer_id IN (${inClause(seedCustomerIds)})`).run(...seedCustomerIds).changes
  summary.removed.customers = raw.prepare(`DELETE FROM customer WHERE phone IN (${inClause(seedPhones)})`).run(...seedPhones).changes
}

function createCustomers(passwordHash) {
  const insert = raw.prepare('INSERT INTO customer (phone, username, email, password, nickname, avatar, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)')
  return seedPhones.map((phone, index) => {
    const createdAt = timeWithinDays(120)
    const info = insert.run(phone, seedUsername(index), seedEmail(index), passwordHash, seedNickname(index), createdAt, createdAt)
    return { id: Number(info.lastInsertRowid), phone, username: seedUsername(index), nickname: seedNickname(index), email: seedEmail(index) }
  })
}

function createAddresses(customers) {
  const insert = raw.prepare(`INSERT INTO customer_address (customer_id, receiver_name, receiver_phone, province, city, district, detail_address, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const addressesByCustomer = new Map()
  let total = 0
  customers.forEach((customer, index) => {
    const count = randomInt(1, 3)
    const defaultIndex = randomInt(0, count - 1) // 恰好一条默认地址
    const list = []
    for (let i = 0; i < count; i++) {
      const address = buildAddress(index * 3 + i)
      const receiverName = `${pickOne(RECEIVER_FAMILY_NAMES)}${pickOne(RECEIVER_GIVEN_NAMES)}`
      const createdAt = timeWithinDays(150)
      const info = insert.run(
        customer.id, receiverName, customer.phone, address.province, address.city, address.district,
        address.detailAddress, i === defaultIndex ? 1 : 0, createdAt, createdAt
      )
      list.push({ id: Number(info.lastInsertRowid), ...address, receiverName })
      total++
    }
    addressesByCustomer.set(customer.id, list)
  })
  summary.created.addresses = total
  return addressesByCustomer
}

function createFavorites(customers, products) {
  const insert = raw.prepare('INSERT INTO customer_favorite (customer_id, product_id, created_at) VALUES (?, ?, ?)')
  let total = 0
  for (const customer of customers) {
    for (const product of sample(products, randomInt(3, 8))) {
      insert.run(customer.id, product.id, timeWithinDays(90))
      total++
    }
  }
  summary.created.favorites = total
}

function createCartItems(customers, products) {
  const insert = raw.prepare('INSERT INTO cart_item (customer_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  const inStock = products.filter(product => product.stock > 0)
  let total = 0
  for (const customer of sample(customers, 5)) {
    for (const product of sample(inStock, randomInt(1, 4))) {
      // 数量不超过当前库存，避免后续联调下单时被库存校验拦下
      const quantity = Math.max(1, Math.min(randomInt(1, 3), product.stock))
      const createdAt = timeWithinDays(14)
      insert.run(customer.id, product.id, quantity, createdAt, createdAt)
      total++
    }
  }
  summary.created.cartItems = total
}

// 按目标比例生成订单状态池：前几种按比例取整（至少 1 条），最后一种取剩余数量，保证总量与订单数一致
function buildOrderStatusPlan(total) {
  const list = []
  let assigned = 0
  ORDER_STATUS_RATIOS.forEach(([status, ratio], index) => {
    const count = index === ORDER_STATUS_RATIOS.length - 1 ? total - assigned : Math.max(1, Math.round(total * ratio))
    assigned += count
    list.push(...Array(count).fill(status))
  })
  return list
}

// 每个顾客的订单条数：先给每人一个「活跃度」权重（取平方后长尾，少数重度用户明显偏高），
// 再按权重把 ORDER_TARGET_COUNT 摊到每个人头上，最后逐条配平让总数严格等于目标值。
// 这样 500 条订单不是平均撒胡椒面，人均恰好 5 单、重度用户 10 单上下、轻度用户被夹到 2 单。
function planOrderCounts(customers) {
  const weights = customers.map(() => (0.4 + random()) ** 2)
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const counts = weights.map(weight => clamp(
    Math.round(ORDER_TARGET_COUNT * weight / weightSum),
    ORDER_MIN_PER_CUSTOMER,
    ORDER_MAX_PER_CUSTOMER
  ))
  return balanceToTarget(counts, ORDER_TARGET_COUNT, ORDER_MIN_PER_CUSTOMER, ORDER_MAX_PER_CUSTOMER, '顾客订单数')
}

function createOrders(customers, products, addressesByCustomer) {
  const insertOrder = raw.prepare(`INSERT INTO customer_order
    (order_no, customer_id, customer_username, customer_email, receiver_name, receiver_phone, receiver_address, total_amount, status, remark, handled_by, handled_by_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertItem = raw.prepare('INSERT INTO order_item (order_id, product_id, product_name, product_sku, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const [admin] = raw.prepare('SELECT id, real_name FROM admin ORDER BY id LIMIT 1').all()
  const statusCount = {}
  const buyersByProduct = new Map()
  let sequence = 0
  let total = 0

  // 先按活跃度权重定每个顾客的订单条数，再把「按目标比例生成的订单状态池」打散后依次分配，
  // 这样 500 条订单能严格命中 5 种状态的比例，而不是纯随机抽样导致某一状态只有个位数。
  const orderCounts = planOrderCounts(customers)
  const plans = customers.map((customer, index) => ({ customer, count: orderCounts[index] }))
  const statusQueue = shuffle(buildOrderStatusPlan(plans.reduce((sum, plan) => sum + plan.count, 0)))

  plans.forEach(({ customer, count }, index) => {
    const addresses = addressesByCustomer.get(customer.id)
    for (let i = 0; i < count; i++) {
      const status = statusQueue.shift()
      const createdAt = timeWithinDays(60)
      const items = sample(products, randomInt(1, 3)).map(product => {
        const quantity = randomInt(1, 3)
        return { product, quantity, subtotal: money(product.price * quantity) }
      })
      const totalAmount = money(items.reduce((sum, item) => sum + item.subtotal, 0))
      const address = pickOne(addresses)
      const orderNo = `${SEED_ORDER_PREFIX}${createdAt.slice(2, 10).replace(/-/g, '')}${String(++sequence).padStart(4, '0')}`
      const handled = status === 'pending'
        ? { by: null, name: null }
        : { by: admin ? admin.id : null, name: admin ? admin.real_name : null }
      const orderId = Number(insertOrder.run(
        orderNo, customer.id, customer.username, customer.email, address.receiverName, customer.phone, formatAddress(address), totalAmount, status,
        index % 3 === 0 && status === 'pending' ? pickOne(['麻烦尽快发货，谢谢', '工作日白天送，谢谢', '需要开发票']) : null,
        handled.by, handled.name, createdAt, createdAt
      ).lastInsertRowid)

      for (const item of items) {
        insertItem.run(orderId, item.product.id, item.product.name, item.product.sku, item.product.price, item.quantity, item.subtotal)
        // 记录「已成交」的购买关系，供评论关联真实订单用
        if (status === 'completed') {
          if (!buyersByProduct.has(item.product.id)) buyersByProduct.set(item.product.id, [])
          buyersByProduct.get(item.product.id).push({ customerId: customer.id, nickname: customer.nickname, orderId, orderTime: createdAt })
        }
      }
      statusCount[status] = (statusCount[status] || 0) + 1
      total++
    }
  })

  summary.created.orders = total
  summary.created.orderStatus = statusCount
  return buyersByProduct
}

// 每个商品的评论条数：先按长尾权重抽一轮基础值，再整体缩放到 REVIEW_TARGET_COUNT，
// 最后逐条配平，保证总数严格等于目标值（不要求每个商品条数一样，更接近真实的长尾分布）
function planReviewCounts(productCount) {
  const base = Array.from({ length: productCount }, () => pickWeighted(REVIEW_COUNT_WEIGHTS))
  const baseSum = base.reduce((sum, value) => sum + value, 0)
  const counts = base.map(value => clamp(
    Math.round(value * REVIEW_TARGET_COUNT / baseSum),
    REVIEW_MIN_PER_PRODUCT,
    REVIEW_MAX_PER_PRODUCT
  ))
  return balanceToTarget(counts, REVIEW_TARGET_COUNT, REVIEW_MIN_PER_PRODUCT, REVIEW_MAX_PER_PRODUCT, '商品评论数')
}

// 全局评分池：按 RATING_TEMPLATE 的占比算出 5 / 4 / 3 星各能分多少条（3 星取余数，保证加起来正好等于总数），
// 再扣掉「每个商品第一条评论固定 5 星」已经占用的名额，剩下的才是可以自由分配的池子。
// 这样既避免单个商品出现「只有一条 3 星评论」把评分拉到 3 分的极端情况，
// 整体 5/4/3 星的比例又严格保持模板的 4:2:1。
function buildRatingQueue(total, guaranteedFiveStar) {
  const templateSize = RATING_TEMPLATE.length
  const fiveStarQuota = Math.round(total * RATING_TEMPLATE.filter(item => item === 5).length / templateSize)
  const fourStarQuota = Math.round(total * RATING_TEMPLATE.filter(item => item === 4).length / templateSize)
  return shuffle([
    ...Array(Math.max(0, fiveStarQuota - guaranteedFiveStar)).fill(5),
    ...Array(fourStarQuota).fill(4),
    ...Array(total - fiveStarQuota - fourStarQuota).fill(3),
  ])
}

function createReviews(customers, products, buyersByProduct) {
  // 种子评论一律是「未编辑」状态：is_edited 走列默认值 0（见 032 迁移，它才是「已编辑」的唯一依据），
  // 同时把 updated_at 写成与 created_at 相同，让两个时间戳在展示上也自洽
  const insert = raw.prepare('INSERT INTO product_review (product_id, customer_id, customer_name, rating, content, images, order_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)')
  const updateProduct = raw.prepare('UPDATE product SET rating = ?, review_count = ? WHERE id = ?')
  const reviewCounts = planReviewCounts(products.length)
  // 每个商品的第一条评论固定给 5 星打底，其余名额从全局评分池里按顺序取（池子大小恰好等于剩余名额）
  const ratingQueue = buildRatingQueue(REVIEW_TARGET_COUNT, products.length)
  const ratingDistribution = {}
  let total = 0

  products.forEach((product, productIndex) => {
    const count = reviewCounts[productIndex]
    // 素材各自独立抽取，尽量保证同一商品下的评论内容不重复：
    // 先放该商品类型专属的观察点（如戒指/杯壶/花盆），再用分类、通用短语补足。
    // 池子（专属 3~5 条 + 分类 5 条 + 通用 10 条）明显大于 REVIEW_MAX_PER_PRODUCT，
    // 正常不会走到 fillFrom 的循环复用分支。
    const detailPool = [
      ...shuffle(getSpecificDetails(product.name)),
      ...shuffle([...(CATEGORY_DETAILS[product.category_name] || []), ...GENERIC_DETAILS]),
    ]
    const details = fillFrom(detailPool, count)
    const shippingNotes = fillFrom(shuffle(SHIPPING_NOTES), count)
    // 3 星那条单独用中性描述，避免出现「描述一致，没有色差」却给中评的矛盾
    const neutralDetails = fillFrom(shuffle(NEUTRAL_DETAILS), count)
    const complaints = shuffle(MINOR_COMPLAINTS)
    const fiveStarTemplates = shuffle(FIVE_STAR_TEMPLATES)
    const fourStarTemplates = shuffle(FOUR_STAR_TEMPLATES)
    const ratings = shuffle([5, ...ratingQueue.splice(0, count - 1)])
    let fiveStarIndex = 0
    let fourStarIndex = 0
    let threeStarIndex = 0

    // 评论人：先随机错位取一轮（同一商品下不重复），再用真实买家替换前几条，形成「已购买用户评价」
    const reviewers = Array.from({ length: count }, (_, index) => customers[index % customers.length])
    const buyers = shuffle(buyersByProduct.get(product.id) || []).slice(0, Math.min(2, count))
    buyers.forEach((buyer, index) => {
      const customerIndex = reviewers.findIndex(item => item.id === buyer.customerId)
      if (customerIndex === -1) reviewers[index] = { id: buyer.customerId, nickname: buyer.nickname }
      else [reviewers[index], reviewers[customerIndex]] = [reviewers[customerIndex], reviewers[index]]
    })

    ratings.forEach((rating, index) => {
      // 模板条数少于该星级的评论条数时循环复用：同一模板配上不同观察点/物流短语，文案依然各不相同
      const template = rating === 5
        ? fiveStarTemplates[fiveStarIndex++ % fiveStarTemplates.length]
        : rating === 4
          ? fourStarTemplates[fourStarIndex++ % fourStarTemplates.length]
          : THREE_STAR_TEMPLATE
      const content = buildReviewContent(template, product, {
        detail: rating === 3 ? neutralDetails[threeStarIndex++] : details[index],
        shipping: shippingNotes[index],
        minor: complaints[index % complaints.length],
      })
      const buyer = buyers[index]
      const reviewer = reviewers[index]
      const reviewTime = buyer ? timeAfter(buyer.orderTime, 20) : timeWithinDays(90)
      insert.run(product.id, reviewer.id, reviewer.nickname, rating, content, buyer ? buyer.orderId : null, reviewTime, reviewTime)
      ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1
      total++
    })

    // 回写商品评分（该商品评论均值，保留 1 位小数）与评论数
    const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    updateProduct.run(Number(average.toFixed(1)), ratings.length, product.id)
  })

  summary.created.reviews = total
  summary.created.ratedProducts = products.length
  summary.created.ratingDistribution = ratingDistribution
}

function loadProducts() {
  return raw.prepare(`SELECT p.id, p.name, p.sku, p.price, p.stock, c.name AS category_name
    FROM product p JOIN category c ON c.id = p.category_id
    WHERE p.status = 1
    ORDER BY p.id`).all()
}

assertSchema()
const products = loadProducts()
if (!products.length) throw new Error('product 表里没有 status = 1 的商品，请先执行 npm run db:seed 或 npm run db:migrate 准备商品数据')

const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)

// 全部写操作放进一个事务：要么全成功，要么全回滚，避免留下半套假数据
const seed = raw.transaction(() => {
  cleanup()
  const customers = createCustomers(passwordHash)
  const addressesByCustomer = createAddresses(customers)
  createFavorites(customers, products)
  createCartItems(customers, products)
  const buyersByProduct = createOrders(customers, products, addressesByCustomer)
  createReviews(customers, products, buyersByProduct)
  summary.created.customers = customers.length
})
seed()

// ---------------------------------------------------------------------------
// 汇总日志
// ---------------------------------------------------------------------------
const dbPath = resolve(process.env.DB_PATH || './server/data.db')
const statusText = Object.entries(summary.created.orderStatus || {})
  .sort(([a], [b]) => ORDER_STATUS_RATIOS.findIndex(([status]) => status === a) - ORDER_STATUS_RATIOS.findIndex(([status]) => status === b))
  .map(([status, count]) => `${status} ${count}`)
  .join(' / ')
console.log(`[seed:dev] 数据库：${dbPath}`)
console.log(`[seed:dev] 清理旧假数据：顾客 ${summary.removed.customers} / 地址 ${summary.removed.addresses} / 收藏 ${summary.removed.favorites} / 购物车 ${summary.removed.cartItems} / 订单 ${summary.removed.orders} / 评论 ${summary.removed.reviews}`)
console.log(`[seed:dev] 生成顾客 ${summary.created.customers}、地址 ${summary.created.addresses}、收藏 ${summary.created.favorites}、购物车项 ${summary.created.cartItems}、订单 ${summary.created.orders}（${statusText}）、评论 ${summary.created.reviews}`)
console.log(`[seed:dev] 订单：目标 ${ORDER_TARGET_COUNT} 条，摊到 ${CUSTOMER_COUNT} 位顾客（人均 ${(ORDER_TARGET_COUNT / CUSTOMER_COUNT).toFixed(1)} 单，单人在 ${ORDER_MIN_PER_CUSTOMER}~${ORDER_MAX_PER_CUSTOMER} 单之间）`)
console.log(`[seed:dev] 评论：目标 ${REVIEW_TARGET_COUNT} 条，覆盖商品 ${summary.created.ratedProducts} 个（每个 ${REVIEW_MIN_PER_PRODUCT}~${REVIEW_MAX_PER_PRODUCT} 条，长尾分布），星级分布 ${Object.entries(summary.created.ratingDistribution || {}).sort(([a], [b]) => b - a).map(([rating, count]) => `${rating} 星 ${count} 条`).join(' / ')}，已回写 product.rating / product.review_count`)
console.log(`[seed:dev] 测试账号：用户名 ${seedUsername(0)} ~ ${seedUsername(CUSTOMER_COUNT - 1)}（手机号 ${seedPhones[0]} ~ ${seedPhones[seedPhones.length - 1]}），密码统一 ${SEED_PASSWORD}（昵称 ${seedNickname(0)} ~ ${seedNickname(CUSTOMER_COUNT - 1)}）`)
// 提醒：migrate.js 现在按 schema_migrations 记录表判断迁移是否已执行，
// 006/009 这类种子脚本只在空库首次执行一次，不会再随服务重启重复重建商品目录，
// 因此本脚本写入的评论/收藏/购物车在重启后端后不会丢失。
console.log('[seed:dev] 提示：请先启动后端再执行本脚本（迁移需先建表）；迁移已改为一次性执行，重启后端不会再清空评论/收藏/购物车')
console.log('[seed:dev] 提示：推荐执行顺序为 npm run db:migrate → npm run seed:products → npm run seed:dev，商品假数据由 seed:products 单独负责')
console.log('[seed:dev] 完成')

await db.end()
