-- 移除不再使用的四个社交媒体账号文本字段
-- 前台仅展示各平台二维码图片及其下方名称，不再需要账号/主页文本
DELETE FROM site_setting WHERE setting_key IN ('xiaohongshu', 'douyin', 'tiktok', 'telegram');
