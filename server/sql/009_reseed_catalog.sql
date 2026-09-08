-- 重新填充分类种子数据：7 条顶级分类
-- image 字段使用 public 目录下的默认占位图，管理员后续可在后台上传替换
-- 先清除旧分类数据（连同关联商品和图片一起清除，避免外键冲突）

DELETE FROM product_image;
DELETE FROM product;
DELETE FROM category;
DELETE FROM sqlite_sequence WHERE name IN ('product', 'category', 'product_image');

INSERT INTO category (id, name, image, parent_id, sort_order, status) VALUES
  (1, '珠宝首饰', '/assets/images/placeholders/product-placeholder.svg', 0, 1, 1),
  (2, '家居装饰', '/assets/images/placeholders/product-placeholder.svg', 0, 2, 1),
  (3, '陶瓷器皿', '/assets/images/placeholders/product-placeholder.svg', 0, 3, 1),
  (4, '木工作品', '/assets/images/placeholders/product-placeholder.svg', 0, 4, 1),
  (5, '礼品手作', '/assets/images/placeholders/product-placeholder.svg', 0, 5, 1),
  (6, '皮具手作', '/assets/images/placeholders/product-placeholder.svg', 0, 6, 1),
  (7, '纺织编织', '/assets/images/placeholders/product-placeholder.svg', 0, 7, 1);

-- 商品数据（保持原有 40 条商品，分类 ID 1-5 不变）
INSERT INTO product (id, name, category_id, price, original_price, stock, sales, unit, manufacturer, brand, description, detail, main_image, status) VALUES
  (1,  '锤目纹银戒',        1, 269.00, 319.00, 50, 89,  '件', '月光银饰',   '月光银饰', '手工锤纹纯银戒指，保留金属自然的温度和光泽。', '<p>锤目纹银戒，每一锤都是独一无二的痕迹。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (2,  '珍珠黄铜耳环',      1, 169.00, 209.00, 45, 132, '对', '月光银饰',   '月光银饰', '轻盈的黄铜与珍珠耳环，适合每一个特别时刻。', '<p>珍珠搭配黄铜，复古而精致。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (3,  '天然石银链项链',    1, 289.00, 349.00, 38, 72,  '条', '花屿首饰',   '花屿首饰', '天然石与银链相连，简约而有细节的手作项链。', '<p>天然石与银链的优雅组合。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (4,  '编织绳结手链',      1, 128.00, 158.00, 80, 156, '条', '绳结工坊',   '绳结工坊', '手工编织蜡绳手链，可调节长度，日常佩戴。', '<p>蜡绳编织，结实耐用。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (5,  '珐琅彩绘胸针',      1, 218.00, 268.00, 30, 41,  '枚', '彩釉小作',   '彩釉小作', '手工珐琅彩绘胸针，小巧精致，点亮穿搭。', '<p>珐琅工艺，色彩持久。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (6,  '复古黄铜胸针',      1, 198.00, 248.00, 25, 33,  '枚', '旧物新作',   '旧物新作', '复古黄铜胸针，岁月感十足的花纹浮雕。', '<p>黄铜材质，越戴越有味道。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (7,  '月光石银戒指',      1, 358.00, 428.00, 20, 28,  '枚', '月光银饰',   '月光银饰', '月光石镶嵌925银戒，柔和蓝光如月色流淌。', '<p>月光石与银的浪漫相遇。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (8,  '手工银质耳坠',      1, 238.00, 288.00, 35, 54,  '对', '月光银饰',   '月光银饰', '流线型银质耳坠，轻盈灵动，适合日常。', '<p>流线型设计，简约大方。</p>', '/assets/images/products/product-placeholder.svg', 1),

  (9,  '大豆蜡香薰蜡烛',    2, 139.00, 169.00, 100, 203,'盒', '雾野香氛',   '雾野香氛', '大豆蜡与雪松香调，点亮一个舒缓的夜晚。', '<p>大豆蜡，燃烧更持久。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (10, '复古黄铜台灯',      2, 528.00, 628.00, 15, 25,  '盏', '旧物新作',   '旧物新作', '复古黄铜台灯，暖光勾勒出夜晚的安稳轮廓。', '<p>黄铜灯身，复古设计。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (11, '吹制玻璃水杯',      2, 178.00, 218.00, 60, 61,  '个', '光的玻璃房', '光的玻璃房','吹制玻璃杯，气泡与光线组成独一无二的纹理。', '<p>每一只都是独一无二的。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (12, '藤编收纳篮',        2, 168.00, 208.00, 40, 47,  '个', '织物小屋',   '织物小屋', '天然藤条手工编织，收纳与装饰两不误。', '<p>藤编工艺，自然质朴。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (13, '手工皂礼盒',        2, 198.00, 248.00, 75, 109, '盒', '雾野香氛',   '雾野香氛', '植物精油手工皂礼盒，适合送给认真生活的人。', '<p>五种植物精油配方。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (14, '棉麻桌布',          2, 188.00, 228.00, 50, 38,  '条', '织物小屋',   '织物小屋', '天然棉麻织造，素雅纹理搭配日常餐桌。', '<p>棉麻材质，透气舒适。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (15, '干花永生花束',      2, 158.00, 198.00, 45, 76,  '束', '白栀花婚礼', '白栀花婚礼','干燥花材搭配永生花，长久保存的自然之美。', '<p>可保存一年以上。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (16, '黄铜烛台',          2, 298.00, 358.00, 28, 22,  '个', '旧物新作',   '旧物新作', '手工打磨黄铜烛台，为晚餐增添仪式感。', '<p>黄铜烛台，越用越温润。</p>', '/assets/images/products/product-placeholder.svg', 1),

  (17, '米白釉陶瓷花瓶',    3, 328.00, 398.00, 35, 126,'个', '陶语工作室', '陶语工作室','米白釉面陶瓷花瓶，为日常花束留出安静的呼吸感。','<p>手拉坯，每一只略有不同。</p>','/assets/images/products/product-placeholder.svg', 1),
  (18, '手捏陶瓷咖啡杯',    3, 158.00, 198.00, 80, 114,'个', '陶语工作室', '陶语工作室','手捏陶瓷咖啡杯，每一只都有独特的釉色流动。','<p>手捏成形，独一无二。</p>','/assets/images/products/product-placeholder.svg', 1),
  (19, '柴烧茶壶',          3, 488.00, 588.00, 18, 29, '把', '陶语工作室', '陶语工作室','柴烧落灰釉茶壶，自然灰痕构成不可复制的画面。','<p>柴烧工艺，自然灰釉。</p>','/assets/images/products/product-placeholder.svg', 1),
  (20, '青瓷茶杯套装',      3, 368.00, 448.00, 25, 31, '套', '陶语工作室', '陶语工作室','青瓷釉色温润如玉，一套两只，品茶时光。','<p>青瓷质感，温润雅致。</p>','/assets/images/products/product-placeholder.svg', 1),
  (21, '粗陶花盆',          3, 148.00, 188.00, 60, 52,  '个', '陶语工作室', '陶语工作室','粗陶质感花盆，透气性好，适合多肉与绿植。','<p>粗陶透气，利于植物生长。</p>','/assets/images/products/product-placeholder.svg', 1),
  (22, '窑变釉碗',          3, 128.00, 158.00, 70, 88,  '个', '陶语工作室', '陶语工作室','窑变釉色碗，每只碗都有不同的色彩流淌。','<p>窑变工艺，独一无二。</p>','/assets/images/products/product-placeholder.svg', 1),
  (23, '手绘青花盘',        3, 218.00, 268.00, 40, 35,  '个', '陶语工作室', '陶语工作室','手工绘画青花纹样，传统工艺与现代器型。','<p>青花手绘，传统纹样。</p>','/assets/images/products/product-placeholder.svg', 1),
  (24, '冰裂纹茶杯',        3, 188.00, 238.00, 45, 42,  '个', '陶语工作室', '陶语工作室','冰裂纹釉面茶杯，开片之美在日常中流淌。','<p>冰裂纹釉，自然开片。</p>','/assets/images/products/product-placeholder.svg', 1),

  (25, '胡桃木首饰盒',      4, 238.00, 288.00, 30, 54,  '个', '山木作',     '山木作',   '胡桃木首饰收纳盒，细腻木纹与柔和弧线相遇。', '<p>胡桃木，天然木纹。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (26, '橡木小鸟摆件',      4, 189.00, 229.00, 40, 41,  '个', '山木作',     '山木作',   '手工打磨的橡木小鸟摆件，温柔陪伴日常角落。', '<p>橡木打磨，圆润手感。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (27, '实木相框',          4, 149.00, 189.00, 55, 67,  '个', '山木作',     '山木作',   '实木相框保留自然边缘，装进值得回看的片段。', '<p>原木边框，自然边。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (28, '胡桃木书架',        4, 598.00, 728.00, 12, 15,  '个', '山木作',     '山木作',   '胡桃木落地书架，榫卯结构，简约实用。', '<p>榫卯结构，稳固耐用。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (29, '橄榄木砧板',        4, 268.00, 328.00, 35, 48,  '个', '山木作',     '山木作',   '橄榄木整块切割，天然纹理，耐用不易裂。', '<p>整块橄榄木，天然纹理。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (30, '木雕书签',          4, 89.00,  119.00, 100, 95, '枚', '山木作',     '山木作',   '手工木雕书签，轻薄木质搭配细绳。', '<p>轻巧木雕，随身携带。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (31, '榉木托盘',          4, 178.00, 218.00, 30, 26,  '个', '山木作',     '山木作',   '榉木整木托盘，茶席与餐桌的实用搭配。', '<p>榉木整木，打磨光滑。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (32, '木质手机支架',      4, 98.00,  128.00, 80, 62,  '个', '山木作',     '山木作',   '实木手机支架，简约设计，稳固支撑。', '<p>实木支架，简约稳固。</p>', '/assets/images/products/product-placeholder.svg', 1),

  (33, '植鞣牛皮钱包',      5, 319.00, 389.00, 40, 96,  '个', '皮匠慢作',   '皮匠慢作', '植鞣牛皮手工缝制，越使用越有自己的故事。', '<p>植鞣牛皮，越用越有韵味。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (34, '棉布手缝布偶',      5, 219.00, 269.00, 35, 88,  '个', '小熊缝纫社', '小熊缝纫社','天然棉布手缝布偶，是一份充满心意的礼物。', '<p>天然棉布，手工缝制。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (35, '植物纤维编织包',    5, 459.00, 559.00, 20, 63,  '个', '织物小屋',   '织物小屋', '植物纤维手工编织，轻盈耐用的日常随身包。', '<p>植物纤维，轻盈环保。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (36, '棉线编织壁挂',      5, 358.00, 438.00, 18, 37,  '件', '织物小屋',   '织物小屋', '棉线编织的墙面风景，为家带来柔软层次。', '<p>棉线编织，柔软质感。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (37, '手绘山野装饰画',    5, 426.00, 516.00, 15, 48,  '幅', '远山画室',   '远山画室', '手绘山野色彩画，为墙面添一份静谧想象。', '<p>手绘原作，不可复制。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (38, '植物刺绣摆件',      5, 398.00, 478.00, 20, 45,  '件', '针线花园',   '针线花园', '细密针线绣出植物图案，适合珍藏的墙面作品。', '<p>细密刺绣，值得珍藏。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (39, '婚礼桌面装饰套装',  5, 628.00, 758.00, 10, 29,  '套', '白栀花婚礼', '白栀花婚礼','手作婚礼桌面装饰，让重要一天自然又温柔。', '<p>婚礼系列，自然温柔。</p>', '/assets/images/products/product-placeholder.svg', 1),
  (40, '羊毛手织围巾',      5, 298.00, 368.00, 30, 75,  '条', '云朵织造',   '云朵织造', '柔软羊毛手织围巾，蓬松质感与温暖色彩。', '<p>羊毛手织，蓬松温暖。</p>', '/assets/images/products/product-placeholder.svg', 1);

-- 商品图片（每件商品一张主图）
INSERT INTO product_image (product_id, image_url, is_main, sort_order)
SELECT id, '/assets/images/products/product-placeholder.svg', 1, 0 FROM product;
