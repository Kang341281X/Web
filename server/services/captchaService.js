import { randomUUID } from 'node:crypto'
import svgCaptcha from 'svg-captcha'

/**
 * 图形验证码：登录环节的人机校验，用于抬高暴力破解 / 撞库的成本。
 *
 * 方案选择：svg-captcha
 *   - 纯 JS 实现，无原生依赖、不发起任何网络请求，完全自托管；
 *   - 直接产出 SVG 字符串，不需要 canvas，服务器无需额外系统库；
 *   - 因此不依赖 Google reCAPTCHA 之类的第三方服务（本项目明确不接入）。
 *
 * 存储：进程内 Map。
 *   本项目是单进程 + SQLite 的应用（server/index.js 直接 app.listen），
 *   没有多实例/重启后仍需保留验证码的场景，所以内存 Map 足够，不必建表。
 *   若将来要多实例部署，把这里的 store 换成 Redis 或数据库即可，对外接口不变。
 *
 * 生命周期：
 *   键 captchaId（随机 UUID）→ { text, expiresAt }
 *   - 默认 5 分钟过期（CAPTCHA_TTL_MS 可调）；
 *   - 一次性：不管校验通过还是失败都会被删除。
 *     这是防爆破的关键——否则攻击者可以拿同一张图反复试密码，
 *     只需要人工识别一次；一次性使用后，每次尝试都得重新识别。
 *   - 惰性清理（每次签发前扫一遍）+ 定时兜底清理，避免过期数据长期占内存。
 */

// 有效期：默认 5 分钟，落在需求的 5-10 分钟区间内
const TTL_MS = Number(process.env.CAPTCHA_TTL_MS || 5 * 60 * 1000)

// 同时保留的验证码条数上限。
// 签发接口是免登录的，没有上限的话，有人持续请求就能把内存撑大，这里做硬性兜底。
const MAX_STORE_SIZE = Number(process.env.CAPTCHA_MAX_STORE || 5000)

const store = new Map()

function sweep() {
  const now = Date.now()
  for (const [id, item] of store) if (item.expiresAt <= now) store.delete(id)
}

// 兜底清理：即使一段时间没有任何请求，也不会把过期数据一直留在内存里。
// unref() 让这个定时器不阻止进程退出（否则 node 脚本跑完会一直挂着不结束）。
const sweepTimer = setInterval(sweep, 60 * 1000)
sweepTimer.unref?.()

/**
 * 签发一张新验证码。
 * @returns {{ captchaId: string, svg: string, expiresIn: number }}
 */
export function issueCaptcha() {
  sweep()
  // 达到上限时先淘汰最早的一条，保证 store 大小有界
  while (store.size >= MAX_STORE_SIZE) store.delete(store.keys().next().value)

  const { text, data } = svgCaptcha.create({
    size: 4,
    noise: 3,
    color: true,
    background: '#f5f5f5',
    width: 120,
    height: 40,
    // 去掉 0/O/o/1/l/I 这类肉眼易混字符，降低正常用户输错的概率
    ignoreChars: '0oO1ilI',
  })

  const captchaId = randomUUID()
  // 统一小写比较，用户不必纠结大小写
  store.set(captchaId, { text: String(text).toLowerCase(), expiresAt: Date.now() + TTL_MS })

  return { captchaId, svg: data, expiresIn: Math.floor(TTL_MS / 1000) }
}

/**
 * 校验并消费一张验证码（一次性）。
 *
 * @param {string} captchaId 签发时返回的 id
 * @param {string} input     用户输入的字符
 * @returns {'ok'|'missing'|'expired'|'mismatch'}
 *   - ok       校验通过（该验证码已作废）
 *   - missing  没带 id 或没填内容
 *   - expired  不存在或已过期（含「已被用过」，对调用方等价）
 *   - mismatch 内容不匹配（该验证码同样已作废）
 *
 * 之所以要区分这么多原因，只是为了排查问题时能看懂日志；
 * 对用户一律回同一句「验证码错误或已过期」，避免给攻击者额外信息。
 */
export function consumeCaptcha(captchaId, input) {
  const id = String(captchaId || '').trim()
  const text = String(input || '').trim().toLowerCase()
  if (!id || !text) return 'missing'

  const item = store.get(id)
  // 先删再判断：无论结果如何都作废，防止同一张图被反复使用
  if (!item) return 'expired'
  store.delete(id)

  if (item.expiresAt <= Date.now()) return 'expired'
  return item.text === text ? 'ok' : 'mismatch'
}

/** 当前存活的验证码条数（仅用于测试与排查） */
export const captchaStoreSize = () => store.size

export default { issueCaptcha, consumeCaptcha, captchaStoreSize }
