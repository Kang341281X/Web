// 商品编号(SKU) 生成规则：算法的唯一实现在根目录 shared/productRules.js，
// 后端 server/utils/productRules.js 引用的是同一份；这里仅做 re-export，
// 保持前端现有 import 路径（utils/sku）不变。
// 前端用于新增弹窗/在线表格即时展示；预览是什么，提交完成后入库就是什么（后端所见即所存）。
export { usernameToLetters3, timestampToCode7, generateSkuCode, normalizeRatingToHalf } from '../../shared/productRules.js'
