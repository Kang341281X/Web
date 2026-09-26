import { Router } from 'express'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'
import { publicWriteLimiter } from '../middleware/rateLimit.js'

const router = Router()

// 结算清单模板路径：public/assets/结算清单.xlsx
const templatePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets', '结算清单.xlsx')

// 模板带“批注”（表头填写说明）。exceljs 在存在 comments/vmlDrawing 关系时存在
// reconcile 缺陷（读取 undefined.comments 抛错），这里在内存中先剔除批注相关
// 关系与部件（冻结窗格、列宽、下拉等其余内容均保留），再交给 exceljs 加载。
function stripCommentRelations(buffer) {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  const touched = new Map()
  for (const relEntry of entries.filter(e => /xl\/worksheets\/_rels\/.*\.rels$/.test(e.entryName))) {
    const xml = zip.readAsText(relEntry)
    const cleaned = xml.replace(/\s*<Relationship\b[^>]*?Type="[^"]*\/(comments|vmlDrawing)"[^>]*?\/>/g, '')
    if (cleaned !== xml) touched.set(relEntry.entryName, cleaned)
  }
  for (const entry of entries) {
    if (/(^|\/)xl\/(comments\d+\.xml|drawings\/vmlDrawing\d+\.vml)$/.test(entry.entryName)) {
      zip.deleteFile(entry.entryName)
    }
  }
  for (const [name, content] of touched) {
    zip.deleteFile(name)
    zip.addFile(name, Buffer.from(content, 'utf8'))
  }
  return zip.toBuffer()
}

// 保留两位小数的金额计算
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

// POST /api/public/checkout/export
// 接收购物车明细 items: [{ sku, name, quantity, price }]
// 基于模板（表头已冻结在第一行）从第 2 行写入数据，并保留模板样式
// 公开接口（无需登录）且有模板解压/重打包成本：挂公开写限流 + 条目数上限双重防护
const MAX_EXPORT_ITEMS = 200

router.post('/checkout/export', publicWriteLimiter, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) {
      return res.status(400).json({ success: false, message: '购物车中没有可导出的商品' })
    }
    if (items.length > MAX_EXPORT_ITEMS) {
      return res.status(400).json({ success: false, message: `导出条目过多（最多 ${MAX_EXPORT_ITEMS} 条），请精简购物车后重试` })
    }
    if (!existsSync(templatePath)) {
      return res.status(500).json({ success: false, message: '结算清单模板文件不存在' })
    }

    const template = await readFile(templatePath)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(stripCommentRelations(template))
    const sheet = workbook.worksheets[0]
    if (!sheet) {
      return res.status(500).json({ success: false, message: '结算清单模板缺少工作表' })
    }

    let total = 0
    const moneyFormat = '#,##0.00'
    items.forEach((item, index) => {
      const row = index + 2 // 第 1 行为表头
      const sku = String(item.sku || '').trim()
      const name = String(item.name || '').trim()
      const quantity = Number(item.quantity) || 0
      const price = round2(item.price)
      const lineTotal = round2(quantity * price)
      total += lineTotal

      sheet.getCell(`A${row}`).value = sku
      sheet.getCell(`B${row}`).value = name
      sheet.getCell(`C${row}`).value = quantity
      sheet.getCell(`D${row}`).value = price
      sheet.getCell(`D${row}`).numFmt = moneyFormat
      sheet.getCell(`E${row}`).value = lineTotal
      sheet.getCell(`E${row}`).numFmt = moneyFormat
    })

    // 合计行：名称写"合计"，总价列为所有商品总价
    const summaryRow = items.length + 2
    sheet.getCell(`A${summaryRow}`).value = ''
    sheet.getCell(`B${summaryRow}`).value = '合计'
    sheet.getCell(`C${summaryRow}`).value = ''
    sheet.getCell(`D${summaryRow}`).value = ''
    sheet.getCell(`E${summaryRow}`).value = round2(total)
    sheet.getCell(`E${summaryRow}`).numFmt = moneyFormat
    sheet.getCell(`A${summaryRow}`).font = { bold: true }
    sheet.getCell(`B${summaryRow}`).font = { bold: true }
    sheet.getCell(`E${summaryRow}`).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    const filename = '结算清单.xlsx'
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    // 中文文件名：filename*=UTF-8'' 写法 + ASCII 兜底，避免浏览器乱码/截断
    res.setHeader('Content-Disposition', `attachment; filename="checkout.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
  } catch (error) {
    next(error)
  }
})

export default router
