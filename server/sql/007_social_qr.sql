-- 新增社交媒体二维码设置项
INSERT OR IGNORE INTO site_setting (setting_key, setting_value, setting_label) VALUES
  ('xiaohongshu_qr', '', '小红书二维码'),
  ('douyin_qr', '', '抖音二维码'),
  ('tiktok_qr', '', 'TikTok二维码'),
  ('telegram_qr', '', 'Telegram二维码');
