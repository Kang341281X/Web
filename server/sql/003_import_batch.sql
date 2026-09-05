CREATE TABLE IF NOT EXISTS import_batch (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  preview_data TEXT,
  temp_dir TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_import_batch_status ON import_batch (status, expires_at);
