// 商品编号(SKU) 生成规则（与后端 server/utils/productRules.js 保持一致）
// 格式：固定 10 位 = 前 3 位大写英文字母（当前登录管理员用户名映射） + 后 7 位数字（生成时刻时间戳映射）
// 前端用于新增弹窗/在线表格即时展示；预览是什么，提交完成后入库就是什么（后端所见即所存）

// 管理员用户名 → 3 位大写英文字母（A-Z）
export function usernameToLetters3(username) {
  const str = String(username || '').trim()
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 131 + str.charCodeAt(i)) >>> 0
  }
  const letters = []
  for (let i = 0; i < 3; i++) {
    letters.push(String.fromCharCode(65 + (hash % 26)))
    hash = Math.floor(hash / 26)
  }
  return letters.join('')
}

// 进程内自增序号：避免同一毫秒内连续生成（如在线表格一次新增多行）得到相同编码
let localSeq = 0

// 时间戳 → 7 位数字编码（0-9）
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

// 商品评分就近取整到 0.5 的倍数（未填默认 5，非法值原样返回由调用方提示）
export function normalizeRatingToHalf(value) {
  if (value === '' || value === null || value === undefined) return 5
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 5) return numeric
  return Math.round(numeric * 2) / 2
}
