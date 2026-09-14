-- 顾客订单运费：下单时由前端按当前语言的 shipping_rate.fee_cny 传入并快照进订单主表。
--
-- 设计取舍：
--   1) 放在 customer_order（订单级）而非 order_item（明细级），因为运费与 total_amount 同属订单级费用；
--      明细表刻意只保留「商品名称/SKU/单价/数量/小计」等商品自身信息。
--   2) total_amount 仍表示「最终应付金额 = 商品小计合计 + shipping_fee」，与既有口径一致（取消不回补运费）。
--   3) 业务侧约定：取消订单不退回运费（运费是物流服务费用而非商品款项），故 restoreOrderStock 不触碰本列。
--   4) 允许为空的历史订单：DEFAULT 0.00；幂等双保险由 migrate.js 的 ADD COLUMN 检测兜底。
ALTER TABLE customer_order ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0.00;