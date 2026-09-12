-- 运费表：本站目前只按界面语言区分用户、不采集具体收货国家，
-- 因此运费只能按「语言分组」做近似估算，页面上需注明「预估运费，实际以物流商核算为准」。
--   region_key：CN / TW / JP / KR / OTHER（OTHER 代表其余海外地区）
--   locale    ：与 region_key 一一对应的界面语言
--   fee_cny   ：以人民币计价的预估运费；0 表示包邮
--   note      ：区域说明
-- 说明：下列数值仅为「参考默认值」，管理员可在后台「其他设置 → 运费设置」自行修改。
CREATE TABLE IF NOT EXISTS shipping_rate (
  region_key TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  fee_cny REAL NOT NULL,
  note TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 默认种子值：中国邮政国际小包按目的地分区定价，邻国（含 TW/JP/KR）较低，欧美澳新等（OTHER）较高
INSERT OR IGNORE INTO shipping_rate (region_key, locale, fee_cny, note) VALUES
  ('CN',    'zh-CN', 0,  '中国大陆地区，包邮'),
  ('TW',    'zh-TW', 25, '中国台湾地区预估运费'),
  ('JP',    'ja',    35, '日本预估运费'),
  ('KR',    'ko',    35, '韩国预估运费'),
  ('OTHER', 'en',    60, '其他海外地区预估运费');
