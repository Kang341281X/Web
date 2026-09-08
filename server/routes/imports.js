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

const router = Router()
router.use(requireAuth, requirePasswordChanged)

// ── 常量 ──────────────────────────────────────────────
const TEMPLATE_HEADERS = [
  '商品编号(SKU)', '商品名称', '分类名称', '价格', '原价', '库存',
  '单位（件/盒）', '生产厂家', '品牌', '是否支持定制', '商品评分', '描述', '图片文件夹名称'
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

// 自动生成唯一商品编号：SKU + 时间戳 + 6 位自增序号
// executor 默认走全局 db，事务内可传入 connection.execute 以兼容事务
let autoSkuSeq = 0
async function generateUniqueSku(executor = db.execute.bind(db)) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `SKU${Date.now()}${String(autoSkuSeq = (autoSkuSeq + 1) % 1000000).padStart(6, '0')}`
    const [rows] = await executor('SELECT id FROM product WHERE sku = ?', [candidate])
    if (!rows.length) return candidate
  }
  throw Object.assign(new Error('自动生成商品编号失败，请稍后重试'), { status: 500 })
}

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

    // 商品编号唯一性预查：数据库中已占用的 SKU + 本批次内部重复次数
    const batchSkuCount = new Map()
    for (const dataRow of dataRows) {
      const skuCell = String(dataRow[0] || '').trim()
      if (skuCell) batchSkuCount.set(skuCell, (batchSkuCount.get(skuCell) || 0) + 1)
    }
    const allSkuValues = [...batchSkuCount.keys()]
    const existingSkuSet = new Set()
    if (allSkuValues.length) {
      const [existingSkus] = await db.execute(`SELECT sku FROM product WHERE sku IN (${allSkuValues.map(() => '?').join(',')}) AND sku IS NOT NULL`, allSkuValues)
      for (const product of existingSkus) existingSkuSet.add(product.sku)
    }

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
      // 按新模板列序取值：0=商品编号 1=名称 2=分类 3=价格 4=原价 5=库存 6=单位 7=生产厂家 8=品牌 9=是否支持定制 10=商品评分 11=描述 12=图片文件夹
      const skuStr = String(row[0] || '').trim()
      const name = String(row[1] || '').trim()
      const categoryName = String(row[2] || '').trim()
      const priceStr = String(row[3] || '').trim()
      const originalPriceStr = String(row[4] || '').trim()
      const stockStr = String(row[5] || '').trim()
      const unit = String(row[6] || '').trim()
      const manufacturer = String(row[7] || '').trim()
      const brand = String(row[8] || '').trim()
      const isCustomizableStr = String(row[9] || '').trim()
      const ratingStr = String(row[10] || '').trim()
      const description = String(row[11] || '').trim()
      const imageFolderName = String(row[12] || '').trim()

      const errors = []

      // 必填校验
      if (!name) errors.push('商品名称为空')
      if (!categoryName) errors.push('分类名称为空')
      if (!priceStr) errors.push('价格为空')
      if (!stockStr) errors.push('库存为空')
      // 图片文件夹名称必填：留空则该行判定失败
      if (!imageFolderName) errors.push('图片文件夹名称不能为空')

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

      // 商品编号(SKU)：选填，最长 64 字符；须唯一（已被占用或本批次内部重复均判失败）
      let sku = null
      if (skuStr) {
        if (skuStr.length > 64) {
          errors.push('商品编号不能超过 64 个字符')
        } else if (existingSkuSet.has(skuStr)) {
          errors.push(`商品编号已存在：${skuStr}`)
        } else if ((batchSkuCount.get(skuStr) || 0) > 1) {
          errors.push(`商品编号已存在：${skuStr}`)
        } else {
          sku = skuStr
        }
      }

      // 是否支持定制：值只能为'是'/'否'（留空视为'否'）
      let isCustomizable = 0
      if (isCustomizableStr) {
        if (isCustomizableStr === '是') isCustomizable = 1
        else if (isCustomizableStr === '否') isCustomizable = 0
        else errors.push(`是否支持定制填写不正确，请填写'是'或'否'`)
      }

      // 商品评分：留空默认为 5；填写时需为 0~5 之间的数字（允许一位小数）
      let rating = 5
      if (ratingStr) {
        const numericRating = Number(ratingStr)
        const roundedRating = Number.isFinite(numericRating) ? Math.round(numericRating * 10) / 10 : NaN
        if (!Number.isFinite(numericRating) || numericRating < 0 || numericRating > 5 || Math.abs(numericRating - roundedRating) > 1e-9) {
          errors.push('商品评分格式不正确，应为0-5之间的数字')
        } else {
          rating = roundedRating
        }
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
        preview: previewRows.map(r => ({
          row: r.row,
          name: r.name,
          category_name: r.category_name,
          is_new_category: r.is_new_category,
          sku: r.sku,
          is_customizable: r.is_customizable,
          rating: r.rating,
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

  // 再次验证分类（防止预览后分类被删除）；严格模式下不自动创建分类
  const categoryNames = [...new Set(successRows.map(r => r.category_name))]
  const [existingCats] = await db.execute(`SELECT id, name FROM category WHERE name IN (${categoryNames.map(() => '?').join(',')}) AND status = 1`, categoryNames)
  const categoryMap = new Map(existingCats.map(c => [c.name, c.id]))
  const missingNames = categoryNames.filter(name => !categoryMap.has(name))
  if (missingNames.length) {
    return res.status(400).json({ success: false, message: `分类不存在：${missingNames[0]}，请先在后台创建该分类后重新导入` })
  }

  const connection = await db.getConnection()
  const createdProductIds = []
  try {
    await connection.beginTransaction()

    for (const row of successRows) {
      const categoryId = categoryMap.get(row.category_name)
      // SKU 留空的行在确认阶段自动生成唯一编号
      const sku = row.sku || await generateUniqueSku(connection.execute.bind(connection))
      const isCustomizable = row.is_customizable === 1 || row.is_customizable === true ? 1 : 0
      const rating = Number.isFinite(Number(row.rating)) ? Number(row.rating) : 5

      // 插入 product
      const [productResult] = await connection.execute(
        'INSERT INTO product (name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, status, sku, is_customizable, rating) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, 1, ?, ?, ?)',
        [row.name, categoryId, row.price, row.original_price, row.stock, row.unit || null, row.manufacturer || null, row.brand || null, row.description || null, sku, isCustomizable, rating]
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

      // 更新 product.main_image：无图片时使用默认占位图
      if (!mainImageUrl) {
        mainImageUrl = '/assets/images/products/product-placeholder.svg'
      }
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
        preview: previewData.map(r => ({
          row: r.row,
          name: r.name,
          category_name: r.category_name,
          is_new_category: r.is_new_category,
          sku: r.sku,
          is_customizable: r.is_customizable,
          rating: r.rating,
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
