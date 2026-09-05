CREATE TABLE IF NOT EXISTS import_batch (
  id VARCHAR(36) PRIMARY KEY,
  admin_id INT NOT NULL,
  status ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
  total_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  preview_data JSON,
  temp_dir VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  CONSTRAINT fk_import_batch_admin FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE,
  INDEX idx_import_batch_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
