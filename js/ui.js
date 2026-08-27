/* ============================================================================
 * ui.js — UI 框架层
 * ----------------------------------------------------------------------------
 * · TopBar（8 项国家指标：当前值/趋势/tooltip/最近变化原因）
 * · SideNav / MobileNav / Drawer、视图切换
 * · Modal / Confirm / Toast / LoadingOverlay（示意步骤动画，明确标注）
 * · 圣旨输入区（多行自适应高度、Ctrl+Enter 提交、防重复提交）
 * 所有渲染基于中央 State；文本一律经 el() 文本节点插入，天然防 XSS。
 * ==========================================================================*/
(function (DS) {
  'use strict';
  const { el, qs } = DS.util;

  const NAV_ITEMS = [
    { id: 'world', icon: '🗺️', key: 'nav_world' },
    { id: 'court', icon: '🏯', key: 'nav_court' },
    { id: 'characters', icon: '👥', key: 'nav_chars' },
    { id: 'policies', icon: '📜', key: 'nav_policy' },
    { id: 'events', icon: '⚡', key: 'nav_events' },
    { id: 'diplomacy', icon: '🤝', key: 'nav_diplo' },
    { id: 'history', icon: '📖', key: 'nav_history' },
    { id: 'saves', icon: '💾', key: 'nav_saves' },
    { id: 'settings', icon: '⚙️', key: 'nav_settings' },
  ];
  const MOBILE_NAV = ['world', 'court', 'characters', 'history'];

  let currentView = 'world';
  let busy = false;
  let handlers = {}; // 由 game.js 注入 {submitOrder, runCouncil, endTurn}

  /* ============================ 初始化 ============================ */
  function init(h) {
    handlers = h || handlers;
    renderNav();
    renderQuickChips();
    bindComposer();
    bindTopbarButtons();

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') dismissTopModal();
    });
    window.addEventListener('resize', DS.util.debounce(() => {
      if (DS.Game && DS.Game.state()) renderSituation();
    }, 200));
  }

  /* ============================ 导航 ============================ */
  function renderNav() {
    const t = DS.I18N.t;
    const list = qs('#nav-list');
    list.textContent = '';
    for (const item of NAV_ITEMS) {
      list.append(el('li', {},
        el('button', {
          class: 'nav-item', dataset: { view: item.id },
          onclick: () => showView(item.id),
          'aria-label': t(item.key),
        },
          el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, item.icon),
          el('span', { class: 'nav-text' }, t(item.key)),
        )));
    }
    // 移动端底部导航 + 「更多」抽屉入口
    const mlist = qs('#mobile-nav-list');
    mlist.textContent = '';
    for (const id of MOBILE_NAV) {
      const item = NAV_ITEMS.find((x) => x.id === id);
      mlist.append(el('li', {},
        el('button', { class: 'mnav-item', dataset: { view: id }, onclick: () => showView(id) },
          el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, item.icon),
          el('span', {}, t(item.key)),
        )));
    }
    mlist.append(el('li', {},
      el('button', { class: 'mnav-item', onclick: () => openDrawer() },
        el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, '☰'),
        el('span', {}, '更多'),
      )));
  }

  function setActiveNav(view) {
    currentView = view;
    DS.util.qsa('.nav-item,.mnav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  function showView(view) {
    if (!DS.Game.state()) return;
    setActiveNav(view);
    closeDrawer();
    const host = qs('#view');
    host.textContent = '';
    const renderer = DS.Views && DS.Views[view];
    if (renderer) renderer.render(host);
    else host.append(el('p', { class: 'muted' }, '（该视图尚未实现）'));
    host.scrollTop = 0;
    try { host.focus({ preventScroll: true }); } catch (_e) { /* 老浏览器 */ }
  }

  function refreshCurrent() { showView(currentView); }

  /* ============================ 顶栏 ============================ */
  function renderTopbar() {
    const state = DS.Game.state();
    if (!state) return;
    qs('#hud-dynasty').textContent = `${state.dynasty.name}·${state.ruler.eraName}`;
    qs('#hud-date').textContent = DS.util.dateLabel(state.date);
    qs('#hud-turn').textContent = `第 ${state.turn} 回合`;
    qs('#hud-seed').textContent = String(state.seed);

    const strip = qs('#metric-strip');
    strip.textContent = '';
    for (const def of DS.State.METRIC_DEFS) {
      strip.append(metricChip(def, state));
    }
    renderSituation();
    // Demo 模式横幅
    const isMock = DS.aiService.isActiveMock('simulation');
    qs('#mock-banner').hidden = !isMock;
    qs('#btn-debug-top').hidden = !DS.Storage.loadSettings().debugMode;
  }

  function metricChip(def, state) {
    const raw = def.key === 'treasury' || def.kind === 'pop'
      ? state.country[def.key]
      : Math.round(state.country[def.key] ?? state.ruler[def.key] ?? 0);
    const valueText = def.kind === 'money' ? DS.util.fmtMoney(raw)
      : def.kind === 'grain' ? DS.util.fmtRes(raw, '石')
      : def.kind === 'pop' ? DS.util.fmtRes(raw, '口')
      : String(raw);

    const trends = (state.trends[def.key] || []);
    const last = trends[0];
    const arrow = !last ? '' : last.delta > 0 ? '↑' : last.delta < 0 ? '↓' : '—';
    const deltaCls = !last ? '' : last.delta > 0 ? 'up' : last.delta < 0 ? 'down' : '';

    const chip = el('div', {
      class: 'metric-chip' + (def.inverted ? ' inverted' : ''),
      role: 'listitem', tabindex: '0',
      'aria-label': `${def.label} ${valueText}`,
    },
      el('span', { class: 'metric-name' }, def.label),
      el('span', { class: 'metric-value' }, valueText),
      el('span', { class: `metric-delta ${deltaCls}`, 'aria-hidden': 'true' }, arrow + (last ? DS.util.fmtSigned(last.delta) : '')),
    );

    const showTip = () => showTooltip(chip, buildMetricTooltip(def, trends));
    chip.addEventListener('mouseenter', showTip);
    chip.addEventListener('focus', showTip);
    chip.addEventListener('mouseleave', hideTooltip);
    chip.addEventListener('blur', hideTooltip);
    return chip;
  }

  function buildMetricTooltip(def, trends) {
    const box = el('div', { class: 'tip-body' },
      el('strong', {}, `${def.label}（${trendRange(trends)}）`),
      el('p', { class: 'muted' }, def.hint || ''));
    const recent = trends.slice(0, 3);
    if (recent.length) {
      box.append(el('div', { class: 'tip-title' }, '最近变化'));
      for (const tr of recent) {
        box.append(el('div', { class: 'tip-line' },
          el('span', { class: tr.delta > 0 ? 'good' : tr.delta < 0 ? 'bad' : '' },
            `${tr.date} ${DS.util.fmtSigned(tr.delta)}`),
          el('span', { class: 'muted' }, tr.reason || '')));
      }
    } else box.append(el('p', { class: 'muted' }, '暂无变化记录'));
    return box;
  }
  function trendRange(trends) {
    if (!trends.length) return '无记录';
    const sum = trends.slice(0, 5).reduce((a, t2) => a + t2.delta, 0);
    return `近5次合计 ${DS.util.fmtSigned(sum)}`;
  }

  /* 共享 tooltip 单例 */
  let tipEl = null;
  function showTooltip(anchor, contentNode) {
    hideTooltip();
    tipEl = el('div', { class: 'tooltip', role: 'tooltip' }, contentNode);
    document.body.append(tipEl);
    const rect = anchor.getBoundingClientRect();
    const tw = Math.min(320, window.innerWidth - 16);
    let left = DS.util.clamp(rect.left + rect.width / 2 - tw / 2, 8, window.innerWidth - tw - 8);
    let top = rect.bottom + 6;
    tipEl.style.width = tw + 'px';
    tipEl.style.left = left + 'px';
    if (top + tipEl.offsetHeight > window.innerHeight - 8) top = rect.top - tipEl.offsetHeight - 6;
    tipEl.style.top = top + 'px';
  }
  function hideTooltip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  /** 底部一句话局势 */
  function renderSituation() {
    const state = DS.Game.state();
    if (!state) return;
    const line = qs('#situation-line');
    line.textContent = '';
    line.append(el('span', { class: 'sit-tag' }, '当前局势'),
      el('span', {}, DS.State.situationLine(state)));
  }

  /* ============================ 圣旨输入区 ============================ */
  function bindComposer() {
    const input = qs('#order-input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        handlers.submitOrder && handlers.submitOrder(input.value);
      }
    });
    qs('#btn-issue').addEventListener('click', () => handlers.submitOrder && handlers.submitOrder(input.value));
    qs('#btn-council').addEventListener('click', () => showView('court'));
    qs('#btn-endturn').addEventListener('click', () => handlers.endTurn && handlers.endTurn());
  }

  function autoGrow(ev) {
    const ta = ev.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  }

  function clearOrderInput() {
    const input = qs('#order-input');
    input.value = '';
    input.style.height = '';
  }

  function setBusy(b) {
    busy = b;
    for (const id of ['#btn-issue', '#btn-endturn', '#btn-council']) {
      const btn = qs(id);
      if (btn) btn.disabled = b;
    }
    const input = qs('#order-input');
    if (input) input.readOnly = b;
  }
  function isBusy() { return busy; }

  function bindTopbarButtons() {
    qs('#btn-menu-more').addEventListener('click', openSystemMenu);
    qs('#btn-menu').addEventListener('click', openDrawer);
    qs('#drawer-mask').addEventListener('click', closeDrawer);
    qs('#btn-debug-top').addEventListener('click', () => showView('settings'));
  }

  function openSystemMenu() {
    const st = DS.Game.state();
    modal({
      title: '系统',
      build(body) {
        body.append(
          menuBtn('💾 保存游戏（写入下一空槽）', () => { DS.Game.quickSave(); }),
          menuBtn('📖 游戏说明', () => DS.UI.helpDialog()),
          menuBtn('👑 退位并生成《帝王生涯评价》', () => { DS.Game.abdicate(); }),
          st ? menuBtn(`🎲 随机种子：${st.seed}`, null) : null,
          menuBtn('ℹ️ 关于本作', () => aboutDialog()),
        );
      },
    });
  }
  function menuBtn(label, fn) {
    return el('button', { class: 'menu-btn', onclick: fn ? () => { dismissTopModal(); fn(); } : null }, label);
  }

  /* ============================ 快捷命令 chips ============================ */
  function renderQuickChips() {
    const wrap = qs('#quick-chips');
    wrap.textContent = '';
    DS.DATA.QUICK_COMMANDS.forEach((qc, i) => {
      wrap.append(el('button', {
        class: 'chip',
        onclick: () => execQuick(qc.act),
        oncontextmenu: (ev) => { ev.preventDefault(); insertSample(i); },
      }, qc.label));
    });
    // 彩蛋：右键任意 chip 循环填入示例政令
    function insertSample() {
      const samples = DS.DATA.SAMPLE_ORDERS;
      const input = qs('#order-input');
      const next = samples[(sampleIdx++) % samples.length];
      input.value = next;
      input.dispatchEvent(new Event('input'));
    }
  }
  let sampleIdx = 0;

  function execQuick(act) {
    if (act.type === 'view') showView(act.view);
    else if (act.type === 'insert') {
      const input = qs('#order-input');
      input.value = act.text;
      input.dispatchEvent(new Event('input'));
      input.focus();
    } else if (act.type === 'worldLayer') {
      showView('world');
      if (DS.Views.world.setLayer) DS.Views.world.setLayer(act.layer);
    }
  }

  /* ============================ Drawer ============================ */
  let drawerEl = null;
  function openDrawer() {
    closeDrawer();
    const t = DS.I18N.t;
    drawerEl = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '菜单' },
      el('h3', {}, '导航'),
      ...NAV_ITEMS.map((item) => el('button', {
        class: 'drawer-item', onclick: () => { closeDrawer(); showView(item.id); },
      }, el('span', { 'aria-hidden': 'true' }, item.icon), t(item.key))),
      el('hr'),
      el('button', { class: 'drawer-item', onclick: () => { closeDrawer(); DS.UI.helpDialog(); } }, '📖 游戏说明'),
      el('button', { class: 'drawer-item', onclick: () => { closeDrawer(); DS.Game.backToWelcome(); } }, '🏠 返回主菜单'),
    );
    document.body.append(drawerEl);
    qs('#drawer-mask').hidden = false;
  }
  function closeDrawer() {
    if (drawerEl) { drawerEl.remove(); drawerEl = null; }
    const mask = qs('#drawer-mask');
    if (mask) mask.hidden = true;
  }

  /* ============================ Modal ============================ */
  const modalStack = [];
  /**
   * modal({title, wide, build(bodyEl, ctx), actions:[{label,primary,onClick(close)}]})
   */
  function modal(opts) {
    const root = qs('#modal-root');
    const maskDiv = el('div', {
      class: 'modal-mask',
      onclick: (ev) => { if (ev.target === maskDiv && opts.dismissable !== false) close(); },
    });
    const dialog = el('div', {
      class: 'modal' + (opts.wide ? ' modal-wide' : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '对话框',
    });
    dialog.append(el('header', { class: 'modal-head' },
      el('h3', {}, opts.title || ''),
      el('button', { class: 'icon-btn', 'aria-label': '关闭', onclick: () => close() }, '✕')));
    const bodyEl = el('div', { class: 'modal-body' });
    dialog.append(bodyEl);
    if (opts.actions && opts.actions.length) {
      const foot = el('footer', { class: 'modal-foot' });
      for (const act of opts.actions) {
        foot.append(el('button', {
          class: 'btn' + (act.primary ? ' btn-primary' : ''),
          disabled: !!act.disabled,
          onclick: () => act.onClick ? act.onClick(close, act) : close(),
        }, act.label));
      }
      dialog.append(foot);
    }
    maskDiv.append(dialog);
    root.append(maskDiv);
    modalStack.push(close);
    if (opts.build) opts.build(bodyEl, { close });
    // 焦点管理
    const focusable = dialog.querySelector('button,[tabindex]');
    if (focusable) focusable.focus();
    function close() {
      const i = modalStack.indexOf(close);
      if (i >= 0) modalStack.splice(i, 1);
      maskDiv.remove();
    }
    return { close };
  }
  function dismissTopModal() {
    if (modalStack.length) modalStack[modalStack.length - 1]();
  }

  function confirmDialog(message, onYes, danger) {
    modal({
      title: '请确认',
      build(body) { body.append(el('p', { style: 'margin:.4rem 0 .9rem' }, message)); },
      actions: [
        { label: DS.I18N.t('btn_cancel') },
        { label: DS.I18N.t('btn_confirm'), primary: !danger, onClick: (close) => { close(); onYes && onYes(); } },
      ],
    });
  }

  /* ============================ Toast ============================ */
  function toast(msg, type = 'info', ms = 3600) {
    const root = qs('#toast-root');
    const item = el('div', { class: `toast toast-${type}`, role: 'status' }, msg);
    root.append(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 350);
    }, ms);
  }

  /* ============================ Loading ============================ */
  let loadingEl = null, hintTimer = null, loadingAbort = null;
  /**
   * @param {boolean} show
   * @param {{cancellable?:boolean,onCancel?:Function}} opts
   */
  function loading(show, opts = {}) {
    const root = qs('#loading-root');
    if (!show) {
      if (loadingEl) { loadingEl.remove(); loadingEl = null; }
      clearInterval(hintTimer); hintTimer = null; loadingAbort = null;
      return;
    }
    if (loadingEl) return;
    const t = DS.I18N.t;
    const hintSpan = el('span', { class: 'loading-hint' }, DS.DATA.LOADING_HINTS[0]);
    loadingAbort = opts.onCancel || null;
    loadingEl = el('div', { class: 'loading-mask', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': '加载中' },
      el('div', { class: 'loading-card' },
        el('div', { class: 'loading-brush', 'aria-hidden': 'true' }),
        el('p', { class: 'loading-caption' }, t('loading_caption')),
        el('p', { class: 'loading-steps' }, hintSpan, ' …',
          el('span', { class: 'muted loading-note' }, t('loading_note'))),
        opts.cancellable ? el('button', {
          class: 'btn btn-ghost', onclick: () => { if (loadingAbort) loadingAbort(); loading(false); },
        }, '取消推演') : null,
      ));
    root.append(loadingEl);
    let hi = 0;
    hintTimer = setInterval(() => {
      hi = (hi + 1) % DS.DATA.LOADING_HINTS.length;
      hintSpan.textContent = DS.DATA.LOADING_HINTS[hi];
    }, 900);
  }

  /* ============================ 帮助 / 关于 ============================ */
  function helpDialog() {
    modal({
      title: '游戏说明', wide: true,
      build(body) {
        body.append(el('div', { class: 'help-doc' },
          el('h4', {}, '玩法核心'),
          el('ol', {},
            el('li', {}, '观察天下：地图与顶部指标了解国势；点击地区看详情。'),
            el('li', {}, '廷议：在「朝堂」选择 1～3 位大臣听其意见（不同大臣立场不同）。'),
            el('li', {}, '下诏：在底部圣旨框用自然语言写政令，AI 推演因果后果。'),
            el('li', {}, '推进时间：「结束回合」推进一个月，触发经济结算、事件队列与随机事件。'),
            el('li', {}, '历史书写：一切大事记入《国史实录》，可搜索筛选。')),
          el('h4', {}, '示例政令'),
          ...DS.DATA.SAMPLE_ORDERS.map((s) => el('li', { class: 'help-sample' }, s)),
          el('h4', {}, '提示'),
          el('ul', {},
            el('li', {}, '世界有历史惯性：腐败不会一夜清零，改革有阻力和反噬。'),
            el('li', {}, '数值有上下限与单回合幅度钳制，防止崩坏。'),
            el('li', {}, '没有 API 时可玩本地 Demo 推演模式（界面会标注）。'),
            el('li', {}, '浏览器直连 API 会暴露 Key，敏感场景请使用代理模式。'))));
      },
      actions: [{ label: DS.I18N.t('btn_close'), primary: true }],
    });
  }

  function aboutDialog() {
    modal({
      title: '关于',
      build(body) {
        body.append(el('div', {},
          el('p', {}, '《王朝模拟器：天命》 — AI 原生历史王朝模拟器。'),
          el('p', { class: 'muted' }, '纯前端实现：原生 HTML/CSS/JS，无第三方依赖，数据仅保存在本机浏览器。'),
          el('p', { class: 'muted' }, '本作世界观为原创架空王朝「大晟」，不取材于任何现有商业游戏。')));
      },
      actions: [{ label: DS.I18N.t('btn_close'), primary: true }],
    });
  }

  DS.UI = {
    init, showView, refreshCurrent, renderTopbar, renderSituation,
    setBusy, isBusy, clearOrderInput,
    toast, modal, confirmDialog, loading,
    helpDialog,
    get currentView() { return currentView; },
  };
})(window.DynastySim = window.DynastySim || {});
