CREATE TABLE IF NOT EXISTS operation_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  admin_id INT NULL,
  admin_username VARCHAR(50) NULL,
  operation_type VARCHAR(50) NOT NULL,
  operation_module VARCHAR(50) NOT NULL,
  operation_desc VARCHAR(500) NULL,
  ip_address VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_operation_log_admin (admin_id),
  INDEX idx_operation_log_module (operation_module),
  INDEX idx_operation_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_setting (
  id INT PRIMARY KEY AUTO_INCREMENT,
  setting_key VARCHAR(50) NOT NULL UNIQUE,
  setting_value VARCHAR(500) NULL,
  setting_label VARCHAR(50) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO site_setting (setting_key, setting_value, setting_label) VALUES
  ('contact_email', 'contact@example-shop.com', '联系邮箱'),
  ('contact_phone', '400-800-1234', '联系电话'),
  ('xiaohongshu', 'XHS_8827364', '小红书'),
  ('douyin', 'douyin_shop_2026', '抖音'),
  ('tiktok', '@exampleshop_tiktok', 'TikTok'),
  ('telegram', 'https://t.me/exampleshop', 'Telegram')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
