import { Router } from 'express'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'

// 区域取值与 shipping_rate.region_key 一致；展示顺序按此排列（邻国较低，其他海外最高）
const REGIONS = ['CN', 'TW', 'JP', 'KR', 'OTHER']
const fields = 'region_key, locale, fee_cny, note, updated_at'
const orderBy = "ORDER BY CASE region_key WHEN 'CN' THEN 0 WHEN 'TW' THEN 1 WHEN 'JP' THEN 2 WHEN 'KR' THEN 3 WHEN 'OTHER' THEN 4 ELSE 5 END"

function toRate(row) {
  if (!row) return null
  return {
    region_key: row.region_key,
    locale: row.locale,
    fee_cny: Number(row.fee_cny),
    note: row.note || '',
    updated_at: row.updated_at,
  }
}

async function listRates() {
  const [rows] = await db.execute(`SELECT ${fields} FROM shipping_rate ${orderBy}`)
  return rows.map(toRate)
}

// 后台：运费设置（列表 / 修改）
export const adminRouter = Router()
adminRouter.use(requireAuth, requirePasswordChanged)

adminRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, data: await listRates() })
  } catch (error) {
    next(error)
  }
})

// 支持两种用法：批量提交全部改动，或只提交单条（行内保存），都走同一个端点
adminRouter.put('/', async (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.rates) ? req.body.rates : null
    if (!list || !list.length) {
      return res.status(400).json({ success: false, message: '请提供需要修改的运费' })
    }

    // 先整体校验，避免写一半失败
    const changes = list.map(item => ({
      region: String(item?.region_key || '').toUpperCase(),
      fee: Number(item?.fee_cny),
      hasNote: item?.note != null,
      note: item?.note != null ? String(item.note).trim().slice(0, 200) : null,
    }))
    for (const { region, fee } of changes) {
      if (!REGIONS.includes(region)) {
        return res.status(400).json({ success: false, message: `不支持的运费区域：${region || '(空)'}` })
      }
      if (!Number.isFinite(fee) || fee < 0) {
        return res.status(400).json({ success: false, message: '运费必须是大于或等于 0 的数字' })
      }
    }

    const [existing] = await db.execute(`SELECT ${fields} FROM shipping_rate`)
    const byRegion = new Map(existing.map(row => [row.region_key, row]))
    for (const { region } of changes) {
      if (!byRegion.has(region)) {
        return res.status(404).json({ success: false, message: `运费区域不存在：${region}` })
      }
    }

    for (const { region, fee, hasNote, note } of changes) {
      await db.execute(
        'UPDATE shipping_rate SET fee_cny = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE region_key = ?',
        [fee, hasNote ? note : byRegion.get(region).note, region]
      )
    }

    const rows = await listRates()
    const detail = changes.map(c => `${c.region}${c.fee === 0 ? ' 包邮' : ` ¥${c.fee}`}`).join('，')
    await writeOperationLog(req.admin.id, 'update_shipping_rate', `修改运费：${detail}`, req)
    res.json({ success: true, data: rows, message: '运费已保存' })
  } catch (error) {
    next(error)
  }
})

// 前台：只读运费列表，供语言 store 启动时拉取并缓存
export const publicRouter = Router()

publicRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, data: await listRates() })
  } catch (error) {
    next(error)
  }
})

export default publicRouter
