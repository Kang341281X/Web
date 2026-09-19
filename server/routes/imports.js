import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, readdir, rename, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import AdmZip from 'adm-zip'
import * as XLSX from 'xlsx'
import multer from 'multer'
import db from '../config/db.js'
import { requireAuth, requirePasswordChanged, writeOperationLog } from '../middleware/auth.js'
import storageService from '../services/storageService.js'
import { requiredText } from '../utils/admin.js'
import { generateSkuCode, normalizeRating } from '../utils/productRules.js'

const router = Router()
router.use(requireAuth, requirePasswordChanged)

// ── 常量 ──────────────────────────────────────────────
const TEMPLATE_HEADERS = [
  '商品名称', '分类名称', '是否支持定制', '商品评分', '售价', '原价',
  '库存', '单位（件/盒）', '生产厂家', '品牌', '描述', '图片文件夹名称'
]
const VALID_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp'])
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
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp'
  return null
}

// 商品编号生成算法在 ../utils/productRules.js（全系统统一：3 位用户名映射字母 + 7 位时间戳映射数字）

// 自然排序比较器
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

// 在 baseDir 下递归查找名称匹配 folderName 的子文件夹（最多 3 层深度）
async function findFolderByName(baseDir, folderName) {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (ent.name === folderName) {
        return join(baseDir, ent.name)
      }
    }
    // 第一层没找到，继续在子目录中递归
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      // 跳过系统文件夹
      if (SYSTEM_FILES.has(ent.name.toLowerCase())) continue
      const subPath = join(baseDir, ent.name)
      const rel = relative(baseDir, subPath)
      // 安全检查：防止路径遍历
      if (rel.startsWith('..')) continue
      const found = await findFolderByNameLevel2(subPath, folderName, 1)
      if (found) return found
    }
  } catch { /* ignore */ }
  return null
}

async function findFolderByNameLevel2(baseDir, folderName, depth) {
  if (depth > 3) return null
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (ent.name === folderName) {
        return join(baseDir, ent.name)
      }
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (SYSTEM_FILES.has(ent.name.toLowerCase())) continue
      const found = await findFolderByNameLevel2(join(baseDir, ent.name), folderName, depth + 1)
      if (found) return found
    }
  } catch { /* ignore */ }
  return null
}

// 统计文件夹中的图片数量
async function countImagesInDir(dirPath) {
  try {
    const files = await readdir(dirPath)
    return files.filter(f => {
      const ext = '.' + f.split('.').pop().toLowerCase()
      return VALID_IMAGE_EXTS.has(ext) && !SYSTEM_FILES.has(f.toLowerCase())
    }).length
  } catch {
    return 0
  }
}

// 收集临时目录中的文件夹结构（两层：顶层文件夹 → 子文件夹列表）
// 如果顶层文件夹直接含图片，也作为子文件夹返回（parent=null）
// 如果顶层文件夹只含子文件夹，则返回子文件夹列表
async function collectFolderStructure(tempDir, previewRows) {
  const result = []
  const topEntries = await readdir(tempDir, { withFileTypes: true })
  for (const ent of topEntries) {
    if (!ent.isDirectory()) continue
    if (SYSTEM_FILES.has(ent.name.toLowerCase())) continue
    const topPath = join(tempDir, ent.name)
    const topImageCount = await countImagesInDir(topPath)
    const subEntries = (await readdir(topPath, { withFileTypes: true }))
      .filter(e => e.isDirectory() && !SYSTEM_FILES.has(e.name.toLowerCase()))

    const subFolders = []
    for (const sub of subEntries) {
      const subPath = join(topPath, sub.name)
      const subImageCount = await countImagesInDir(subPath)
      // 子文件夹的完整相对路径（如 images/product01），统一使用正斜杠
      const subRelPath = `${ent.name}/${sub.name}`
      subFolders.push({
        folder_name: sub.name,
        full_path: subRelPath,
        parent_folder: ent.name,
        image_count: subImageCount,
        matched: previewRows.some(r => r.image_folder_name === sub.name),
      })
    }

    // 顶层文件夹是否被 Excel 直接引用
    const topMatched = previewRows.some(r => r.image_folder_name === ent.name)

    result.push({
      folder_name: ent.name,
      image_count: topImageCount,
      has_subfolders: subFolders.length > 0,
      matched: topMatched,
      sub_folders: subFolders,
    })
  }
  return result
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

// 在线表格批量新增：任意字段名（rows + images_0、images_1…），每张图片不超过 5MB
const onlineUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 200 } })

// ── 工具函数 ──────────────────────────────────────────

// ZIP 解析：使用成熟的 adm-zip 库（支持 stored / deflate 及常见压缩工具生成的压缩包）
// 返回条目元数据数组；getData() 按需解压单个条目，避免一次性解压全部内容
function parseZipEntries(buffer) {
  const archive = new AdmZip(buffer) // ZIP 非法或损坏时抛出异常
  return archive.getEntries().map(entry => {
    const name = entry.entryName.replace(/\\/g, '/') // 统一路径分隔符为正斜杠
    return {
      name,
      isDirectory: entry.isDirectory,
      compressedSize: entry.header.compressedSize,
      uncompressedSize: entry.header.size,
      getData: () => entry.getData(),
    }
  })
}

// 解压单个条目（返回 Buffer）；buffer 参数仅为兼容旧调用保留
function extractZipEntry(_buffer, entry) {
  const data = entry.getData()
  if (!Buffer.isBuffer(data)) return Buffer.from(data)
  return data
}

// ── 模板下载（读取静态文件 public/assets/Products.xlsx） ─────────
const TEMPLATE_FILE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'assets', 'Products.xlsx'
)

router.get('/import-template', async (req, res, next) => {
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

    // 校验 Excel 文件大小
    if (excelFile.size > MAX_EXCEL_SIZE) {
      return res.status(400).json({ success: false, message: 'Excel 文件不能超过 10MB' })
    }

    // zip 用于匹配商品的图片文件夹（Excel 的“图片文件夹名称”为必填）
    let zipEntries = []
    if (zipFile) {
      // 校验压缩包文件名
      if (zipFile.originalname !== 'images.zip') {
        return res.status(400).json({ success: false, message: '请将压缩包命名为 images.zip 后重新上传' })
      }

      // 校验 zip 文件完整性并获取条目列表
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

    // 解析 zip 目录结构：保留原始目录结构解压
    // 支持任意嵌套层级的 ZIP，如：
    //   images/product01/1.jpg  → 解压到 tempDir/images/product01/1.jpg
    //   product01/1.jpg         → 解压到 tempDir/product01/1.jpg
    // 前端通过两层级浏览：先看到顶层文件夹(如 images)，进入后看到子文件夹(product01, product02)
    // 注意：ZIP 规范要求使用正斜杠 / 作为路径分隔符，但某些 Windows 压缩工具可能使用反斜杠 \
    const zipEntriesToExtract = []
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue
      // 统一将反斜杠转为正斜杠，确保路径分隔一致
      const normalizedName = entry.name.replace(/\\/g, '/')
      const parts = normalizedName.split('/')
      if (parts.length < 2) continue // 不在子文件夹中，跳过

      const fileName = parts[parts.length - 1]
      const ext = '.' + fileName.split('.').pop().toLowerCase()

      // 过滤系统文件和非图片格式
      if (SYSTEM_FILES.has(fileName.toLowerCase())) continue
      if (!VALID_IMAGE_EXTS.has(ext)) continue

      // 收集所有层级的图片（支持任意嵌套深度），使用规范化后的路径
      zipEntriesToExtract.push({ entry, relPath: normalizedName, baseName: fileName, ext })
    }

    // 生成批次
    batchId = randomUUID()
    tempDir = join(uploadRoot(), 'import-temp', batchId)

    // 解压图片到临时目录（保留原始目录结构）
    await mkdir(tempDir, { recursive: true })
    if (zipFile) {
      for (const item of zipEntriesToExtract) {
        const fileData = await extractZipEntry(zipFile.buffer, item.entry)
        // 验证文件头（magic number）
        const detected = detectImageType(fileData)
        if (!detected) continue // magic number 不匹配，跳过
        // 创建子目录结构（保留 ZIP 内的原始路径）
        const destPath = join(tempDir, item.relPath)
        const destDir = resolve(destPath, '..')
        await mkdir(destDir, { recursive: true })
        await writeFile(destPath, fileData)
      }
    }

    // 逐行解析商品并校验
    const previewRows = []
    let successCount = 0
    let failCount = 0

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx]
      const excelRowNum = rowIdx + 2 // +2: 1-based + header row
      // 按新模板列序取值（已去掉「商品编号(SKU)」列，由预览页生成）：
      // 0=商品名称 1=分类名称 2=是否支持定制 3=商品评分 4=售价 5=原价 6=库存 7=单位（件/盒） 8=生产厂家 9=品牌 10=描述 11=图片文件夹名称
      const name = String(row[0] || '').trim()
      const categoryName = String(row[1] || '').trim()
      const isCustomizableStr = String(row[2] || '').trim()
      const ratingStr = String(row[3] || '').trim()
      const priceStr = String(row[4] || '').trim()
      const originalPriceStr = String(row[5] || '').trim()
      const stockStr = String(row[6] || '').trim()
      const unit = String(row[7] || '').trim()
      const manufacturer = String(row[8] || '').trim()
      const brand = String(row[9] || '').trim()
      const description = String(row[10] || '').trim()
      const imageFolderName = String(row[11] || '').trim()

      const errors = []

      // 必填校验
      if (!name) errors.push('商品名称为空')
      if (!categoryName) errors.push('分类名称为空')
      if (!priceStr) errors.push('售价为空')
      if (!stockStr) errors.push('库存为空')
      // 图片文件夹名称必填：留空则该行判定失败
      if (!imageFolderName) errors.push('图片文件夹名称不能为空')

      // 数值校验
      let price = null
      if (priceStr) {
        price = Number(priceStr)
        if (!Number.isFinite(price) || price < 0) errors.push('售价格式不正确')
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

      // 商品编号(SKU)：模板中不再包含该列，统一由管理员在预览页点击「生成」按钮写入；
      // 此处初始为空，若确认导入时仍未生成，会由后端按新算法兜底生成
      let sku = null

      // 是否支持定制：值只能为'是'/'否'（留空视为'否'）
      let isCustomizable = 0
      if (isCustomizableStr) {
        if (isCustomizableStr === '是') isCustomizable = 1
        else if (isCustomizableStr === '否') isCustomizable = 0
        else errors.push(`是否支持定制填写不正确，请填写'是'或'否'`)
      }

      // 商品评分：留空默认 5；非数字或超出 0~5 才判失败，其余一律就近取整到 0.5 的倍数
      const ratingResult = normalizeRating(ratingStr)
      let rating = 5
      if (!ratingResult.valid) {
        errors.push('商品评分格式不正确，应为0-5之间的数字')
      } else {
        rating = ratingResult.rating
      }

      // 分类必须已存在（status=1），不存在则该行判定失败，不会自动创建
      let categoryId = null
      if (categoryName) {
        if (categoryMap.has(categoryName)) {
          categoryId = categoryMap.get(categoryName)
        } else {
          errors.push(`分类不存在：${categoryName}`)
        }
      }

      // 图片文件夹匹配：在临时目录中递归查找名称匹配的文件夹
      // 支持 images/product01/1.jpg 这样的嵌套结构
      // Excel 中填写的文件夹名称（如 product01）会在所有层级中搜索匹配
      let imageFiles = []
      if (imageFolderName) {
        if (!zipFile) {
          // 未上传 zip，无法找到对应文件夹，判定为失败
          errors.push(`未找到图片文件夹：${imageFolderName}`)
        } else {
          const normalizedFolder = imageFolderName.trim()
          const folderPath = join(tempDir, normalizedFolder)
          const safePath = relative(tempDir, folderPath)
          if (safePath.startsWith('..') || safePath === '') {
            errors.push(`图片文件夹路径非法：${imageFolderName}`)
          } else if (existsSync(folderPath)) {
            // 直接匹配成功（product01/ 直接在 tempDir 下）
            const filesInDir = await readdir(folderPath)
            imageFiles = filesInDir
              .filter(f => {
                const ext = '.' + f.split('.').pop().toLowerCase()
                return VALID_IMAGE_EXTS.has(ext) && !SYSTEM_FILES.has(f.toLowerCase())
              })
              .sort((a, b) => naturalCompare(a, b))
              .map(f => `${normalizedFolder}/${f}`)
            if (!imageFiles.length) {
              errors.push(`图片文件夹"${imageFolderName}"中没有有效的图片文件`)
            }
          } else {
            // 在嵌套子目录中递归查找匹配的文件夹
            const foundPath = await findFolderByName(tempDir, normalizedFolder)
            if (foundPath) {
              const relFound = relative(tempDir, foundPath).replace(/\\/g, '/')
              const foundFiles = await readdir(foundPath)
              imageFiles = foundFiles
                .filter(f => {
                  const ext = '.' + f.split('.').pop().toLowerCase()
                  return VALID_IMAGE_EXTS.has(ext) && !SYSTEM_FILES.has(f.toLowerCase())
                })
                .sort((a, b) => naturalCompare(a, b))
                .map(f => `${relFound}/${f}`)
              if (!imageFiles.length) {
                errors.push(`图片文件夹"${imageFolderName}"中没有有效的图片文件`)
              }
            } else {
              errors.push(`未找到图片文件夹：${imageFolderName}`)
            }
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
        is_new_category: false,
        price: price !== null ? Number(price) : null,
        original_price: originalPrice !== null ? Number(originalPrice) : null,
        stock: stock !== null ? Number(stock) : null,
        unit: unit || null,
        manufacturer: manufacturer || null,
        brand: brand || null,
        sku,
        sku_auto_generated: false,
        is_customizable: isCustomizable,
        rating,
        description: description || null,
        image_folder_name: imageFolderName || '(无图片)',
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

    // 收集临时目录中的文件夹结构（两层：顶层文件夹 → 子文件夹列表）
    const tempFolders = zipFile ? await collectFolderStructure(tempDir, previewRows) : []

    res.json({
      success: true,
      data: {
        batchId,
        total_count: dataRows.length,
        success_count: successCount,
        fail_count: failCount,
        folders: tempFolders,
        preview: publicPreviewRows(previewRows),
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

// ── 导入失败补偿 ──────────────────────────────────────
// 删除本请求已创建的商品行（product_image 由外键 ON DELETE CASCADE 一并清理；
// 新建商品不会有订单/购物车引用）及其已生成的图片目录
async function discardCreatedProducts(productIds) {
  if (!productIds.length) return
  try {
    await db.execute(`DELETE FROM product WHERE id IN (${productIds.map(() => '?').join(',')})`, productIds)
  } catch (error) {
    console.error('导入补偿：删除已创建商品失败', error)
  }
  for (const pid of productIds) {
    try { await storageService.deleteDirectory(`products/${pid}`) } catch {}
  }
}

// 删除本请求新建的分类（调用前需先 discardCreatedProducts，避免外键引用残留）
async function discardCreatedCategories(categoryIds) {
  if (!categoryIds.length) return
  try {
    await db.execute(`DELETE FROM category WHERE id IN (${categoryIds.map(() => '?').join(',')})`, categoryIds)
  } catch (error) {
    console.error('导入补偿：删除已创建分类失败', error)
  }
}

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

  // 再次验证分类（防止预览后分类被删除）；严格模式下不自动创建分类
  const categoryNames = [...new Set(successRows.map(r => r.category_name))]
  const [existingCats] = await db.execute(`SELECT id, name FROM category WHERE name IN (${categoryNames.map(() => '?').join(',')}) AND status = 1`, categoryNames)
  const categoryMap = new Map(existingCats.map(c => [c.name, c.id]))
  const missingNames = categoryNames.filter(name => !categoryMap.has(name))
  if (missingNames.length) {
    return res.status(400).json({ success: false, message: `分类不存在：${missingNames[0]}，请先在后台创建该分类后重新导入` })
  }

  // ── 写入阶段：拆成「两段纯 DB 事务 + 中间不持锁搬移文件」──
  // 图片最终路径 /uploads/products/<productId>/… 依赖 productId，必须先插入商品行
  // 才能确定目录，无法像 products.js 的补图接口那样在事务前就拿到最终路径。
  // 因此改为：事务一（纯 DB）领取批次并创建商品行（暂不上架）→ 不持锁把临时
  // 图片 rename 进各自商品目录 → 事务二（纯 DB）写图片记录并统一上架。
  // 两段事务都只含数据库写入（毫秒级持锁），mkdir/rename 等慢速 I/O 全部发生在
  // 事务之外，不会长时间阻塞其它请求的事务（如顾客下单）。
  // 商品先以 status=0 落库（前台列表/详情均过滤 status=1，全程不可见），
  // 图片就位后在事务二统一上架，避免搬移期间前台出现"有商品没图片"的空档。
  const connection = await db.getConnection()
  const createdProductIds = []
  try {
    await connection.beginTransaction()

    // 领取批次：条件更新作为防重入闸门。事务互斥锁引入后，重复点击「确认导入」
    // 会排队而不是报错，若不在这里挡下，两次确认会导入两份商品。
    // 失败路径会连同批次记录一起清理，不会残留中间态。
    const [claim] = await connection.execute(
      "UPDATE import_batch SET status = 'confirmed' WHERE id = ? AND status = 'pending'",
      [batchId]
    )
    if (!claim.affectedRows) {
      throw Object.assign(new Error('该批次已确认或正在导入中，请勿重复提交'), { status: 409 })
    }

    for (const row of successRows) {
      const categoryId = categoryMap.get(row.category_name)
      // 所见即所存：预览阶段已为每行生成并展示最终编号，确认时原样落库（不查重、不更换）
      // 兜底：升级前遗留的 pending 批次行 sku 可能为空 → 按同一算法现场补一个
      const sku = row.sku || generateSkuCode(req.admin.username)
      row.sku = sku
      const isCustomizable = row.is_customizable === 1 || row.is_customizable === true ? 1 : 0
      const ratingResult = normalizeRating(row.rating)
      const rating = ratingResult.valid ? ratingResult.rating : 5

      // 插入 product：status 先落 0（下架），事务二图片就位后再上架
      const [productResult] = await connection.execute(
        'INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status, sku, is_customizable, rating, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)',
        [row.name, categoryId, row.price, row.original_price, row.stock, row.unit || null, row.manufacturer || null, row.brand || null, row.description || null, sku, isCustomizable, rating, req.admin.id, req.admin.real_name || req.admin.username]
      )
      createdProductIds.push(productResult.insertId)
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    // 唯一约束兜底：作为最后一道防线，遇到商品编号冲突时给出清晰提示而不是 500
    // （此时领取已随事务回滚、批次仍为 pending、临时图片未动，修正编号后可直接重试）
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({ success: false, message: '商品编号已存在，请重试' })
    }
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message })
    }
    next(error)
    return
  } finally {
    connection.release()
  }

  // ── 搬移图片（不持事务锁）：临时图片 rename 进各自商品的最终目录 ──
  try {
    for (let i = 0; i < successRows.length; i++) {
      const row = successRows[i]
      const productId = createdProductIds[i]
      const productDir = join(uploadRoot(), 'products', String(productId))
      await mkdir(productDir, { recursive: true })

      row.image_urls = []
      for (let imgIdx = 0; imgIdx < row.image_files.length; imgIdx++) {
        const tempImageRelPath = row.image_files[imgIdx] // relative to tempDir, e.g. "folderName/1.jpg"
        const tempAbsPath = join(batch.temp_dir, tempImageRelPath)

        // 生成 UUID 文件名
        const ext = '.' + tempImageRelPath.split('.').pop().toLowerCase()
        const uuidName = randomUUID() + ext
        await rename(tempAbsPath, join(productDir, uuidName))

        row.image_urls.push(`/uploads/products/${productId}/${uuidName}`)
      }
    }
  } catch (error) {
    // 补偿：商品行尚未写图片记录也未上架，删除后前台无感知；
    // 临时图片已被搬走一部分、批次无法重试，直接清理并要求重新上传
    await discardCreatedProducts(createdProductIds)
    await cleanupBatch(batch.id, batch.temp_dir)
    next(error)
    return
  }

  // ── 事务二（纯 DB）：写入图片记录、设置主图并统一上架 ──
  const finalizeConnection = await db.getConnection()
  try {
    await finalizeConnection.beginTransaction()
    for (let i = 0; i < successRows.length; i++) {
      const row = successRows[i]
      const productId = createdProductIds[i]
      for (let imgIdx = 0; imgIdx < row.image_urls.length; imgIdx++) {
        await finalizeConnection.execute(
          'INSERT INTO product_image (product_id, image_url, is_main, sort_order) VALUES (?, ?, ?, ?)',
          [productId, row.image_urls[imgIdx], imgIdx === 0 ? 1 : 0, imgIdx]
        )
      }
      // 无图片时使用默认占位图
      const mainImageUrl = row.image_urls[0] || '/assets/images/products/product-placeholder.svg'
      await finalizeConnection.execute('UPDATE product SET main_image = ?, status = 1 WHERE id = ?', [mainImageUrl, productId])
    }
    await finalizeConnection.commit()
  } catch (error) {
    await finalizeConnection.rollback()
    await discardCreatedProducts(createdProductIds)
    await cleanupBatch(batch.id, batch.temp_dir)
    next(error)
    return
  } finally {
    finalizeConnection.release()
  }

  // 清理临时目录
  await cleanupTempDir(batch.temp_dir)

  await writeOperationLog(req.admin.id, 'import_products', `批量导入商品：成功${successRows.length}条`, req)

  res.json({
    success: true,
    data: {
      imported_count: successRows.length,
      product_ids: createdProductIds,
      sku_replacements: [],
    },
  })
})

// ── 文件夹重命名接口 ──────────────────────────────────
// 支持重命名子文件夹（如 images/product01 → images/product01_renamed）
// 参数：
//   parent_folder: 父文件夹名称（如 "images"），如果为空则重命名顶层文件夹
//   old_name: 原文件夹名称（不含父级路径）
//   new_name: 新文件夹名称（不含父级路径）
router.post('/import/:batchId/rename-folder', async (req, res, next) => {
  try {
    const { batchId } = req.params
    const { parent_folder, old_name, new_name } = req.body

    if (!old_name || typeof old_name !== 'string' || !old_name.trim()) {
      return res.status(400).json({ success: false, message: '原文件夹名称不能为空' })
    }
    if (!new_name || typeof new_name !== 'string' || !new_name.trim()) {
      return res.status(400).json({ success: false, message: '新文件夹名称不能为空' })
    }

    const oldName = old_name.trim()
    const newName = new_name.trim()
    const parentFolder = (parent_folder || '').trim()

    // 防止路径遍历：文件夹名不能包含 / \ ..
    const checkName = (name) => name.includes('/') || name.includes('\\') || name.includes('..')
    if (checkName(oldName) || checkName(newName) || checkName(parentFolder)) {
      return res.status(400).json({ success: false, message: '文件夹名称不能包含特殊字符' })
    }

    if (oldName === newName) {
      return res.status(400).json({ success: false, message: '新文件夹名称与原名称相同' })
    }

    // 查找批次
    const [batches] = await db.execute('SELECT id, temp_dir, status, preview_data, expires_at FROM import_batch WHERE id = ?', [batchId])
    const batch = batches[0]
    if (!batch) return res.status(404).json({ success: false, message: '导入批次不存在' })
    if (batch.status !== 'pending') return res.status(400).json({ success: false, message: '该批次已处理，无法重命名' })
    if (new Date(batch.expires_at) < new Date()) {
      await cleanupBatch(batch.id, batch.temp_dir)
      return res.status(410).json({ success: false, message: '导入批次已过期，请重新上传' })
    }

    const tempDir = batch.temp_dir

    // 计算旧路径和新路径（支持嵌套：parent_folder/old_name）
    // 计算旧路径和新路径（支持嵌套：parent_folder/old_name）
    // 使用正斜杠拼接，确保与 image_files 中的路径格式一致
    const oldRelPath = parentFolder ? `${parentFolder}/${oldName}` : oldName
    const newRelPath = parentFolder ? `${parentFolder}/${newName}` : newName
    const oldPath = join(tempDir, oldRelPath)
    const newPath = join(tempDir, newRelPath)

    // 安全校验
    const relOld = relative(tempDir, oldPath)
    const relNew = relative(tempDir, newPath)
    if (relOld.startsWith('..') || relOld === '' || relNew.startsWith('..') || relNew === '') {
      return res.status(400).json({ success: false, message: '文件夹路径非法' })
    }

    if (!existsSync(oldPath)) {
      return res.status(404).json({ success: false, message: `文件夹"${oldRelPath}"不存在` })
    }
    if (existsSync(newPath)) {
      return res.status(409).json({ success: false, message: `文件夹"${newRelPath}"已存在` })
    }

    // 执行重命名
    await rename(oldPath, newPath)

    // 更新预览数据
    let previewData
    try {
      previewData = typeof batch.preview_data === 'string' ? JSON.parse(batch.preview_data) : batch.preview_data
    } catch {
      return res.status(400).json({ success: false, message: '预览数据损坏，请重新上传' })
    }

    // image_files 中的路径是相对于 tempDir 的（如 "images/product01/1.jpg"）
    // 更新引用了旧文件夹名的行
    let updatedCount = 0
    for (const row of previewData) {
      // 检查该行的 image_files 是否有路径以 oldRelPath 开头
      if (row.image_files && Array.isArray(row.image_files)) {
        const hasOldPath = row.image_files.some(f => {
          const parts = f.split('/')
          const relParts = oldRelPath.split('/')
          return parts.length >= relParts.length &&
            relParts.every((rp, i) => parts[i] === rp)
        })
        if (hasOldPath) {
          row.image_files = row.image_files.map(f => {
            const parts = f.split('/')
            const relParts = oldRelPath.split('/')
            if (parts.length >= relParts.length &&
              relParts.every((rp, i) => parts[i] === rp)) {
              const newParts = [...newRelPath.split('/'), ...parts.slice(relParts.length)]
              return newParts.join('/')
            }
            return f
          })
          // 更新 image_folder_name 为新名称（只取最后一级文件夹名）
          row.image_folder_name = newName
          updatedCount++
        }
      }
    }

    // 如果有原本因"未找到图片文件夹"而失败的行，检查重命名后是否能匹配
    for (const row of previewData) {
      if (!row.success && row.errors) {
        const folderNotFoundIdx = row.errors.findIndex(e => e.includes('未找到图片文件夹'))
        if (folderNotFoundIdx !== -1 && row.image_folder_name === newName) {
          // 递归查找匹配的文件夹
          const foundPath = await findFolderByName(tempDir, newName)
          if (foundPath) {
            const relFound = relative(tempDir, foundPath).replace(/\\/g, '/')
            const filesInDir = await readdir(foundPath)
            const imageFiles = filesInDir
              .filter(f => {
                const ext = '.' + f.split('.').pop().toLowerCase()
                return VALID_IMAGE_EXTS.has(ext) && !SYSTEM_FILES.has(f.toLowerCase())
              })
              .sort((a, b) => naturalCompare(a, b))
              .map(f => `${relFound}/${f}`)

            if (imageFiles.length > 0) {
              row.image_files = imageFiles
              row.image_count = imageFiles.length
              row.errors.splice(folderNotFoundIdx, 1)
              if (row.errors.length === 0) {
                row.success = true
                delete row.errors
              }
            }
          }
        }
      }
    }

    // 重新计算成功/失败数
    const newSuccessCount = previewData.filter(r => r.success).length
    const newFailCount = previewData.filter(r => !r.success).length

    await db.execute(
      'UPDATE import_batch SET preview_data = ?, success_count = ?, fail_count = ? WHERE id = ?',
      [JSON.stringify(previewData), newSuccessCount, newFailCount, batchId]
    )

    // 收集更新后的文件夹结构（两层）
    const folders = await collectFolderStructure(tempDir, previewData)

    res.json({
      success: true,
      data: {
        renamed: { old_name: oldRelPath, new_name: newRelPath },
        updated_rows: updatedCount,
        success_count: newSuccessCount,
        fail_count: newFailCount,
        folders,
        preview: publicPreviewRows(previewData),
      },
    })
  } catch (error) {
    next(error)
  }
})

// ── 导入批次公共工具 ────────────────────────────────────
// 读取 pending 状态的批次及其预览数据；不存在/已处理/已过期/数据损坏时抛出带 status 的错误
async function getPendingBatchPreview(batchId) {
  const [batches] = await db.execute('SELECT id, temp_dir, status, preview_data, expires_at FROM import_batch WHERE id = ?', [batchId])
  const batch = batches[0]
  if (!batch) throw Object.assign(new Error('导入批次不存在'), { status: 404 })
  if (batch.status !== 'pending') throw Object.assign(new Error('该批次已处理，请重新上传'), { status: 400 })
  if (new Date(batch.expires_at) < new Date()) {
    await cleanupBatch(batch.id, batch.temp_dir)
    throw Object.assign(new Error('导入批次已过期，请重新上传'), { status: 410 })
  }
  let previewData
  try {
    previewData = typeof batch.preview_data === 'string' ? JSON.parse(batch.preview_data) : batch.preview_data
  } catch {
    throw Object.assign(new Error('预览数据损坏，请重新上传'), { status: 400 })
  }
  return { batch, previewData }
}

// 统一输出预览行字段，供前端复用"合并预览结果"逻辑
function publicPreviewRows(previewData) {
  return previewData.map(r => ({
    row: r.row,
    name: r.name,
    category_name: r.category_name,
    is_new_category: r.is_new_category,
    sku: r.sku,
    sku_auto_generated: r.sku_auto_generated,
    is_customizable: r.is_customizable,
    rating: r.rating,
    price: r.price,
    original_price: r.original_price,
    stock: r.stock,
    unit: r.unit,
    manufacturer: r.manufacturer,
    brand: r.brand,
    description: r.description,
    image_count: r.image_count,
    image_folder_name: r.image_folder_name,
    success: r.success,
    errors: r.errors,
  }))
}

// 写回预览数据并重新计算成功/失败数
async function saveBatchPreview(batchId, previewData) {
  const successCount = previewData.filter(r => r.success).length
  const failCount = previewData.filter(r => !r.success).length
  await db.execute(
    'UPDATE import_batch SET preview_data = ?, success_count = ?, fail_count = ? WHERE id = ?',
    [JSON.stringify(previewData), successCount, failCount, batchId]
  )
  return { success_count: successCount, fail_count: failCount, preview: publicPreviewRows(previewData) }
}

// ── 一键创建缺失分类接口 ────────────────────────────────
// 在预览阶段，若某行失败原因为「分类不存在：xxx」，管理员可点击「添加分类」直接创建该分类；
// 创建后自动移除本批次所有相关行的该错误，并重新计算成功/失败数。
router.post('/import/:batchId/create-category', async (req, res, next) => {
  try {
    const { batchId } = req.params
    const categoryName = String(req.body.category_name || '').trim()

    if (!categoryName) {
      return res.status(400).json({ success: false, message: '分类名称不能为空' })
    }

    const [batches] = await db.execute('SELECT id, temp_dir, status, preview_data, expires_at FROM import_batch WHERE id = ?', [batchId])
    const batch = batches[0]
    if (!batch) return res.status(404).json({ success: false, message: '导入批次不存在' })
    if (batch.status !== 'pending') return res.status(400).json({ success: false, message: '该批次已处理，无法创建分类' })
    if (new Date(batch.expires_at) < new Date()) {
      await cleanupBatch(batch.id, batch.temp_dir)
      return res.status(410).json({ success: false, message: '导入批次已过期，请重新上传' })
    }

    // 统一校验规则（与 categories.js 的 categoryBody 一致：trim + 1~50 字符）
    let name
    try {
      name = requiredText(categoryName, '分类名称', { min: 1, max: 50 })
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, message: error.message })
    }

    // 同名分类处理（category 表 UNIQUE(parent_id, name) 不区分 status）：
    //  - 已启用 → 直接复用，视为创建成功
    //  - 已禁用 → 重新启用并复用（管理员的诉求是"让这个分类名可用"），避免插入时报唯一约束错误
    const [[existing]] = await db.execute('SELECT id, status FROM category WHERE name = ? AND parent_id = 0', [name])
    if (existing) {
      if (!existing.status) {
        await db.execute("UPDATE category SET status = 1, updated_at = datetime('now') WHERE id = ?", [existing.id])
        await writeOperationLog(req.admin.id, 'update_category', `${name}（批量导入时重新启用）`, req)
      }
    } else {
      try {
        const [[{ maxSort }]] = await db.execute('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM category')
        await db.execute(
          'INSERT INTO category (name, parent_id, sort_order, status, created_by, created_by_name) VALUES (?, 0, ?, 1, ?, ?)',
          [name, maxSort + 1, req.admin.id, req.admin.real_name || req.admin.username]
        )
        await writeOperationLog(req.admin.id, 'create_category', name, req)
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) {
          return res.status(409).json({ success: false, message: '同一父级下已存在该分类名称' })
        }
        throw error
      }
    }

    // 更新预览数据：移除所有相关行的「分类不存在」错误
    let previewData
    try {
      previewData = typeof batch.preview_data === 'string' ? JSON.parse(batch.preview_data) : batch.preview_data
    } catch {
      return res.status(400).json({ success: false, message: '预览数据损坏，请重新上传' })
    }

    const targetError = `分类不存在：${name}`
    let updatedCount = 0
    for (const row of previewData) {
      if (row.category_name === name && row.errors && row.errors.length) {
        const idx = row.errors.indexOf(targetError)
        if (idx !== -1) {
          row.errors.splice(idx, 1)
          updatedCount++
          if (row.errors.length === 0) {
            row.success = true
            delete row.errors
          }
        }
      }
    }

    const newSuccessCount = previewData.filter(r => r.success).length
    const newFailCount = previewData.filter(r => !r.success).length

    await db.execute(
      'UPDATE import_batch SET preview_data = ?, success_count = ?, fail_count = ? WHERE id = ?',
      [JSON.stringify(previewData), newSuccessCount, newFailCount, batchId]
    )

    res.json({
      success: true,
      data: {
        created_name: name,
        updated_rows: updatedCount,
        success_count: newSuccessCount,
        fail_count: newFailCount,
        preview: publicPreviewRows(previewData),
      },
    })
  } catch (error) {
    next(error)
  }
})

// ── 为单行生成 / 手动修改商品编号 ────────────────────────
// 参数 row 为 Excel 行号（preview_data 里的 row 字段，不是数组下标）
// body 携带非空 sku 时按管理员提交值保存（所见即所存）；否则按同一算法重新生成
router.put('/import/:batchId/rows/:row/sku', async (req, res, next) => {
  try {
    const { batchId } = req.params
    const { previewData } = await getPendingBatchPreview(batchId)
    const rowNum = Number(req.params.row)
    const row = previewData.find(r => r.row === rowNum)
    if (!row) return res.status(404).json({ success: false, message: '未找到对应的商品行' })

    const manual = String(req.body?.sku || '').trim().slice(0, 64)
    row.sku = manual || generateSkuCode(req.admin.username)

    const result = await saveBatchPreview(batchId, previewData)
    res.json({ success: true, data: { row: rowNum, sku: row.sku, ...result } })
  } catch (error) {
    next(error)
  }
})

// ── 一键为全部缺失编号的行生成商品编号 ──────────────────
router.post('/import/:batchId/generate-skus', async (req, res, next) => {
  try {
    const { batchId } = req.params
    const { previewData } = await getPendingBatchPreview(batchId)

    let generated = 0
    for (const row of previewData) {
      if (row.sku) continue
      row.sku = generateSkuCode(req.admin.username)
      generated++
    }

    const result = await saveBatchPreview(batchId, previewData)
    res.json({ success: true, data: { generated, ...result } })
  } catch (error) {
    next(error)
  }
})

// ── 删除预览中的某一行 ──────────────────────────────────
// 管理员在确认导入前剔除不需要的记录：从 preview_data 移除并重算成功/失败数。
// 行对应的临时图片不单独清理（保留在临时目录，批次结束时随目录一并清理）。
router.delete('/import/:batchId/rows/:row', async (req, res, next) => {
  try {
    const { batchId } = req.params
    const { previewData } = await getPendingBatchPreview(batchId)
    const rowNum = Number(req.params.row)
    const index = previewData.findIndex(r => r.row === rowNum)
    if (index === -1) return res.status(404).json({ success: false, message: '未找到对应的商品行' })

    previewData.splice(index, 1)
    const result = await saveBatchPreview(batchId, previewData)
    res.json({ success: true, data: { row: rowNum, ...result } })
  } catch (error) {
    next(error)
  }
})

// 确保分类存在：不存在则新建；同名但已禁用则重新启用复用（与 /import/:batchId/create-category 规则保持一致）
// 返回 { id, created }；executor 为 db.execute.bind(db) 或事务内 connection.execute.bind(connection)
async function ensureCategory(executor, name, adminId, adminName) {
  const [rows] = await executor('SELECT id, status FROM category WHERE name = ? AND parent_id = 0', [name])
  if (rows[0]) {
    if (!rows[0].status) {
      await executor("UPDATE category SET status = 1, updated_at = datetime('now') WHERE id = ?", [rows[0].id])
    }
    return { id: rows[0].id, created: false }
  }
  const [[{ maxSort }]] = await executor('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM category')
  try {
    const [result] = await executor(
      'INSERT INTO category (name, parent_id, sort_order, status, created_by, created_by_name) VALUES (?, 0, ?, 1, ?, ?)',
      [name, maxSort + 1, adminId, adminName]
    )
    return { id: result.insertId, created: true }
  } catch (error) {
    // 并发下可能已被其它请求创建，回查复用
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) {
      const [again] = await executor('SELECT id FROM category WHERE name = ? AND parent_id = 0', [name])
      if (again[0]) return { id: again[0].id, created: false }
    }
    throw error
  }
}

// ── 在线表格批量新增（事务型，全部校验通过才写库） ──────
// 请求：multipart/form-data
//   rows：JSON 字符串数组，每行文本字段（不接受 status，统一按上架创建）
//   images_<下标>：该行对应的图片文件（同一字段名可重复携带多张）
router.post('/import/online', onlineUpload.any(), async (req, res, next) => {
  try {
    let rows
    try {
      rows = JSON.parse(req.body.rows || '[]')
    } catch {
      return res.status(400).json({ success: false, message: '提交数据格式不正确' })
    }
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ success: false, message: '请至少添加一行商品' })
    if (rows.length > 200) return res.status(400).json({ success: false, message: '单次最多新增 200 个商品' })

    // 图片按字段名分组：images_0 → 第 0 行（数组下标）
    const filesByIndex = new Map()
    for (const file of req.files || []) {
      const match = /^images_(\d+)$/.exec(file.fieldname)
      if (!match) continue
      const idx = Number(match[1])
      if (!filesByIndex.has(idx)) filesByIndex.set(idx, [])
      filesByIndex.get(idx).push(file)
    }

    // ── 校验阶段：全部校验通过才进入写库，不边校验边插入 ──
    const [categories] = await db.execute('SELECT id, name FROM category WHERE status = 1')
    const categoryMap = new Map(categories.map(c => [c.name, c.id]))
    const prepared = []

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {}
      const errors = []

      const name = String(raw.name || '').trim()
      if (!name) errors.push('商品名称为空')
      else if (name.length > 200) errors.push('商品名称不能超过 200 个字符')

      const categoryName = String(raw.category_name || '').trim()
      let categoryId = null
      if (!categoryName) errors.push('分类不能为空')
      else if (categoryName.length > 50) errors.push('分类名称不能超过 50 个字符')
      else if (categoryMap.has(categoryName)) categoryId = categoryMap.get(categoryName)
      // 系统不存在的分类：允许在线表格先行录入（前端需经「添加」确认），提交写库时再真正创建

      let price = null
      if (raw.price === '' || raw.price === null || raw.price === undefined) errors.push('售价不能为空')
      else {
        price = Number(raw.price)
        if (!Number.isFinite(price) || price < 0) errors.push('售价格式不正确')
      }

      let originalPrice = null
      if (raw.original_price !== '' && raw.original_price !== null && raw.original_price !== undefined) {
        originalPrice = Number(raw.original_price)
        if (!Number.isFinite(originalPrice) || originalPrice < 0) errors.push('原价格式不正确')
      }
      if (originalPrice !== null && price !== null && originalPrice < price) errors.push('原价不能低于售价')

      let stock = null
      if (raw.stock === '' || raw.stock === null || raw.stock === undefined) errors.push('库存不能为空')
      else {
        stock = Number(raw.stock)
        if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) errors.push('库存必须是非负整数')
      }

      const ratingResult = normalizeRating(raw.rating)
      if (!ratingResult.valid) errors.push('商品评分格式不正确，应为0-5之间的数字')

      const files = []
      for (const file of filesByIndex.get(i) || []) {
        try {
          storageService.validateImage(file)
          files.push(file)
        } catch (error) {
          errors.push(error.message)
        }
      }

      // SKU：所见即所存，直接采用前端提交值（在线表格已按同一算法生成并展示）；为空时按算法兜底
      const sku = String(raw.sku || '').trim().slice(0, 64) || generateSkuCode(req.admin.username)

      prepared.push({
        index: i,
        name: name || `第 ${i + 1} 行`,
        categoryId,
        categoryName,
        price,
        original_price: originalPrice,
        stock,
        unit: String(raw.unit || '').trim().slice(0, 20) || null,
        manufacturer: String(raw.manufacturer || '').trim().slice(0, 100) || null,
        brand: String(raw.brand || '').trim().slice(0, 100) || null,
        description: String(raw.description || '').trim().slice(0, 5000) || null,
        is_customizable: [1, '1', true, 'true'].includes(raw.is_customizable) ? 1 : 0,
        rating: ratingResult.valid ? ratingResult.rating : 5,
        sku,
        files,
        errors,
      })
    }

    const failCount = prepared.filter(r => r.errors.length).length
    if (failCount) {
      return res.status(400).json({
        success: false,
        message: `有 ${failCount} 行未通过校验，请修正后重试`,
        data: {
          fail_count: failCount,
          rows: prepared.map(r => ({ index: r.index, sku: r.sku, errors: r.errors.length ? r.errors : undefined })),
        },
      })
    }

    // ── 写入阶段：拆成「两段纯 DB 事务 + 中间不持锁落盘」──
    // storageService.save 的最终路径依赖 productId，必须先插入商品行才能确定目录；
    // 事务一创建分类与商品行（暂不上架）→ 不持锁把图片写到最终目录 →
    // 事务二写图片记录并统一上架。慢速文件 I/O 全部移出事务、缩短持锁时间，
    // 与 products.js 图片接口"先落盘、再进事务写库"的原则一致。
    const connection = await db.getConnection()
    const createdProductIds = []
    const createdCategoryIds = []
    const createdCategoryNames = []
    const txCategoryIds = new Map() // 事务一内已解析/创建的「分类名 → id」，避免同名重复创建
    try {
      await connection.beginTransaction()
      for (const row of prepared) {
        // 分类不存在时在现场创建（仅在此刻才真正写库，前端在线表格只是标记「待创建」）
        let categoryId = row.categoryId
        if (!categoryId) {
          if (txCategoryIds.has(row.categoryName)) categoryId = txCategoryIds.get(row.categoryName)
          else {
            const ensured = await ensureCategory(connection.execute.bind(connection), row.categoryName, req.admin.id, req.admin.real_name || req.admin.username)
            categoryId = ensured.id
            txCategoryIds.set(row.categoryName, categoryId)
            if (ensured.created) {
              createdCategoryIds.push(categoryId)
              createdCategoryNames.push(row.categoryName)
            }
          }
        }
        // status 先落 0（下架），事务二图片就位后再上架，前台全程不可见半成品
        const [productResult] = await connection.execute(
          'INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status, sku, is_customizable, rating, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)',
          [row.name, categoryId, row.price, row.original_price, row.stock, row.unit, row.manufacturer, row.brand, row.description, row.sku, row.is_customizable, row.rating, req.admin.id, req.admin.real_name || req.admin.username]
        )
        createdProductIds.push(productResult.insertId)
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message || '')) {
        return res.status(409).json({ success: false, message: '商品编号已存在，请重试' })
      }
      throw error
    } finally {
      connection.release()
    }

    // ── 落盘（不持事务锁）：图片写入各自商品的最终目录，拿到最终 URL ──
    try {
      for (let i = 0; i < prepared.length; i++) {
        const row = prepared[i]
        const productId = createdProductIds[i]
        row.image_urls = []
        for (let imgIdx = 0; imgIdx < row.files.length; imgIdx++) {
          const imagePath = await storageService.save(row.files[imgIdx], `products/${productId}`)
          row.image_urls.push(imagePath)
        }
      }
    } catch (error) {
      // 补偿：删除商品行及其图片目录（目录删除已覆盖所有已落盘文件），再清掉本请求新建的分类
      await discardCreatedProducts(createdProductIds)
      await discardCreatedCategories(createdCategoryIds)
      throw error
    }

    // ── 事务二（纯 DB）：写入图片记录、设置主图并统一上架 ──
    const finalizeConnection = await db.getConnection()
    try {
      await finalizeConnection.beginTransaction()
      for (let i = 0; i < prepared.length; i++) {
        const row = prepared[i]
        const productId = createdProductIds[i]
        for (let imgIdx = 0; imgIdx < row.image_urls.length; imgIdx++) {
          await finalizeConnection.execute(
            'INSERT INTO product_image (product_id, image_url, is_main, sort_order) VALUES (?, ?, ?, ?)',
            [productId, row.image_urls[imgIdx], imgIdx === 0 ? 1 : 0, imgIdx]
          )
        }
        await finalizeConnection.execute('UPDATE product SET main_image = ?, status = 1 WHERE id = ?', [row.image_urls[0] || '/assets/images/products/product-placeholder.svg', productId])
      }
      await finalizeConnection.commit()
    } catch (error) {
      await finalizeConnection.rollback()
      await discardCreatedProducts(createdProductIds)
      await discardCreatedCategories(createdCategoryIds)
      throw error
    } finally {
      finalizeConnection.release()
    }

    await writeOperationLog(req.admin.id, 'import_products_online', `在线表格批量新增商品：成功${prepared.length}条${createdCategoryNames.length ? `（新建分类：${createdCategoryNames.join('、')}）` : ''}`, req)
    if (createdCategoryNames.length) {
      await writeOperationLog(req.admin.id, 'create_category', `${createdCategoryNames.join('、')}（在线表格批量新增时创建）`, req)
    }
    res.status(201).json({ success: true, data: { created_count: prepared.length, product_ids: createdProductIds, created_categories: createdCategoryNames } })
  } catch (error) {
    next(error)
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
        "SELECT id, temp_dir FROM import_batch WHERE status = 'pending' AND expires_at < datetime('now')"
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
