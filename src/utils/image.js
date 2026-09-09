// 全站统一的图片占位图：未上传（空值）或加载失败时默认使用该图
export const IMG_FALLBACK = '/assets/images/placeholders/product-placeholder.svg'

// 空值/无效值回退到占位图
export function resolve(src) {
  return src && String(src).trim() ? src : IMG_FALLBACK
}

// 原生 <img> / el-image 加载失败时把 src 替换为占位图
export function onImgError(event) {
  const el = event && event.target
  if (!el || typeof el.src !== 'string') return
  if (el.src !== new URL(IMG_FALLBACK, location.origin).href) el.src = IMG_FALLBACK
}
