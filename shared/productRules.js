// 商品公共规则：SKU 生成算法 + 商品评分就近取整（前后端共享的唯一实现）
//
// 本文件同时被两端直接引用，改算法只改这一处，两端天然一致：
//   - 后端：server/utils/productRules.js 从这里 re-export（package.json 为 ESM，Node 相对路径直接可用）
//   - 前端：src/utils/sku.js 从这里 re-export（文件在项目根内，Vite dev / build 均可直接打包）
// 因此这里只允许纯 JS：不 import 任何 npm 包，不使用 Node / 浏览器专属 API。

// 商品编号(SKU) 格式：固定 10 位 = 前 3 位大写英文字母（A-Z） + 后 7 位数字（0-9）
//   前 3 位：当前登录管理员的用户名 → 3 位大写字母
//   后 7 位：生成时刻的时间戳 → 7 位数字编码

// 管理员用户名 → 3 位大写英文字母（A-Z）
export function usernameToLetters3(username) {
  const str = String(username || '').trim()
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 131 + str.charCodeAt(i)) >>> 0 // 32 位无符号累加哈希，避免溢出
  }
  const letters = []
  for (let i = 0; i < 3; i++) {
    letters.push(String.fromCharCode(65 + (hash % 26))) // 65 = 'A'
    hash = Math.floor(hash / 26)
  }
  return letters.join('')
}

// 进程内自增序号：避免同一毫秒内连续生成（如批量上传多行）得到相同编码。
// 前后端各自 import 本模块，进程内各持一份序号，互不干扰。
let localSeq = 0

// 生成时间戳 → 7 位数字编码（0-9）
// 取「毫秒时间戳 + 进程内序号」的后 7 位十进制数字，不足 7 位左侧补 0
export function timestampToCode7(timestamp = Date.now()) {
  const seq = (localSeq = (localSeq + 1) % 1000)
  const value = (Math.trunc(Number(timestamp) || 0) + seq) % 10000000
  return String(value).padStart(7, '0')
}

// 10 位商品编号：前 3 位管理员字母 + 后 7 位数字时间编码
export function generateSkuCode(adminUsername) {
  return usernameToLetters3(adminUsername) + timestampToCode7()
}

// 商品评分（服务端校验口径）：
//  - 未填写 → 默认 5
//  - 非数字或超出 [0, 5] → { valid: false }
//  - 其余一律"就近取整到 0.5 的倍数"（不是校验失败）
export function normalizeRating(value) {
  if (value === '' || value === null || value === undefined) return { valid: true, rating: 5 }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 5) return { valid: false, rating: null }
  return { valid: true, rating: Math.round(numeric * 2) / 2 }
}

// 商品评分（前端展示口径）：未填默认 5；非法值原样返回由调用方提示；合法值就近取整到 0.5 的倍数
export function normalizeRatingToHalf(value) {
  if (value === '' || value === null || value === undefined) return 5
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 5) return numeric
  return Math.round(numeric * 2) / 2
}
