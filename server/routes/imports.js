import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, readdir, rename, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { inflate } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import * as XLSX from 'xlsx'
import multer from 'multer'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

// ── 常量 ──────────────────────────────────────────────
const TEMPLATE_HEADERS = ['商品名称', '分类名称', '价格', '原价', '库存', '单位', '生产厂家', '品牌', '描述', '图片文件夹名称']
const VALID_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp'])
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
const MAX_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024 // 1 GB
const PREVIEW_TTL_MINUTES = 30
const MAX_EXCEL_SIZE = 10 * 1024 * 1024 // 10 MB for Excel
const MAX_ZIP_SIZE = 500 * 1024 * 1024 // 500 MB compressed zip

// 文件头（magic number）校验
const MAGIC = {
  png:  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  bmp:  Buffer.from([0x42, 0x4d]),
}
function detectImageType(buf) {
  if (!buf || buf.length < 3) return null
  if (buf.subarray(0, 8).equals(MAGIC.png)) return 'png'
  if (buf.subarray(0, 3).equals(MAGIC.jpeg)) return 'jpeg'
  if (buf.subarray(0, 2).equals(MAGIC.bmp)) return 'bmp'
  return null
}

// 自然排序比较器
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const uploadRoot = () => resolve(process.env.UPLOAD_DIR || './uploads')

// multer 配置：接收 excel + zip
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ZIP_SIZE,
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'excel') {
      if (!file.originalname.match(/\.(xlsx|xls)$/i)) return cb(new Error('Excel 文件格式不正确，请使用 .xlsx 格式'))
    } else if (file.fieldname === 'zip') {
      if (!file.originalname.toLowerCase().endsWith('.zip')) return cb(new Error('压缩包格式不正确，只支持 .zip 格式'))
    } else {
      return cb(new Error('不支持的文件字段'))
    }
    cb(null, true)
  },
})

// ── 工具函数 ──────────────────────────────────────────

// Minimal ZIP central directory parser - returns entry metadata without extraction
async function parseZipEntries(buffer) {
  const entries = []
  // Find End of Central Directory record
  let eocdOffset = -1
  const minScan = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= minScan; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) throw Object.assign(new Error('无效的 ZIP 文件'), { status: 400 })

  const cdEntries = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)

  let offset = cdOffset
  for (let i = 0; i < cdEntries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break

    const compMethod = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const uncompSize = buffer.readUInt32LE(offset + 24)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({
      name,
      compMethod: compMethod,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    })

    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

// Extract a single file from the zip by entry (only stored or deflate)
async function extractZipEntry(buffer, entry) {
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('无效的本地文件头')

  const nameLen = buffer.readUInt16LE(offset + 26)
  const extraLen = buffer.readUInt16LE(offset + 28)
  const dataOffset = offset + 30 + nameLen + extraLen
  const compSize = entry.compressedSize

  const rawData = buffer.subarray(dataOffset, dataOffset + compSize)

  if (entry.compMethod === 0) {
    // Stored (no compression)
    return Buffer.from(rawData)
  } else if (entry.compMethod === 8) {
    // Deflate
    return await new Promise((resolve, reject) => {
      inflate(rawData, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
  } else {
    throw new Error(`不支持的压缩方法: ${entry.compMethod}`)
  }
}

// ── 模板下载（读取静态文件 public/assets/Products.xlsx） ─────────
const TEMPLATE_FILE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'assets', 'Products.xlsx'
)

router.get('/import-template', async (req, res) => {
  try {
    if (!existsSync(TEMPLATE_FILE_PATH)) {
      return res.status(404).json({ success: false, message: '模板文件不存在，请联系管理员' })
    }
    const buf = await readFile(TEMPLATE_FILE_PATH)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Products.xlsx')}`)
    res.send(buf)
  } catch (error) {
    next(error)
  }
})

// ── 预览接口 ──────────────────────────────────────────
router.post('/import/preview', importUpload.fields([
  { name: 'excel', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
]), async (req, res, next) => {
  let batchId = null
  let tempDir = null
  try {
    const excelFile = req.files?.excel?.[0]
    const zipFile = req.files?.zip?.[0]
    if (!excelFile) return res.status(400).json({ success: false, message: '请选择 Excel 文件' })
    if (!zipFile) return res.status(400).json({ success: false, message: '请选择 images.zip 压缩包' })

    // 校验 Excel 文件大小
    if (excelFile.size > MAX_EXCEL_SIZE) {
      return res.status(400).json({ success: false, message: 'Excel 文件不能超过 10MB' })
    }

    // 校验压缩包文件名
    if (zipFile.originalname !== 'images.zip') {
      return res.status(400).json({ success: false, message: '请将压缩包命名为 images.zip 后重新上传' })
    }

    // 校验 zip 文件完整性并获取条目列表
    let zipEntries
    try {
      zipEntries = await parseZipEntries(zipFile.buffer)
    } catch {
      return res.status(400).json({ success: false, message: '无效的 ZIP 文件，请检查压缩包是否完整' })
    }

    // 估算解压后总大小
    const totalUncompressed = zipEntries.reduce((sum, e) => sum + e.uncompressedSize, 0)
    if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
      return res.status(400).json({ success: false, message: '解压后总大小超过 1GB，请精简图片后重新打包上传' })
    }

    // 解析 Excel
    let workbook
    try {
      workbook = XLSX.read(excelFile.buffer, { type: 'buffer' })
    } catch {
      return res.status(400).json({ success: false, message: 'Excel 文件解析失败，请检查文件是否损坏' })
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return res.status(400).json({ success: false, message: 'Excel 文件中没有工作表' })

    // 校验表头
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (!sheetRows.length) return res.status(400).json({ success: false, message: 'Excel 文件为空' })

    const actualHeaders = sheetRows[0].map(h => String(h).trim())
    const headersMatch = TEMPLATE_HEADERS.length === actualHeaders.length &&
      TEMPLATE_HEADERS.every((h, i) => h === actualHeaders[i])
    if (!headersMatch) {
      return res.status(400).json({ success: false, message: '表格格式不正确，请使用系统提供的 Products.xlsx 模板，不要修改列结构' })
    }

    const dataRows = sheetRows.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''))
    if (!dataRows.length) return res.status(400).json({ success: false, message: 'Excel 中没有商品数据行' })

    // 获取所有分类（名称 → id）
    const [categories] = await db.execute('SELECT id, name FROM category WHERE status = 1')
    const categoryMap = new Map(categories.map(c => [c.name, c.id]))

    // 解析 zip 目录结构：收集所有顶层文件夹名称
    const zipFilesByFolder = new Map() // folderName -> [{ entry, baseName }]
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue
      // 只处理第一层子目录下的文件（不递归子文件夹）
      const parts = entry.name.split('/')
      if (parts.length < 2) continue // 不在子文件夹中，跳过

      const folderName = parts[0]
      const fileName = parts[parts.length - 1]
      const ext = '.' + fileName.split('.').pop().toLowerCase()

      // 过滤系统文件和非图片格式
      if (SYSTEM_FILES.has(fileName.toLowerCase())) continue
      if (!VALID_IMAGE_EXTS.has(ext)) continue

      // 只处理直接在子文件夹根目录下的图片（不递归）
      if (parts.length > 2) continue

      if (!zipFilesByFolder.has(folderName)) {
        zipFilesByFolder.set(folderName, [])
      }
      zipFilesByFolder.get(folderName).push({ entry, baseName: fileName, ext })
    }

    // 生成批次
    batchId = randomUUID()
    tempDir = join(uploadRoot(), 'import-temp', batchId)

    // 解压图片到临时目录
    await mkdir(tempDir, { recursive: true })
    for (const [folderName, files] of zipFilesByFolder) {
      const folderPath = join(tempDir, folderName)
      await mkdir(folderPath, { recursive: true })
      // 自然排序
      files.sort((a, b) => naturalCompare(a.baseName, b.baseName))
      for (let i = 0; i < files.length; i++) {
        const fileData = await extractZipEntry(zipFile.buffer, files[i].entry)
        // 验证文件头（magic number）
        const detected = detectImageType(fileData)
        if (!detected) continue // magic number 不匹配，跳过
        const newName = `${i + 1}${files[i].ext}`
        await writeFile(join(folderPath, newName), fileData)
      }
    }

    // 逐行解析商品并校验
    const previewRows = []
    let successCount = 0
    let failCount = 0

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx]
      const excelRowNum = rowIdx + 2 // +2: 1-based + header row
      const name = String(row[0] || '').trim()
      const categoryName = String(row[1] || '').trim()
      const priceStr = String(row[2] || '').trim()
      const originalPriceStr = String(row[3] || '').trim()
      const stockStr = String(row[4] || '').trim()
      const unit = String(row[5] || '').trim()
      const manufacturer = String(row[6] || '').trim()
      const brand = String(row[7] || '').trim()
      const description = String(row[8] || '').trim()
      const imageFolderName = String(row[9] || '').trim()

      const errors = []

      // 必填校验
      if (!name) errors.push('商品名称为空')
      if (!categoryName) errors.push('分类名称为空')
      if (!priceStr) errors.push('价格为空')
      if (!stockStr) errors.push('库存为空')
      if (!imageFolderName) errors.push('图片文件夹名称为空')

      // 数值校验
      let price = null
      if (priceStr) {
        price = Number(priceStr)
        if (!Number.isFinite(price) || price < 0) errors.push('价格格式不正确')
      }
      let originalPrice = null
      if (originalPriceStr) {
        originalPrice = Number(originalPriceStr)
        if (!Number.isFinite(originalPrice) || originalPrice < 0) errors.push('原价格式不正确')
      }
      if (originalPrice !== null && price !== null && originalPrice < price) {
        errors.push('原价不能低于售价')
      }
      let stock = null
      if (stockStr) {
        stock = Number(stockStr)
        if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) errors.push('库存必须是非负整数')
      }

      // 分类是否存在
      let categoryId = null
      if (categoryName && !categoryMap.has(categoryName)) {
        errors.push(`分类"${categoryName}"不存在`)
      } else if (categoryName) {
        categoryId = categoryMap.get(categoryName)
      }

      // 图片文件夹匹配（只做去空格容错，不做大小写容错）
      let imageFiles = []
      if (imageFolderName) {
        const normalizedFolder = imageFolderName.trim()
        const folderPath = join(tempDir, normalizedFolder)
        const safePath = relative(tempDir, folderPath)
        if (safePath.startsWith('..') || safePath === '') {
          errors.push(`图片文件夹路径非法：${imageFolderName}`)
        } else if (!existsSync(folderPath)) {
          errors.push(`未找到图片文件夹：${imageFolderName}`)
        } else {
          // 读取临时目录中已解压并排序重命名的图片
          const filesInDir = await readdir(folderPath)
          imageFiles = filesInDir
            .filter(f => {
              const ext = '.' + f.split('.').pop().toLowerCase()
              return VALID_IMAGE_EXTS.has(ext) && !SYSTEM_FILES.has(f.toLowerCase())
            })
            .sort((a, b) => naturalCompare(a, b))
            .map(f => join(normalizedFolder, f))
          if (!imageFiles.length) {
            errors.push(`图片文件夹"${imageFolderName}"中没有有效的图片文件`)
          }
        }
      }

      const isSuccess = errors.length === 0
      if (isSuccess) successCount++
      else failCount++

      previewRows.push({
        row: excelRowNum,
        name: name || '(未填写)',
        category_name: categoryName || '(未填写)',
        price: price !== null ? Number(price) : null,
        original_price: originalPrice !== null ? Number(originalPrice) : null,
        stock: stock !== null ? Number(stock) : null,
        unit: unit || null,
        manufacturer: manufacturer || null,
        brand: brand || null,
        description: description || null,
        image_folder_name: imageFolderName || '(未填写)',
        image_count: imageFiles.length,
        image_files: imageFiles,
        success: isSuccess,
        errors: errors.length ? errors : undefined,
      })
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MINUTES * 60 * 1000)

    await db.execute(
      'INSERT INTO import_batch (id, admin_id, status, total_count, success_count, fail_count, preview_data, temp_dir, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        batchId,
        req.admin.id,
        'pending',
        dataRows.length,
        successCount,
        failCount,
        JSON.stringify(previewRows),
        tempDir,
        now,
        expiresAt,
      ]
    )

    res.json({
      success: true,
      data: {
        batchId,
        total_count: dataRows.length,
        success_count: successCount,
        fail_count: failCount,
        preview: previewRows.map(r => ({
          row: r.row,
          name: r.name,
          category_name: r.category_name,
          price: r.price,
          stock: r.stock,
          image_count: r.image_count,
          image_folder_name: r.image_folder_name,
          success: r.success,
          errors: r.errors,
        })),
      },
    })
  } catch (error) {
    // 如果已创建了临时目录但预览失败，清理
    if (tempDir) {
      try { await rm(tempDir, { recursive: true, force: true }) } catch {}
    }
    if (batchId) {
      try { await db.execute('DELETE FROM import_batch WHERE id = ?', [batchId]) } catch {}
    }
    next(error)
  }
})

// ── 确认导入接口 ──────────────────────────────────────
router.post('/import/confirm', async (req, res, next) => {
  const batchId = req.body.batchId
  if (!batchId || typeof batchId !== 'string') {
    return res.status(400).json({ success: false, message: '缺少批次ID' })
  }

  const [batches] = await db.execute('SELECT * FROM import_batch WHERE id = ? AND status = ?', [batchId, 'pending'])
  const batch = batches[0]
  if (!batch) return res.status(404).json({ success: false, message: '导入批次不存在或已过期，请重新上传' })

  // 检查是否已过期
  if (new Date(batch.expires_at) < new Date()) {
    await cleanupBatch(batch.id, batch.temp_dir)
    return res.status(410).json({ success: false, message: '导入批次已过期，请重新上传' })
  }

  let previewData
  try {
    previewData = typeof batch.preview_data === 'string' ? JSON.parse(batch.preview_data) : batch.preview_data
  } catch {
    await cleanupBatch(batch.id, batch.temp_dir)
    return res.status(400).json({ success: false, message: '预览数据损坏，请重新上传' })
  }

  const successRows = previewData.filter(r => r.success)
  if (!successRows.length) {
    return res.status(400).json({ success: false, message: '没有可导入的成功记录' })
  }

  // 再次验证分类（防止预览后分类被删除）
  const categoryNames = [...new Set(successRows.map(r => r.category_name))]
  const [categories] = await db.execute(`SELECT id, name FROM category WHERE name IN (${categoryNames.map(() => '?').join(',')}) AND status = 1`, categoryNames)
  const categoryMap = new Map(categories.map(c => [c.name, c.id]))

  const missingCategory = categoryNames.find(name => !categoryMap.has(name))
  if (missingCategory) {
    return res.status(400).json({ success: false, message: `分类"${missingCategory}"已不存在，请重新上传或先创建该分类` })
  }

  const connection = await db.getConnection()
  const createdProductIds = []
  try {
    await connection.beginTransaction()

    for (const row of successRows) {
      const categoryId = categoryMap.get(row.category_name)

      // 插入 product
      const [productResult] = await connection.execute(
        'INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, 1)',
        [row.name, categoryId, row.price, row.original_price, row.stock, row.unit || null, row.manufacturer || null, row.brand || null, row.description || null]
      )
      const productId = productResult.insertId
      createdProductIds.push(productId)

      // 创建专属目录并移动图片
      const productDir = join(uploadRoot(), 'products', String(productId))
      await mkdir(productDir, { recursive: true })

      let mainImageUrl = null
      for (let imgIdx = 0; imgIdx < row.image_files.length; imgIdx++) {
        const tempImageRelPath = row.image_files[imgIdx] // relative to tempDir, e.g. "folderName/1.jpg"
        const tempAbsPath = join(batch.temp_dir, tempImageRelPath)

        // 生成 UUID 文件名
        const ext = '.' + tempImageRelPath.split('.').pop().toLowerCase()
        const uuidName = randomUUID() + ext
        const destPath = join(productDir, uuidName)
        await rename(tempAbsPath, destPath)

        const imageUrl = `/uploads/products/${productId}/${uuidName}`
        const isMain = imgIdx === 0 ? 1 : 0

        await connection.execute(
          'INSERT INTO product_image (product_id, image_url, is_main, sort_order) VALUES (?, ?, ?, ?)',
          [productId, imageUrl, isMain, imgIdx]
        )

        if (imgIdx === 0) mainImageUrl = imageUrl
      }

      // 更新 product.main_image
      await connection.execute('UPDATE product SET main_image = ? WHERE id = ?', [mainImageUrl, productId])
    }

    // 标记批次为已确认
    await connection.execute('UPDATE import_batch SET status = ? WHERE id = ?', ['confirmed', batchId])

    await connection.commit()

    // 清理临时目录
    await cleanupTempDir(batch.temp_dir)

    await writeOperationLog(req.admin.id, 'import_products', `批量导入商品：成功${successRows.length}条`, req)

    res.json({ success: true, data: { imported_count: successRows.length, product_ids: createdProductIds } })
  } catch (error) {
    await connection.rollback()
    // 回滚已创建的商品目录
    for (const pid of createdProductIds) {
      try { await storageService.deleteDirectory(`products/${pid}`) } catch {}
    }
    next(error)
  } finally {
    connection.release()
  }
})

// ── 取消导入接口 ──────────────────────────────────────
router.delete('/import/:batchId', async (req, res, next) => {
  try {
    const batchId = req.params.batchId
    const [batches] = await db.execute('SELECT id, temp_dir, status FROM import_batch WHERE id = ?', [batchId])
    const batch = batches[0]
    if (!batch) return res.status(404).json({ success: false, message: '批次不存在' })
    if (batch.status === 'confirmed') return res.json({ success: true, message: '批次已完成，无需取消' })

    await cleanupBatch(batch.id, batch.temp_dir)
    res.json({ success: true, message: '已取消导入并清理临时文件' })
  } catch (error) {
    next(error)
  }
})

// ── 清理工具函数 ──────────────────────────────────────
async function cleanupBatch(batchId, tempDir) {
  await cleanupTempDir(tempDir)
  try {
    await db.execute('DELETE FROM import_batch WHERE id = ?', [batchId])
  } catch (error) {
    console.error('清理批次记录失败:', error)
  }
}

async function cleanupTempDir(tempDir) {
  if (!tempDir) return
  try {
    const base = uploadRoot()
    const rel = relative(base, tempDir)
    if (!rel.startsWith('..') && rel !== '') {
      await rm(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    console.error('清理临时目录失败:', error)
  }
}

// ── 定时清理过期批次 ──────────────────────────────────
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 分钟

let cleanupTimer = null

export function startImportCleanupTask() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(async () => {
    try {
      const [expired] = await db.execute(
        "SELECT id, temp_dir FROM import_batch WHERE status = 'pending' AND expires_at < NOW()"
      )
      for (const batch of expired) {
        await cleanupBatch(batch.id, batch.temp_dir)
      }
      if (expired.length) {
        console.log(`[Import Cleanup] 清理了 ${expired.length} 个过期批次`)
      }
    } catch (error) {
      console.error('[Import Cleanup] 定时清理失败:', error)
    }
  }, CLEANUP_INTERVAL)
  cleanupTimer.unref?.() // 不阻止进程退出
  console.log('[Import Cleanup] 定时清理任务已启动，每 5 分钟执行一次')
}

export default router
