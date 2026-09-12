-- 前台顾客账号：手机号 phone 作为唯一登录账号，password 存 bcrypt 哈希
CREATE TABLE IF NOT EXISTS customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  password TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  last_login_time DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_status ON customer (status);
CREATE INDEX IF NOT EXISTS idx_customer_created ON customer (created_at);
