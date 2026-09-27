-- 清理商品 detail 字段中历史遗留的 HTML 标签（种子数据 006/009 里的 "<p>...</p>" 包裹）。
--
-- 背景：早期种子数据把 detail 存成了 "<p>文本</p>" 形式的富文本片段，而商品详情页
-- 按纯文本渲染（white-space: pre-line、不走 v-html），会把尖括号原样显示给顾客。
-- 管理员后台在打开编辑弹窗保存时已会用 htmlToPlainText 统一转成纯文本，但 006/009
-- 落入的这份历史种子数据从未触发过这层清洗，仍保留着标签。
--
-- 做法：只剥掉字面量 "<p>" / "</p>" 包裹，其余内容不动。种子数据里 detail 均为
-- 单段无实体的 "<p>...</p>"，替换后即得到干净纯文本。product_translation 表由 036
-- 新建，且种子从未写入译文行，无需处理；后台编辑译文时已按纯文本保存。
--
-- 幂等：REPLACE 只替换显式子串；清洗后 detail 不再含 "<p>" / "</p>"，重复执行无副作用。
UPDATE product
SET detail = REPLACE(REPLACE(detail, '<p>', ''), '</p>', '')
WHERE detail IS NOT NULL
  AND (detail LIKE '%<p>%' OR detail LIKE '%</p>%');