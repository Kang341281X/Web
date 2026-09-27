// 富文本 HTML → 纯文本：不依赖 DOM 的共享工具，后台表单与顾客端详情页通用。
// 处理顺序：<br> 与块级闭合标签转成换行 → 去掉其余标签 → 解码常见 HTML 实体 → 收拢多余空行。
// 说明：&amp; 必须最后解码，避免把 "&amp;lt;" 这类字面量二次解成 "<"（与浏览器 textarea 的单次解码一致）。
export function htmlToPlainText(html) {
  if (!html) return ''
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(?:#0?39|apos);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}