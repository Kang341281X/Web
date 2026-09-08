-- 新增第二个联系电话和第二个邮箱字段
INSERT INTO site_setting (setting_key, setting_value, setting_label) VALUES
  ('contact_phone2', '', '联系电话2'),
  ('contact_email2', '', '联系邮箱2')
ON CONFLICT(setting_key) DO NOTHING;
