-- 收支明细 - 支出表（仅超级管理员可维护，见 server/routes/finance.js）
--
-- 设计说明：
--  1. 「收入」不单独建表，由 customer_order 实时聚合得出，口径与 GET /api/admin-orders/stats
--     的 total_amount 保持一致（排除 cancelled 状态，其余状态都计入），避免两处数字打架；
--     本表只承载管理员手工登记的「支出」（物流成本、平台推广等）。
--  2. category 存文本而非枚举：支出类别会随业务变化（物流 / 推广 / 采购 / 耗材 …），
--     前端用下拉 + 允许自定义输入，后端只做长度校验，不写死取值。
--  3. expense_date 与 created_at 分开：
--     expense_date 是「费用实际发生日期」（管理员手填，用于按天/按月汇总），
--     created_at 是「登记时间」（SQLite 自动写入），两者可能不同（补录历史支出）。
--  4. created_by / created_by_name 沿用 015 的「管理员ID + 姓名快照」模式：
--     管理员被删除或改名后，仍能还原登记人。
CREATE TABLE IF NOT EXISTS finance_expense (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL DEFAULT 0.00,
  category TEXT NOT NULL,
  note TEXT,
  expense_date TEXT NOT NULL,
  created_by INTEGER,
  created_by_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_finance_expense_date ON finance_expense (expense_date);
CREATE INDEX IF NOT EXISTS idx_finance_expense_category ON finance_expense (category);
CREATE INDEX IF NOT EXISTS idx_finance_expense_created_by ON finance_expense (created_by);
