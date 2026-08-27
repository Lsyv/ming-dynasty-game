/* ============================================================================
 * app.js — 启动引导
 * ----------------------------------------------------------------------------
 * · 绑定欢迎界面（新游戏/读取/API设置/说明/Demo）
 * · 新游戏配置表单（剧本、王朝、年号、难度、种子）
 * · 应用主题与语言；注入 UI 事件处理器
 * ==========================================================================*/
(function (DS) {
  'use strict';
  const { el, qs } = DS.util;

  document.addEventListener('DOMContentLoaded', () => {
    const st = DS.Storage.loadSettings();
    DS.I18N.setLang(st.lang || 'zh-CN');
    DS.Views.applyTheme(st.theme);
    DS.UI.init({
      submitOrder: (text) => DS.Game.submitOrder(text),
      endTurn: () => DS.Game.endTurn(),
    });

    // 欢迎界面按钮
    qs('#w-btn-new').addEventListener('click', openNewGameForm);
    qs('#w-btn-load').addEventListener('click', () => {
      const auto = DS.Storage.readSave('auto');
      if (auto && !auto.corrupt) {
        DS.Game.loadSlot('auto');
        return;
      }
      enterAppThen(() => DS.UI.showView('saves'));
    });
    qs('#w-btn-api').addEventListener('click', () => {
      enterAppThen(() => DS.UI.showView('settings'));
    });
    qs('#w-btn-help').addEventListener('click', () => DS.UI.helpDialog());
    qs('#w-btn-demo').addEventListener('click', () => {
      // 确保三个用途都指向本地引擎
      const s = DS.Storage.loadSettings();
      for (const k of Object.keys(s.api.purposes)) s.api.purposes[k] = 'mock_local';
      DS.Storage.saveSettings(s);
      DS.UI.toast('已切换到本地 Demo 推演模式（无需任何 API）。', 'info');
      openNewGameForm(true);
    });

    // 若存在自动存档，在欢迎页追加「继续统治」
    const autoMeta = DS.Storage.listSaves().find((m) => m.slot === 'auto');
    if (autoMeta && !autoMeta.empty && !autoMeta.corrupt) {
      const btn = el('button', {
        class: 'btn btn-lg btn-primary',
        onclick: () => DS.Game.loadSlot('auto'),
      }, `⏵ 继续：${autoMeta.meta.dynasty || ''}·${autoMeta.meta.date || ''}`);
      qs('.welcome-actions').prepend(btn);
    }
  });

  function enterAppThen(fn) {
    qs('#welcome-screen').hidden = true;
    qs('#app').hidden = false;
    if (!DS.Game.rawState()) {
      // 未开局时只允许看设置/存档，不给空世界渲染视图
      fn();
      return;
    }
    DS.UI.renderTopbar();
    fn();
  }

  /* ============================ 新游戏表单 ============================ */
  function openNewGameForm(demoMode) {
    const st = DS.Storage.loadSettings();
    const scenarios = [...DS.DATA.SCENARIOS, ...DS.Storage.listScenarios()];

    const F = {};
    const field = (key, label, value, opts = {}) => {
      const inp = opts.rows
        ? el('textarea', { rows: opts.rows, value: value || '', placeholder: opts.ph || '', 'aria-label': label })
        : el('input', { type: opts.type || 'text', value: value != null ? String(value) : '', placeholder: opts.ph || '', 'aria-label': label });
      F[key] = inp;
      return kvRow(label, inp);
    };
    function kvRow(label, node) {
      return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, label), el('span', { class: 'kv-v' }, node));
    }

    const scSel = el('select', { 'aria-label': '选择剧本' },
      ...scenarios.map((sc) => el('option', { value: sc.id }, `${sc.name}${sc.builtin ? '' : '（自定义）'}`)));
    const diffWrap = el('select', { 'aria-label': '难度' },
      ...DS.DATA.DIFFICULTIES.map((d) => el('option', { value: d.id, selected: d.id === st.difficulty ? '' : null },
        `${d.label} — ${d.desc}`)));

    let curSc = scenarios[0];
    const descP = el('p', { class: 'muted small scenario-desc' }, curSc.desc);
    scSel.addEventListener('change', () => {
      curSc = scenarios.find((s) => s.id === scSel.value) || curSc;
      descP.textContent = curSc.desc;
      F.dynasty.value = curSc.dynastyName || '';
      F.country.value = curSc.countryName || '';
      F.ruler.value = curSc.rulerName || '';
      F.era.value = curSc.eraName || '';
      F.year.value = curSc.year || 1627;
    });

    DS.UI.modal({
      title: demoMode ? '新游戏（本地 Demo 推演）' : '开创新王朝',
      wide: true,
      build(body) {
        body.append(
          kvRow('剧本', scSel), descP,
          field('dynasty', '王朝名称', '大晟'),
          field('country', '国家称号', '大晟帝国'),
          field('ruler', '统治者姓名', '萧承稷'),
          field('era', '年号', '景明'),
          field('year', '起始年份', 1627, { type: 'number' }),
          kvRow('难度', diffWrap),
          field('seed', '随机种子（留空则随机）', '', { ph: '例如 1627' }),
          field('intro', '自定义历史背景（可选，将写入 AI 上下文）', '', { rows: 3, ph: '可描述你的架空世界设定……' }),
          demoMode ? el('div', { class: 'callout' }, '当前为本地 Demo 推演模式：由内置规则引擎模拟政令后果，无需 API。') : null,
        );
      },
      actions: [
        { label: '取消' },
        {
          label: '▶ 登基', primary: true, onClick: (close) => {
            const cfg = {
              dynastyName: F.dynasty.value.trim().slice(0, 12) || undefined,
              countryName: F.country.value.trim().slice(0, 20) || undefined,
              rulerName: F.ruler.value.trim().slice(0, 12) || undefined,
              eraName: F.era.value.trim().slice(0, 6) || undefined,
              year: parseInt(F.year.value, 10),
              difficulty: diffWrap.value,
              scenarioId: scSel.value,
              intro: F.intro.value.trim().slice(0, 600),
              seed: /^[0-9]+$/.test(F.seed.value.trim()) ? parseInt(F.seed.value, 10) >>> 0 : undefined,
            };
            if (!isFinite(cfg.year) || cfg.year < 1 || cfg.year > 2200) {
              DS.UI.toast('起始年份不合法（1～2200）。', 'warn');
              return;
            }
            close();
            DS.Game.newGame(cfg);
          },
        },
      ],
    });
  }

  DS.App = { openNewGameForm };
})(window.DynastySim = window.DynastySim || {});
