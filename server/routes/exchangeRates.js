import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'

// 支持的 5 种语言，与 exchange_rate 表的 locale 取值一致
const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']

const fields = 'locale, currency_symbol, currency_code, rate_from_cny, updated_at'

function toRate(row) {
  if (!row) return null
  return {
    locale: row.locale,
    currency_symbol: row.currency_symbol,
    currency_code: row.currency_code,
    rate_from_cny: Number(row.rate_from_cny),
    updated_at: row.updated_at,
  }
}

// 后台：汇率设置（列表 / 修改单条）
export const adminRouter = Router()
adminRouter.use(requireAuth, requirePasswordChanged)

adminRouter.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM exchange_rate ORDER BY CASE locale WHEN 'zh-CN' THEN 0 WHEN 'zh-TW' THEN 1 WHEN 'en' THEN 2 WHEN 'ja' THEN 3 WHEN 'ko' THEN 4 ELSE 5 END`)
    res.json({ success: true, data: rows.map(toRate) })
  } catch (error) {
    next(error)
  }
})

adminRouter.put('/:locale', async (req, res, next) => {
  try {
    const locale = String(req.params.locale || '')
    if (!LOCALES.includes(locale)) {
      return res.status(400).json({ success: false, message: '不支持的语言' })
    }

    const rate = Number(req.body?.rate_from_cny)
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ success: false, message: '汇率必须是大于 0 的数字' })
    }

    const symbol = req.body?.currency_symbol != null ? String(req.body.currency_symbol).trim() : null
    const code = req.body?.currency_code != null ? String(req.body.currency_code).trim().toUpperCase() : null

    const [existing] = await db.execute(`SELECT ${fields} FROM exchange_rate WHERE locale = ?`, [locale])
    if (!existing[0]) return res.status(404).json({ success: false, message: '汇率不存在' })

    await db.execute(
      'UPDATE exchange_rate SET currency_symbol = ?, currency_code = ?, rate_from_cny = ?, updated_at = CURRENT_TIMESTAMP WHERE locale = ?',
      [
        symbol || existing[0].currency_symbol,
        code || existing[0].currency_code,
        rate,
        locale,
      ]
    )

    const [rows] = await db.execute(`SELECT ${fields} FROM exchange_rate WHERE locale = ?`, [locale])
    await writeOperationLog(req.admin.id, 'update_exchange_rate', `修改汇率：${locale} ${rows[0].currency_code} = ${rate}`, req)
    res.json({ success: true, data: toRate(rows[0]), message: '汇率已保存' })
  } catch (error) {
    next(error)
  }
})

// 前台：只读汇率列表，供语言 store 启动时拉取并缓存
export const publicRouter = Router()

publicRouter.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT ${fields} FROM exchange_rate ORDER BY CASE locale WHEN 'zh-CN' THEN 0 WHEN 'zh-TW' THEN 1 WHEN 'en' THEN 2 WHEN 'ja' THEN 3 WHEN 'ko' THEN 4 ELSE 5 END`)
    res.json({ success: true, data: rows.map(toRate) })
  } catch (error) {
    next(error)
  }
})

export default publicRouter
