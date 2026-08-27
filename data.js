/* ============================================================================
 * data.js — 静态世界数据与模板（原创王朝「大晟」，1627 年开局）
 * ----------------------------------------------------------------------------
 * 包含：地区、人物、派系、外交势力、事件模板、国策树、难度预设、剧本、
 *       默认 Prompt、加载提示语等。全部为纯数据，不含 DOM 操作。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  /* ============================ 地区（8 个） ============================
   * geo 为抽象地图上的包围盒（viewBox 1000×720），map.js 会据此绘制多边形。
   */
  const REGIONS = [
    {
      id: 'xibei', name: '西北', x: 110, y: 60, w: 220, h: 170,
      desc: '黄土旱塬，地瘠民贫，连年少雨，流民渐聚。',
      population: 4500000, grain: 260000, income: 42000, taxRate: 18,
      loyalty: 33, security: 38, corruption: 52, agriculture: 24, commerce: 12,
      military: 46, unrest: 58, governor: 'c8',
      disaster: { type: '旱灾', severity: 3 },
    },
    {
      id: 'beifang', name: '北方', x: 345, y: 60, w: 220, h: 170,
      desc: '九边重镇所在，军堡相连，商路萧条，全赖协饷。',
      population: 5000000, grain: 380000, income: 58000, taxRate: 16,
      loyalty: 51, security: 55, corruption: 41, agriculture: 38, commerce: 26,
      military: 72, unrest: 30, governor: 'c2',
      disaster: null,
    },
    {
      id: 'dongbei', name: '东北', x: 580, y: 60, w: 300, h: 170,
      desc: '边墙之外胡骑窥伺，卫所疲敝，粮饷积欠已久。',
      population: 3500000, grain: 300000, income: 46000, taxRate: 14,
      loyalty: 47, security: 44, corruption: 44, agriculture: 36, commerce: 22,
      military: 76, unrest: 36, governor: 'c10',
      disaster: null,
    },
    {
      id: 'jingshi', name: '京师', x: 345, y: 245, w: 220, h: 150,
      desc: '帝都所在，百官云集，坊市繁华之下暗流涌动。',
      population: 3200000, grain: 240000, income: 86000, taxRate: 20,
      loyalty: 60, security: 62, corruption: 43, agriculture: 18, commerce: 66,
      military: 58, unrest: 18, governor: 'c4',
      disaster: null,
    },
    {
      id: 'huabei', name: '华北', x: 580, y: 245, w: 300, h: 150,
      desc: '平原沃野，麦粟之乡，然河道年久失修。',
      population: 9000000, grain: 720000, income: 96000, taxRate: 19,
      loyalty: 56, security: 54, corruption: 39, agriculture: 68, commerce: 40,
      military: 40, unrest: 24, governor: 'c5',
      disaster: null,
    },
    {
      id: 'xinan', name: '西南', x: 110, y: 415, w: 220, h: 245,
      desc: '山高林深，土司林立，改流之议久拖不决。',
      population: 6000000, grain: 460000, income: 52000, taxRate: 15,
      loyalty: 49, security: 45, corruption: 47, agriculture: 46, commerce: 28,
      military: 42, unrest: 42, governor: 'c9',
      disaster: null,
    },
    {
      id: 'jiangnan', name: '江南', x: 345, y: 415, w: 295, h: 245,
      desc: '财赋重地，丝米之乡，士绅势大，逋欠成风。',
      population: 11000000, grain: 950000, income: 168000, taxRate: 22,
      loyalty: 58, security: 60, corruption: 48, agriculture: 74, commerce: 84,
      military: 26, unrest: 22, governor: 'c9',
      disaster: null,
    },
    {
      id: 'dongnan', name: '东南', x: 655, y: 415, w: 225, h: 245,
      desc: '滨海通商，市舶之利甚厚，海盗与海商一线之隔。',
      population: 8000000, grain: 540000, income: 112000, taxRate: 21,
      loyalty: 55, security: 52, corruption: 46, agriculture: 52, commerce: 76,
      military: 34, unrest: 26, governor: 'c7',
      disaster: null,
    },
  ];

  /* 地区别名（供 MockAI / 关键词匹配用） */
  const REGION_ALIASES = {
    '西北': 'xibei', '陕西': 'xibei', '甘陇': 'xibei', '秦地': 'xibei',
    '北方': 'beifang', '九边': 'beifang', '塞北': 'beifang', '宣府': 'beifang', '大同': 'beifang',
    '东北': 'dongbei', '辽东': 'dongbei', '关外': 'dongbei',
    '京师': 'jingshi', '京城': 'jingshi', '京畿': 'jingshi', '顺天': 'jingshi', '首都': 'jingshi',
    '华北': 'huabei', '中原': 'huabei', '河间': 'huabei', '山东': 'huabei', '河南': 'huabei',
    '西南': 'xinan', '四川': 'xinan', '巴蜀': 'xinan', '云贵': 'xinan', '贵州': 'xinan', '云南': 'xinan',
    '江南': 'jiangnan', '南直隶': 'jiangnan', '苏州': 'jiangnan', '应天': 'jiangnan', '浙江': 'jiangnan',
    '东南': 'dongnan', '福建': 'dongnan', '广东': 'dongnan', '岭南': 'dongnan', '沿海': 'dongnan', '闽粤': 'dongnan',
  };

  /* ============================ 人物（12 位） ============================ */
  const CHARACTERS = [
    {
      id: 'c1', name: '韩秉文', role: '户部尚书', faction: '财政派', age: 54,
      loyalty: 70, ability: 84, ambition: 42, corruption: 22,
      personality: ['谨慎', '务实', '锱铢必较'],
      desc: '掌天下钱谷，账册烂熟于心，最恨空言误国。',
      task: '清核九边欠饷', secrets: ['早年在盐运司任职时，与江南盐商有过往来'],
      hue: 210,
    },
    {
      id: 'c2', name: '周定澜', role: '兵部尚书', faction: '军事派', age: 58,
      loyalty: 76, ability: 80, ambition: 65, corruption: 18,
      personality: ['刚直', '主战', '体恤士卒'],
      desc: '行伍出身，常言“边饷一日不解，将士一日寒心”。',
      task: '催讨辽东冬饷', secrets: [],
      hue: 0,
    },
    {
      id: 'c3', name: '沈廷章', role: '内阁首辅', faction: '保守派', age: 61,
      loyalty: 82, ability: 88, ambition: 55, corruption: 15,
      personality: ['老成', '持重', '善于调和'],
      desc: '三朝老臣，门生故吏遍布朝野，凡事求稳。',
      task: '维系朝局平衡', secrets: ['曾暗中压下过一份弹劾杨启年的奏疏'],
      hue: 45,
    },
    {
      id: 'c4', name: '杨启年', role: '吏部尚书', faction: '中立官僚', age: 57,
      loyalty: 66, ability: 75, ambition: 70, corruption: 34,
      personality: ['圆滑', '结党', '精于人事'],
      desc: '握官员考选之权，京中人称“杨半朝”。',
      task: '安排外官大计', secrets: ['收受外官“常例”已是半公开的秘密'],
      hue: 280,
    },
    {
      id: 'c5', name: '顾清源', role: '礼部尚书', faction: '保守派', age: 63,
      loyalty: 85, ability: 70, ambition: 25, corruption: 8,
      personality: ['方正', '崇古', '重视教化'],
      desc: '笃信礼制可安天下，反对轻改祖宗成法。',
      task: '筹备郊祀大典', secrets: [],
      hue: 120,
    },
    {
      id: 'c6', name: '林之桓', role: '都察院左都御史', faction: '改革派', age: 49,
      loyalty: 80, ability: 78, ambition: 60, corruption: 6,
      personality: ['峻烈', '疾恶如仇', '不畏权贵'],
      desc: '风闻言事，弹章无数，与杨启年势同水火。',
      task: '追查赈银去向', secrets: ['手中握有吴梦得挪用织造银的账目抄本'],
      hue: 190,
    },
    {
      id: 'c7', name: '苏若拙', role: '工部侍郎', faction: '改革派', age: 44,
      loyalty: 68, ability: 83, ambition: 58, corruption: 12,
      personality: ['巧思', '实干', '不善逢迎'],
      desc: '治水修城皆有所长，案头总堆着图纸。',
      task: '勘测黄河堤工', secrets: [],
      hue: 165,
    },
    {
      id: 'c8', name: '陈延嗣', role: '陕西巡抚', faction: '地方派', age: 52,
      loyalty: 58, ability: 72, ambition: 48, corruption: 30,
      personality: ['焦头烂额', '护短', '深知民瘼'],
      desc: '坐困旱灾之地，连章告急，请求截留税银赈灾。',
      task: '安抚灾民、筹措赈粮', secrets: ['为救急曾默许下属动用预备仓粮'],
      hue: 30,
    },
    {
      id: 'c9', name: '吴梦得', role: '江南巡抚', faction: '地方派', age: 56,
      loyalty: 52, ability: 74, ambition: 72, corruption: 56,
      personality: ['八面玲珑', '贪墨', '盘根错节'],
      desc: '兼领织造，与豪商士绅过从甚密，江南钱粮多经其手。',
      task: '督办织造上供', secrets: ['历年挪用织造银两填补私囊，账目做了两手'],
      hue: 315,
    },
    {
      id: 'c10', name: '燕铁翎', role: '征虏大将军', faction: '军事派', age: 59,
      loyalty: 64, ability: 86, ambition: 78, corruption: 24,
      personality: ['悍勇', '傲上', '爱兵如子'],
      desc: '威震东北，麾下家兵皆是百战之余，久驻边镇。',
      task: '布防边墙、求饷求粮', secrets: ['为购战马，曾私下与关外马商接触频繁'],
      hue: 355,
    },
    {
      id: 'c11', name: '温以宁', role: '国子监祭酒', faction: '中立官僚', age: 60,
      loyalty: 78, ability: 74, ambition: 30, corruption: 5,
      personality: ['清雅', '重才', '忧思深远'],
      desc: '桃李满天下，士林清议颇以其马首是瞻。',
      task: '主持会试', secrets: [],
      hue: 95,
    },
    {
      id: 'c12', name: '裴无咎', role: '锦衣卫指挥使', faction: '改革派', age: 46,
      loyalty: 88, ability: 76, ambition: 52, corruption: 20,
      personality: ['阴沉', '缜密', '只忠于皇帝'],
      desc: '天子耳目，缇骑四出，朝野闻其名而侧目。',
      task: '密察京师官场', secrets: ['正在暗中核查户部一笔去向不明的漕银'],
      hue: 240,
    },
  ];

  /* 人物关系（有向）：a 对 b 的关系标注 */
  const CHARACTER_RELATIONS = [
    { a: 'c3', b: 'c4', type: '同僚相护', note: '沈廷章念旧，屡次回护杨启年' },
    { a: 'c6', b: 'c4', type: '敌意', note: '林之桓三次弹劾杨启年' },
    { a: 'c6', b: 'c9', type: '监视', note: '林之桓在查江南织造的账' },
    { a: 'c1', b: 'c9', type: '竞争', note: '户部屡催江南逋赋，吴梦得叫苦' },
    { a: 'c2', b: 'c10', type: '合作', note: '周定澜与燕铁翎同为主战派' },
    { a: 'c10', b: 'c2', type: '轻视', note: '燕铁翎嫌兵部调度文弱' },
    { a: 'c11', b: 'c6', type: '师生', note: '温以宁是林之桓的座师' },
    { a: 'c8', b: 'c1', type: '依赖', note: '陈延嗣盼户部拨款如盼甘霖' },
    { a: 'c12', b: 'c4', type: '暗中调查', note: '裴无咎盯上了吏部的铨选' },
  ];

  /* ============================ 派系（6 个） ============================ */
  const FACTIONS = [
    { id: 'f1', name: '改革派', influence: 26, approval: 55, interest: '整肃吏治、推行新法', leaders: ['c6', 'c7'], preference: '反腐、变法、实政' },
    { id: 'f2', name: '保守派', influence: 32, approval: 60, interest: '维护祖制、礼法秩序', leaders: ['c3', 'c5'], preference: '稳妥、渐进、不折腾' },
    { id: 'f3', name: '地方派', influence: 24, approval: 48, interest: '地方自主、减免解运', leaders: ['c8', 'c9'], preference: '截留税收、宽刑简政' },
    { id: 'f4', name: '财政派', influence: 18, approval: 52, interest: '开源节流、账目清明', leaders: ['c1'], preference: '量入为出、清理欠赋' },
    { id: 'f5', name: '军事派', influence: 27, approval: 50, interest: '足饷足兵、靖边扩土', leaders: ['c2', 'c10'], preference: '加饷备战、强硬对外' },
    { id: 'f6', name: '中立官僚', influence: 29, approval: 57, interest: '仕途安稳、明哲保身', leaders: ['c4', 'c11'], preference: '随波逐流、见风使舵' },
  ];

  /* ============================ 外交势力（5 个） ============================ */
  const DIPLOMACY = [
    { id: 'd1', name: '北狄汗国', type: '敌对势力', relation: -55, trust: 15, trade: 8, threat: 78, borderPressure: 72, desc: '控弦之士数十万，岁岁叩边，索要开市与岁币。' },
    { id: 'd2', name: '东海女真诸部', type: '邻国', relation: -20, trust: 30, trade: 35, threat: 52, borderPressure: 58, desc: '部落时叛时附，边墙之外烽燧不绝。' },
    { id: 'd3', name: '南疆土司联盟', type: '附属国', relation: 30, trust: 48, trade: 42, threat: 25, borderPressure: 30, desc: '名义内附，实则自专，近年贡使渐疏。' },
    { id: 'd4', name: '西域商邦', type: '贸易伙伴', relation: 45, trust: 55, trade: 66, threat: 12, borderPressure: 14, desc: '驼队往来于河西，玉帛交换，唯盼商路平安。' },
    { id: 'd5', name: '海西国', type: '中立势力', relation: 10, trust: 35, trade: 30, threat: 20, borderPressure: 10, desc: '浮海而来通商，船坚炮利，居心难测。' },
  ];

  /* ============================ 国策树（16 项） ============================
   * 国策只改变世界规则参数（ongoing），不预定剧情。
   * ongoing 键位：incomeMult/grainMult/tradeMult/armyPayMult/reliefEffMult 为倍率；
   * corruptionDrift/loyaltyDrift/securityBonus/borderDefenseBonus/adminBonus 为加成。
   */
  const POLICY_TREE = [
    // —— 政治 ——
    { id: 'p_keju', cat: '政治', name: '科举取士', cost: 30000, prereq: [], instant: { publicSupport: 2, bureaucracy: 3 }, ongoing: { adminBonus: 3 }, side: '士林拥戴，但官署冗员渐增', aiHint: '扩大取士规模，寒门士子称颂' },
    { id: 'p_kaocheng', cat: '政治', name: '考成法', cost: 50000, prereq: ['p_keju'], instant: { bureaucracy: 6, authority: 3 }, ongoing: { adminBonus: 6, corruptionDrift: -0.5 }, side: '官僚集团怨声载道，执行阻力大', aiHint: '以考核督责政务，官吏敢怒不敢言' },
    { id: 'p_mizhe', cat: '政治', name: '密折制度', cost: 20000, prereq: [], instant: { authority: 5 }, ongoing: {}, side: '臣下人人自危，猜忌之风渐起', aiHint: '皇帝耳目四通，信息灵通' },
    // —— 财政 ——
    { id: 'p_qingzhang', cat: '财政', name: '清丈田亩', cost: 80000, prereq: [], instant: { treasury: 60000, corruption: 2 }, ongoing: { incomeMult: 0.06 }, side: '豪强隐田被查出，士绅不满', aiHint: '清查全国田亩，隐匿者补缴' },
    { id: 'p_yitiaobian', cat: '财政', name: '一条鞭法', cost: 120000, prereq: ['p_qingzhang'], instant: { treasury: 90000 }, ongoing: { incomeMult: 0.1, loyaltyDrift: -0.3 }, side: '赋役折银简便，但银贵谷贱伤农', aiHint: '赋役合并折银征收' },
    { id: 'p_kaihai', cat: '财政', name: '开海通商', cost: 100000, prereq: [], instant: { treasury: 40000 }, ongoing: { tradeMult: 0.25, incomeMult: 0.05 }, side: '市舶之利丰饶，海寇亦随之滋生', aiHint: '开放海禁，设关抽税' },
    // —— 农业 ——
    { id: 'p_xiuqu', cat: '农业', name: '修渠灌溉', cost: 70000, prereq: [], instant: { food: 60000 }, ongoing: { grainMult: 0.08 }, side: '功在长远，需常年维护', aiHint: '兴修水利渠道' },
    { id: 'p_tuntian', cat: '农业', name: '边地屯田', cost: 60000, prereq: [], instant: { food: 40000, militaryPower: 2 }, ongoing: { grainMult: 0.04, borderDefenseBonus: 3 }, side: '军屯侵扰民田时有发生', aiHint: '令边军且耕且守' },
    { id: 'p_changping', cat: '农业', name: '常平仓', cost: 50000, prereq: [], instant: { food: 30000, publicSupport: 3 }, ongoing: { reliefEffMult: 0.2 }, side: '仓粮易被层层侵蚀', aiHint: '丰年籴、荒年粜，平抑粮价' },
    // —— 军事 ——
    { id: 'p_zhengxun', cat: '军事', name: '营伍整训', cost: 90000, prereq: [], instant: { militaryPower: 6 }, ongoing: { armyPayMult: 0.1, borderDefenseBonus: 4 }, side: '军费开支显著增加', aiHint: '汰弱留强，按月操练' },
    { id: 'p_bianqiang', cat: '军事', name: '边墙加固', cost: 110000, prereq: ['p_tuntian'], instant: {}, ongoing: { borderDefenseBonus: 8 }, side: '工役繁重，沿边民力疲惫', aiHint: '增修墩台边墙' },
    { id: 'p_huoqi', cat: '军事', name: '火器营', cost: 130000, prereq: ['p_zhengxun'], instant: { militaryPower: 8 }, ongoing: { armyPayMult: 0.12, borderDefenseBonus: 5 }, side: '匠作耗费巨大，将领争抢新军编制', aiHint: '编练火器新军' },
    // —— 教育 ——
    { id: 'p_guanxue', cat: '教育', name: '州县官学', cost: 45000, prereq: ['p_keju'], instant: { publicSupport: 2 }, ongoing: { adminBonus: 2, loyaltyDrift: 0.2 }, side: '见效缓慢，十年树木', aiHint: '广设官学教化百姓' },
    // —— 科技 ——
    { id: 'p_liju', cat: '科技', name: '钦天监历局', cost: 55000, prereq: [], instant: {}, ongoing: { adminBonus: 2 }, side: '引进历算新法，守旧者非议', aiHint: '修订历法、译介历算之书' },
    // —— 外交 ——
    { id: 'p_hushi', cat: '外交', name: '边市互市', cost: 40000, prereq: [], instant: { treasury: 20000 }, ongoing: { tradeMult: 0.15 }, side: '胡人得铁得布，边备或弛', aiHint: '开边市与北狄互市' },
    // —— 民生 / 行政 ——
    { id: 'p_yangji', cat: '民生', name: '养济院', cost: 35000, prereq: [], instant: { publicSupport: 4 }, ongoing: { loyaltyDrift: 0.3 }, side: '常年支出，地方或有冒领', aiHint: '收养孤寡废疾' },
    { id: 'p_yizhan', cat: '行政', name: '驿站整顿', cost: 30000, prereq: [], instant: { bureaucracy: 4 }, ongoing: { adminBonus: 4 }, side: '裁撤冗站，驿卒失业者众', aiHint: '清理驿传积弊' },
  ];
  POLICY_TREE.forEach((p) => { p.cat = p.cat || '政治'; });

  /* ============================ 难度预设 ============================ */
  const DIFFICULTIES = [
    { id: 'story', label: '故事模式', desc: '历史惯性较强，事件循理而至，适合体验叙事。', resourceMult: 1.0, inertia: 0.85, execEff: 1.0, eventDensity: 0.45 },
    { id: 'standard', label: '标准模式', desc: '兼顾历史与自由推演。', resourceMult: 1.0, inertia: 0.6, execEff: 0.92, eventDensity: 0.55 },
    { id: 'hard', label: '困难模式', desc: '资源紧张、执行效率下降、政治矛盾加剧。', resourceMult: 0.72, inertia: 0.5, execEff: 0.78, eventDensity: 0.7 },
    { id: 'free', label: '自由模式', desc: '降低历史强制性，允许走出完全不同的路线。', resourceMult: 1.15, inertia: 0.25, execEff: 1.0, eventDensity: 0.4 },
  ];

  /* ============================ 灾害定义 ============================ */
  const DISASTER_TYPES = ['旱灾', '洪灾', '蝗灾', '疫情', '饥荒'];
  const SEVERITY_LABELS = { 1: '微', 2: '小', 3: '中', 4: '大', 5: '巨' };

  /* ============================ 内置剧本 ============================ */
  const SCENARIOS = [
    {
      id: 'sc_default', name: '天命开局 · 大晟景明元年', builtin: true,
      desc: '1627 年。新帝登基，国库空虚，西北大旱，辽东警讯频传，朝堂党争初起。',
      year: 1627, dynastyName: '大晟', countryName: '大晟帝国', rulerName: '萧承稷', eraName: '景明',
      difficulty: 'standard',
      overrides: null,
    },
    {
      id: 'sc_crisis', name: '危局 · 国祚如缕', builtin: true,
      desc: '灾荒连省、库藏见底、军心浮动——这是最艰难的开局。',
      year: 1628, dynastyName: '大晟', countryName: '大晟帝国', rulerName: '萧承稷', eraName: '景明',
      difficulty: 'hard',
      overrides: {
        country: { treasury: 180000, food: 520000, stability: 42, publicSupport: 38, corruption: 52, morale: 40 },
        regions: {
          xibei: { disaster: { type: '饥荒', severity: 4 }, loyalty: 26, unrest: 70 },
          huabei: { disaster: { type: '蝗灾', severity: 2 } },
          dongbei: { loyalty: 40 },
        },
        diplomacy: { d1: { borderPressure: 85, threat: 85, relation: -70 } },
      },
    },
    {
      id: 'sc_prosper', name: '承平 · 烈火烹油', builtin: true,
      desc: '府库充盈、四海升平——但腐败如白蚁蛀梁，盛世之下危机四伏。',
      year: 1627, dynastyName: '大晟', countryName: '大晟帝国', rulerName: '萧承稷', eraName: '泰宁',
      difficulty: 'story',
      overrides: {
        country: { treasury: 1600000, food: 1500000, stability: 72, publicSupport: 64, corruption: 58, bureaucracy: 58 },
        regions: {
          jiangnan: { corruption: 62 }, jingshi: { corruption: 55 }, dongnan: { corruption: 54 },
        },
      },
    },
  ];

  /* ============================ 默认 Prompt ============================ */
  const DEFAULT_PROMPTS = {
    worldview:
      '【世界观】\n' +
      '这是一个架空的东方古典王朝世界（默认为大晟帝国，开局 1627 年，亦可由玩家自定义朝代年份）。\n' +
      '世界遵循前现代帝国的运行逻辑：皇权与官僚体系相互制衡；财政依赖田赋、盐铁与商税；\n' +
      '交通与通信缓慢，政令从京师到边疆需要时间；士绅、宦官、外戚、将领各有利益；\n' +
      '天灾（旱、涝、蝗、疫、饥）与边患交织；儒家礼法是社会共识，但人心趋利。\n' +
      '历史背景只是初始状态，不是固定剧本：玩家的任何重大选择都可以让历史偏离原本轨迹。',
    system:
      '你不是聊天机器人。\n' +
      '你是一个历史社会模拟器的世界状态推演引擎。\n' +
      '你必须根据当前世界状态进行因果推演。\n' +
      '不得为了让玩家获得爽感而无条件成功。\n' +
      '不得为了制造戏剧性而无理由失败。\n' +
      '玩家的命令必须考虑执行成本。\n' +
      '必须考虑官僚体系、财政、资源、人员、交通、时间、政治利益、地方执行能力。\n' +
      '任何重大政策都可能产生二阶或三阶后果。\n' +
      '历史人物必须依据人格、职位、利益和时代背景行动。\n' +
      '不要替玩家做决定。\n' +
      '不要给玩家提供固定选项作为主要玩法。玩家可以自由输入自然语言政令。\n' +
      '你的任务是模拟这个世界，而不是替玩家赢得游戏。\n' +
      '\n【用户指令权重——最高优先级约束】\n' +
      '皇帝（玩家）是这个世界最高权威。当政令中包含明确的数值（金额、人数、期限等），\n' +
      '你必须严格忠于该数值，绝不允许擅自放大或缩小。\n' +
      '示例：玩家说"拨款1万两"，intent.budget 必须是 10000，state_changes.treasury 的扣减必须以此为基准——\n' +
      '绝不能因为"觉得1万太少不够赈灾"就自行改成10万。执行效果可以打折，但花费金额不可篡改。\n' +
      '若金额明显不足以达成目标，在 narrative 中如实说明"经费捉襟见肘、效果有限"，而非偷偷加钱。\n' +
      '若玩家未给具体金额，你可以根据规模合理估算，但仍须克制。\n' +
      '\n【输出纪律】除非明确要求，否则只输出一个合法 JSON 对象，不要输出任何解释文字或 Markdown 包裹。',
    npc:
      '【角色扮演规则】\n' +
      '你将扮演王朝中的一位大臣与皇帝对话。\n' +
      '- 严格依据该大臣的职位、能力、性格、派系、利益与忠诚行动与发言。\n' +
      '- 只能使用该角色可能知道的信息。玩家没有告诉他的秘密、他没有权限知晓的国家机密，一律不可提及。\n' +
      '- 用符合时代与身份的文言白话混合语气说话，称呼皇帝为“陛下”。可以委婉劝谏、可以直言进谏、也可以迎合——取决于人格与忠诚。\n' +
      '- 发言长度控制在 60～160 字，不要列表化，不要跳出角色，不要代替皇帝决策。\n' +
      '- 输出一个 JSON：{"reply":"对白内容","attitude":"恭敬|恳切|忧虑|不满|谄媚|直言","trust_delta":-5到5的整数}',
    simulation:
      '【推演任务】\n' +
      '皇帝刚刚下达一道政令。请你作为世界推演引擎，完成本回合因果推演。\n' +
      '\n【推演层次】\n' +
      '第一层：政令的直接行为与直接结果。\n' +
      '第二层：直接受影响的官僚、地区、军队、民众的反应（考虑执行者的能力、忠诚、腐败与派系利益）。\n' +
      '第三层：这些反应波及的其他系统（财政、民心、军心、外交、物价、治安……）。\n' +
      '第四层：长期结构性后果（可延迟数回合显现）。\n' +
      '\n【硬性约束】\n' +
      '1. 所有数值变化必须与叙述一致，且幅度克制：单项百分比指标每回合通常不超过 ±12，重大变革也不超过 ±20。\n' +
      '2. 政令涉及的花费必须从国库扣除；国库不足时政令打折执行或失败，并产生相应后果。\n' +
      '3. 官僚体系有惰性与腐败：腐败越高、官僚效率越低，政令执行折扣越大。\n' +
      '4. 至少给出 0～3 个事件；重大政令应有后续隐患（future_consequences）。\n' +
      '5. 不要重复叙述政令原文；写结果与各方反应。\n' +
      '\n【严格输出格式】只输出如下结构的 JSON（所有字段必须有，数值用数字，文本用中文）：\n' +
      '{\n' +
      '  "intent": {"category":"赈灾|减税|加税|军事|吏治|工程|外交|人事|文教|宫廷|其他", "target":"目标地区或对象", "budget":估算花费数字},\n' +
      '  "turn_summary": "一句话总结",\n' +
      '  "narrative": "详细结果描述（150~400字，写明执行过程与各方反应）",\n' +
      '  "decisions": ["要点式决定清单"],\n' +
      '  "state_changes": {"treasury":0,"food":0,"population":0,"stability":0,"public_support":0,"corruption":0,"bureaucracy":0,"military_power":0,"authority":0,"morale":0,"border_pressure":0},\n' +
      '  "events": [{"title":"标题","description":"描述","severity":"low|medium|high|critical","region_id":"可选","character_id":"可选","effects":{"state_changes 同结构"}}],\n' +
      '  "npc_changes": [{"id":"人物ID","loyalty":0,"corruption":0,"trust_delta":0,"reason":"原因"}],\n' +
      '  "regional_changes": [{"region_id":"地区ID","changes":{"loyalty":0,"unrest":0,"security":0,"grain":0,"income":0,"corruption":0},"reason":"原因"}],\n' +
      '  "new_risks": ["新增风险"],\n' +
      '  "future_consequences": [{"after_turns":2,"title":"后果标题","description":"描述","severity":"low|medium|high|critical"}],\n' +
      '  "historical_record": "史官笔法的一句话记录"\n' +
      '}\n' +
      'state_changes 中不需要的字段请省略或填 0。',
    event:
      '【事件生成规则】\n' +
      '事件必须由当前世界状态因果推出（灾荒引发流民、欠饷引发哗变、腐败引发弹劾），随机性只体现在时机与细节，不能替代因果。\n' +
      '严重程度：low=琐事，medium=值得留意，high=需要应对，critical=动摇国本。',
    summary:
      '【史官评语】\n' +
      '你是王朝的史官，奉命为退位的皇帝撰写《帝王生涯评价》。请依据提供的统治数据与大事记，\n' +
      '用文言色彩的史笔撰写评语（200～350 字）：先叙其在位年数与大事，再论其功过得失，最后盖棺定论。\n' +
      '褒贬须有据，不许无原则吹捧。输出纯文本，不要 JSON。',
  };

  /* ============================ 加载提示（示意动画文案） ============================ */
  const LOADING_HINTS = [
    '分析政令……',
    '核对国库存银……',
    '计算财政影响……',
    '评估官员反应……',
    '评估地方执行……',
    '推演连锁后果……',
    '推演长期影响……',
    '史官正在落笔……',
  ];

  /* ============================ 快捷命令与示例政令 ============================ */
  const QUICK_COMMANDS = [
    { label: '召集廷议', act: { type: 'view', view: 'court' } },
    { label: '查看国库', act: { type: 'insert', text: '户部呈报国库收支明细。' } },
    { label: '查看灾情', act: { type: 'worldLayer', layer: 'disaster' } },
    { label: '查看边疆', act: { type: 'view', view: 'diplomacy' } },
    { label: '查看人物', act: { type: 'view', view: 'characters' } },
    { label: '查看实录', act: { type: 'view', view: 'history' } },
  ];

  const SAMPLE_ORDERS = [
    '拨款五十万两赈济西北灾民，并派御史监督发放。',
    '朕决定减免灾区税赋一年，但各地官府须严查贪腐。',
    '召集主要官员入宫，讨论财政改革。',
    '加征辽东军饷，命燕铁翎加固边墙。',
    '命都察院彻查江南织造亏空一案。',
    '开边市与北狄互市，以纾边患。',
    '清丈全国田亩，清理隐匿田产。',
    '缩减宫中用度，停罢不急之役。',
  ];

  /* ============================ 结局定义 ============================ */
  const ENDINGS = [
    { id: 'replace', label: '王朝更替', icon: '🏮', desc: '社稷倾覆，鼎革易帜。你的名字被写入前朝旧史。', test: (s) => s.flags.rebellionProgress >= 2 },
    { id: 'collapse', label: '政治崩溃', icon: '🕯️', desc: '皇权荡然无存，政令不出宫门，帝国在无声中瓦解。', test: (s) => s.ruler.authority <= 8 || s.country.debt >= 300000 },
    { id: 'split', label: '分裂', icon: '🧩', desc: '四方州郡各树旗号，诏书所及，不过京畿数百里。', test: (s, sc) => sc.regionsUnrestHigh >= 3 && s.country.stability <= 25 },
    { id: 'decline', label: '长期衰退', icon: '📉', desc: '没有轰然的崩塌，只有漫长的凋零。史书称之为“衰世”。', test: (s, sc) => s.turn >= 24 && sc.avg.stability < 35 && sc.avg.publicSupport < 35 },
    { id: 'military', label: '军事强国', icon: '⚔️', desc: '铁骑所至，四夷宾服。虽府库不丰，虎贲之士足以慑服天下。', test: (s, sc) => s.country.militaryPower >= 78 && s.country.borderPressure <= 30 && (s.stats.warsResolved >= 1) && sc.avg.militaryPower >= 65 },
    { id: 'economy', label: '经济强国', icon: '💰', desc: '仓廪实而知礼节，市舶之利通于四海。', test: (s, sc) => s.country.treasury >= 1500000 && sc.avg.publicSupport >= 50 },
    { id: 'reform', label: '改革成功', icon: '🛠️', desc: '弊政尽革，吏治一新。后人谈起这场变革，皆以你的年号为纪。', test: (s, sc) => s.stats.policiesAdopted >= 5 && s.country.corruption <= 32 && s.country.bureaucracy >= 72 },
    { id: 'golden', label: '盛世', icon: '🌅', desc: '路不拾遗，粟米充羡，四夷来朝。史官落笔：此盛世也。', test: (s, sc) => sc.avg.publicSupport >= 72 && sc.avg.stability >= 72 && s.country.treasury >= 800000 && s.country.corruption <= 30 },
    { id: 'revival', label: '中兴', icon: '🔥', desc: '受命于危难，扶大厦于将倾。后世谥曰：中兴之主。', test: (s, sc) => sc.avg.stability >= 55 && sc.avg.publicSupport >= 55 && s.country.stability >= 60 && s.country.publicSupport >= 58 },
    { id: 'survive', label: '苟安', icon: '🪶', desc: '无大功，亦无大过。你在风雨飘摇中守住了一个不算太坏的江山。', test: () => true },
  ];

  /* ============================ 引子（剧情开场） ============================ */
  function prologue(cfg) {
    return [
      `${cfg.year} 年，${cfg.dynastyName}，${cfg.eraName}元年。`,
      '',
      `先帝骤崩，遗诏命 ${cfg.rulerName} 于灵前即位。钟鼓未歇，八百里加急已连入宫门：`,
      '',
      '· 西北大旱三载，赤地千里，流民百万，赈银迟迟未至；',
      '· 国库岁入不敷岁出，太仓存粮不足支半年；',
      '· 辽东警讯频传，边军欠饷已逾四月，将士离心；',
      '· 朝堂之上，首辅与御史相持不下，江南逋赋积年不清；',
      '· 吏部铨选明码标价，都察院的弹章堆满了御案。',
      '',
      '司礼监捧来朱笔。从此刻起，这万里江山的每一道政令，都将出自你手。',
      '',
      '—— 观察天下 → 廷议 → 下诏 → 推演 → 见证历史的连锁反应。',
    ].join('\n');
  }

  DS.DATA = {
    REGIONS, REGION_ALIASES, CHARACTERS, CHARACTER_RELATIONS, FACTIONS,
    DIPLOMACY, POLICY_TREE, DIFFICULTIES, DISASTER_TYPES, SEVERITY_LABELS,
    SCENARIOS, DEFAULT_PROMPTS, LOADING_HINTS, QUICK_COMMANDS, SAMPLE_ORDERS,
    ENDINGS, prologue,
  };
})(window.DynastySim = window.DynastySim || {});
