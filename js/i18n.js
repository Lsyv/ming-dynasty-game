/* ============================================================================
 * i18n.js — 国际化
 * ----------------------------------------------------------------------------
 * · 默认语言：zh-CN（简体中文，完整字典）
 * · zh-TW / English 为增量覆盖字典，缺失键自动回落 zh-CN
 * · 所有静态 UI 文案一律通过 t(key) 取词；动态叙事内容由 AI/Mock 生成，
 *   跟随游戏世界观使用中文（历史模拟题材特性），架构上仍可扩展。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  const ZH_CN = {
    // ── 导航与视图 ──
    nav_world: '天下', nav_court: '朝堂', nav_chars: '人物', nav_policy: '国策',
    nav_events: '事件', nav_diplo: '外交', nav_history: '实录', nav_saves: '存档',
    nav_settings: '设置',
    view_world: '天下局势', view_court: '廷议朝堂', view_chars: '朝廷人物',
    view_policy: '国策树', view_events: '事件录', view_diplo: '外交格局',
    view_history: '国史实录', view_saves: '存档管理', view_settings: '设置',

    // ── 指标 ──
    m_treasury: '国库', m_food: '粮食', m_publicSupport: '民心', m_authority: '皇权',
    m_stability: '稳定', m_corruption: '腐败', m_militaryPower: '军力', m_population: '人口',

    // ── 操作 ──
    btn_issue: '发布政令', btn_council: '召集廷议', btn_endturn: '结束回合',
    btn_save: '保存', btn_load: '读取', btn_delete: '删除', btn_export: '导出',
    btn_import: '导入', btn_close: '关闭', btn_cancel: '取消', btn_confirm: '确定',
    btn_test: '测试连接', btn_new: '新游戏', btn_back: '返回',

    // ── 提示 ──
    mock_mode_banner: '本地 Demo 推演模式',
    loading_caption: 'AI 正在生成本回合推演……',
    loading_note: '以下步骤为示意动画，实际由模型整体生成。',
    order_empty: '请先写下政令内容。',
    turn_advanced: '时间推进至 {date}（第 {turn} 回合）',
    saved_ok: '已保存：{slot}',
    no_game: '尚未开始游戏，请先创建新王朝。',

    // ── 设置分区 ──
    set_tab_ai: 'AI 接口', set_tab_sim: '推演参数', set_tab_game: '游戏',
    set_tab_prompt: 'Prompt 管理', set_tab_data: '数据', set_tab_debug: '调试',
  };

  /* 繁体中文：仅覆盖高频界面词 */
  const ZH_TW = {
    nav_world: '天下', nav_court: '朝堂', nav_chars: '人物', nav_policy: '國策',
    nav_events: '事件', nav_diplo: '外交', nav_history: '實錄', nav_saves: '存檔',
    nav_settings: '設定',
    view_world: '天下局勢', view_court: '廷議朝堂', view_chars: '朝廷人物',
    view_policy: '國策樹', view_events: '事件錄', view_diplo: '外交格局',
    view_history: '國史實錄', view_saves: '存檔管理', view_settings: '設定',
    m_treasury: '國庫', m_food: '糧食', m_publicSupport: '民心', m_authority: '皇權',
    m_stability: '穩定', m_corruption: '腐敗', m_militaryPower: '軍力', m_population: '人口',
    btn_issue: '發布政令', btn_council: '召集廷議', btn_endturn: '結束回合',
    btn_save: '儲存', btn_load: '讀取', btn_delete: '刪除', btn_export: '匯出',
    btn_import: '匯入', btn_close: '關閉', btn_cancel: '取消', btn_confirm: '確定',
    btn_test: '測試連線', btn_new: '新遊戲', btn_back: '返回',
    mock_mode_banner: '本機 Demo 推演模式',
    loading_caption: 'AI 正在產生本回合推演……',
    order_empty: '請先寫下政令內容。',
    no_game: '尚未開始遊戲，請先建立新王朝。',
  };

  /* English：核心导航覆盖（其余回落中文） */
  const EN = {
    nav_world: 'Realm', nav_court: 'Court', nav_chars: 'Figures', nav_policy: 'Policies',
    nav_events: 'Events', nav_diplo: 'Diplomacy', nav_history: 'Chronicle', nav_saves: 'Saves',
    nav_settings: 'Settings',
    m_treasury: 'Treasury', m_food: 'Grain', m_publicSupport: 'Support', m_authority: 'Authority',
    m_stability: 'Stability', m_corruption: 'Corruption', m_militaryPower: 'Military', m_population: 'People',
    btn_issue: 'Issue Edict', btn_council: 'Convene Council', btn_endturn: 'End Turn',
    mock_mode_banner: 'Local Demo Mode',
  };

  const DICTS = { 'zh-CN': ZH_CN, 'zh-TW': ZH_TW, 'en': EN };
  let currentLang = 'zh-CN';

  /** 取词：{name} 形式变量插值；缺失时回落 zh-CN，再回落 key 本身 */
  function t(key, vars) {
    const dict = DICTS[currentLang] || {};
    // 双模式：无参调用返回当前语言完整词条表（供视图层 t().key 用法）
    if (key === undefined) return Object.assign({}, ZH_CN, dict);
    let s = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (ZH_CN[key] ?? key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  function setLang(lang) {
    if (!DICTS[lang]) lang = 'zh-CN';
    currentLang = lang;
    document.documentElement.lang = lang;
    applyStatic();
  }
  function getLang() { return currentLang; }

  /** 扫描 data-i18n 属性的静态节点并替换文本（供少量静态 HTML 使用） */
  function applyStatic(root) {
    if (typeof document === 'undefined') return;
    const scope = root || document;
    DS.util.qsa('[data-i18n]', scope).forEach((n) => {
      const k = n.getAttribute('data-i18n');
      const v = t(k);
      if (v && v !== k) n.textContent = v;
    });
  }

  DS.I18N = { t, setLang, getLang, applyStatic, LANGUAGES: [
    { id: 'zh-CN', label: '简体中文' },
    { id: 'zh-TW', label: '繁體中文' },
    { id: 'en', label: 'English' },
  ] };
})(window.DynastySim = window.DynastySim || {});
