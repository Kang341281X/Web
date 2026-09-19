// 商品公共规则：算法的唯一实现已提取到根目录 shared/productRules.js（前后端共享），
// 这里仅做 re-export，保持 server 侧现有 import 路径（../utils/productRules.js）不变。
// 前端对应入口是 src/utils/sku.js，同样 re-export 自 shared，两端天然一致、无需手动同步。
export { usernameToLetters3, timestampToCode7, generateSkuCode, normalizeRating } from '../../shared/productRules.js'
