-- 社交媒体动态列表：支持名称修改与平台新增
CREATE TABLE IF NOT EXISTS social_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 将原有四个固定平台迁移到新表（保留已上传二维码，空库时预置默认平台）
INSERT INTO social_media (name, image, sort_order)
SELECT name, image, sort_order FROM (
  SELECT '抖音' AS name, COALESCE((SELECT setting_value FROM site_setting WHERE setting_key='douyin_qr'), '') AS image, 0 AS sort_order
  UNION ALL SELECT '小红书', COALESCE((SELECT setting_value FROM site_setting WHERE setting_key='xiaohongshu_qr'), ''), 1
  UNION ALL SELECT 'TikTok', COALESCE((SELECT setting_value FROM site_setting WHERE setting_key='tiktok_qr'), ''), 2
  UNION ALL SELECT 'Telegram', COALESCE((SELECT setting_value FROM site_setting WHERE setting_key='telegram_qr'), ''), 3
) t
WHERE NOT EXISTS (SELECT 1 FROM social_media);

-- 旧的二维码设置项数据已迁移至 social_media 表，予以清除
DELETE FROM site_setting WHERE setting_key IN ('xiaohongshu_qr', 'douyin_qr', 'tiktok_qr', 'telegram_qr');
