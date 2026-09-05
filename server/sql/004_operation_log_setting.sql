CREATE TABLE IF NOT EXISTS operation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_username TEXT,
  operation_type TEXT NOT NULL,
  operation_module TEXT NOT NULL,
  operation_desc TEXT,
  ip_address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operation_log_admin ON operation_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_module ON operation_log (operation_module);
CREATE INDEX IF NOT EXISTS idx_operation_log_created ON operation_log (created_at);

CREATE TABLE IF NOT EXISTS site_setting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  setting_label TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO site_setting (setting_key, setting_value, setting_label) VALUES
  ('contact_email', 'contact@example-shop.com', '联系邮箱'),
  ('contact_phone', '400-800-1234', '联系电话'),
  ('xiaohongshu', 'XHS_8827364', '小红书'),
  ('douyin', 'douyin_shop_2026', '抖音'),
  ('tiktok', '@exampleshop_tiktok', 'TikTok'),
  ('telegram', 'https://t.me/exampleshop', 'Telegram');
