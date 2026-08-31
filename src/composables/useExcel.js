import * as XLSX from 'xlsx'

/**
 * Excel 导入导出 composable
 * 表格字段：id | title | category | price | originalPrice | rating | reviewCount | seller | badge | description | stock | sales | image | images
 * images 字段存储多张图片的相对路径，用逗号分隔
 */

export function useExcel() {

  /** 导出商品列表为 .xlsx 文件 */
  function exportProducts(products, filename = '商品列表') {
    const rows = products.map(p => ({
      'ID': p.id,
      '商品名称': p.title,
      '分类': p.category,
      '现价': p.price,
      '原价': p.originalPrice,
      '评分': p.rating,
      '评论数': p.reviewCount,
      '卖家': p.seller,
      '标签': p.badge,
      '描述': p.description,
      '库存': p.stock,
      '销量': p.sales,
      '主图路径': p.image,
      '图片路径(逗号分隔)': Array.isArray(p.images) ? p.images.join(',') : (p.images || '')
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    // 设置列宽
    ws['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
      { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 40 },
      { wch: 8 }, { wch: 8 }, { wch: 40 }, { wch: 60 }
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '商品列表')

    const date = new Date()
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`)
  }

  /** 下载导入模板 */
  function downloadTemplate() {
    const sample = [{
      'ID': 1,
      '商品名称': '示例商品',
      '分类': 'ceramics',
      '现价': 328,
      '原价': 398,
      '评分': 4.9,
      '评论数': 126,
      '卖家': '示例工作室',
      '标签': '新品',
      '描述': '商品描述文字',
      '库存': 50,
      '销量': 126,
      '主图路径': '/assets/products/1/1.jpg',
      '图片路径(逗号分隔)': '/assets/products/1/1.jpg,/assets/products/1/2.jpg,/assets/products/1/3.jpg'
    }]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
      { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 40 },
      { wch: 8 }, { wch: 8 }, { wch: 40 }, { wch: 60 }
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '商品导入模板')
    XLSX.writeFile(wb, '商品导入模板.xlsx')
  }

  /** 从 File 对象解析商品数组 */
  function parseProductFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result)
          const wb = XLSX.read(data, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
          const products = json.map(row => ({
            id: row['ID'] || row['id'] || undefined,
            title: row['商品名称'] || row['title'] || '',
            category: row['分类'] || row['category'] || 'gifts',
            price: Number(row['现价'] || row['price'] || 0),
            originalPrice: Number(row['原价'] || row['originalPrice'] || 0),
            rating: Number(row['评分'] || row['rating'] || 5),
            reviewCount: Number(row['评论数'] || row['reviewCount'] || 0),
            seller: row['卖家'] || row['seller'] || '',
            badge: row['标签'] || row['badge'] || '',
            description: row['描述'] || row['description'] || '',
            stock: Number(row['库存'] || row['stock'] || 0),
            sales: Number(row['销量'] || row['sales'] || 0),
            image: row['主图路径'] || row['image'] || '/assets/images/products/product-placeholder.svg',
            images: row['图片路径(逗号分隔)'] || row['images'] || ''
          })).filter(p => p.title)
          resolve(products)
        } catch (err) {
          reject(new Error('文件解析失败: ' + err.message))
        }
      }
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsArrayBuffer(file)
    })
  }

  return { exportProducts, downloadTemplate, parseProductFile }
}
