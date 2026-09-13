-- product_review 增加 is_edited（是否被编辑过）
--
-- 背景：前端「已编辑」标记一直靠 updated_at 与 created_at 是否相等推导
--   （见 utils/review.js 的 publicReview 与 routes/reviews.js 的 adminReviewRow）。
--   这两个时间戳都写入 SQLite 的 datetime('now')，精度只到秒：
--   顾客发布评价后 1 秒内立刻修改，两次写入落在同一秒，updated_at 会等于 created_at，
--   「已编辑」就被误判为 false（属于状态无法表达，而非单纯概率小的问题）。
--
-- 修复思路：把「是否编辑过」变成显式状态，编辑成功时由应用层置 1，
--   不再依赖任何时间戳比较。各字段职责因此更清晰：
--     created_at：发布时间，也是 24 小时可修改窗口的唯一依据，任何修改都不得改写它；
--     updated_at：最后一次修改时间，只用于展示；
--     is_edited ：是否被编辑过（0/1），「已编辑」标记的唯一依据。
--
-- 兼容说明：应用层写入 is_edited 时一律显式赋值，不依赖下方默认值。
ALTER TABLE product_review ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0;

-- 存量评论回填：本次迁移之前只能靠时间戳推断，这里按老口径补一次，
-- 尽量保住历史数据里已经能识别出来的「已编辑」标记。
-- 能识别出来的必然跨越了秒边界（updated_at > created_at），因此回填不会漏掉它们；
-- 真正无法还原的只有「同秒编辑」那部分历史数据——这正是本迁移要修的缺陷本身。
UPDATE product_review SET is_edited = 1 WHERE updated_at IS NOT NULL AND updated_at <> created_at;
