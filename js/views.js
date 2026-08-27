/* ============================================================================
 * views.js — 功能视图集
 * ----------------------------------------------------------------------------
 * world 天下(地图+图层+地区详情+事件队列) / court 朝堂廷议 / characters 人物与召见
 * policies 国策树 / events 事件录 / diplomacy 外交 / history 国史实录
 * saves 存档管理 / settings 设置(AI·推演·游戏·Prompt·数据·调试Inspector)
 * 所有动态文本经 el() 文本节点渲染（XSS 安全）。
 * ==========================================================================*/
(function (DS) {
  'use strict';
  const { el, qs } = DS.util;
  const t = () => DS.I18N.t(); // 返回当前语言词条表；用法 t().key

  /* ============================ 小组件 ============================ */
  function sectionTitle(txt, extra) {
    return el('div', { class: 'sec-title' }, el('h3', {}, txt), extra || null);
  }
  function bar(v, cls, label) {
    const pct = DS.util.clamp(Math.round(v), 0, 100);
    return el('div', { class: 'bar-wrap', role: 'img', 'aria-label': `${label || ''} ${pct}%` },
      el('div', { class: `bar ${cls || ''}` , style: `width:${pct}%` }),
      el('span', { class: 'bar-num' }, String(pct)));
  }
  function severityTag(sev) {
    const map = { low: ['低', 'sev-low'], medium: ['中', 'sev-medium'], high: ['高', 'sev-high'], critical: ['危', 'sev-critical'] };
    const [txt, cls] = map[sev] || map.medium;
    return el('span', { class: `tag ${cls}` }, txt);
  }
  function kv(label, valueNode) {
    return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, label), el('span', { class: 'kv-v' }, valueNode));
  }
  function portrait(c, size) {
    return el('div', {
      class: 'portrait',
      style: `--h:${c.hue || 200};width:${size || 52}px;height:${size || 52}px;font-size:${(size || 52) * 0.42}px`,
      'aria-hidden': 'true',
    }, c.name[0]);
  }
  function emptyHint(txt) { return el('p', { class: 'muted center' }, txt); }

  /* ============================================================
   * 天下视图
   * ============================================================ */
  let worldLayer = 'standard';
  let selectedRegion = null;

  const worldView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      selectedRegion = selectedRegion && DS.State.getRegion(state, selectedRegion) ? selectedRegion : null;

      // 图层切换条
      const layerBar = el('div', { class: 'layer-bar', role: 'toolbar', 'aria-label': '地图图层' },
        ...DS.MapView.LAYERS.map((l) => el('button', {
          class: 'chip layer-chip' + (l.id === worldLayer ? ' active' : ''),
          onclick: () => { worldLayer = l.id; worldView.render(host); },
        }, l.label)));

      const mapBox = el('div', { class: 'map-box' });
      DS.MapView.render(mapBox, state, worldLayer, (rid) => {
        selectedRegion = rid;
        worldView.render(host);
        renderRegionDetail(detailBox, rid);
      });

      host.append(
        sectionTitle(t().view_world),
        el('div', { class: 'world-grid' },
          el('div', { class: 'map-panel panel' }, layerBar, mapBox,
            el('p', { class: 'muted map-hint' }, '点击地区查看详情 · 图层切换显示不同维度')),
          el('div', { class: 'side-col' },
            (detailBox = el('div', { class: 'panel region-detail' })),
            pendingQueuePanel(state)),
        ),
      );
      if (selectedRegion) renderRegionDetail(detailBox, selectedRegion);
      else detailBox.append(emptyHint('点击左侧地图任意地区，查看当地民情、财政与灾害。'));
    },
    setLayer(l) { worldLayer = l; DS.UI.refreshCurrent(); },
  };
  let detailBox = null;

  function pendingQueuePanel(state) {
    const pe = state.pendingEvents || [];
    return el('div', { class: 'panel' },
      el('h4', {}, `事件队列（${pe.length}）`),
      pe.length === 0
        ? emptyHint('暂无待触发隐患。')
        : el('ul', { class: 'queue-list' },
          ...pe.slice(0, 6).map((p) => el('li', {},
            el('div', {}, severityTag(p.severity), ` 第 ${p.dueTurn} 回合：${p.title}`),
            el('div', { class: 'muted small' }, p.description)))),
    );
  }

  function renderRegionDetail(box, rid) {
    box.textContent = '';
    const state = DS.Game.state();
    const r = DS.State.getRegion(state, rid);
    if (!r) return;
    box.textContent = '';
    const gov = r.governor ? DS.State.getCharacter(state, r.governor) : null;
    box.append(
      el('h4', {}, `${r.name}`, gov ? el('span', { class: 'muted small' }, `　巡抚/镇守：${gov.name}`) : null),
      el('p', { class: 'muted' }, r.desc),
      r.disaster ? el('p', { class: 'disaster-line' }, `⚠ 当前灾情：${r.disaster.type}（强度 ${r.disaster.severity}/5，${DS.DATA.SEVERITY_LABELS[r.disaster.severity]}）`) : null,
      kv('人口', DS.util.fmtRes(r.population, '口')),
      kv('存粮', DS.util.fmtRes(r.grain, '石')),
      kv('月入税基', DS.util.fmtMoney(r.income)),
      kv('税率', `${r.taxRate}%`),
      kv('民心', bar(r.loyalty, 'good', '民心')),
      kv('治安', bar(r.security, '', '治安')),
      kv('腐败', bar(r.corruption, 'bad', '腐败')),
      kv('叛乱风险', bar(r.unrest, r.unrest >= 70 ? 'bad' : r.unrest >= 45 ? 'warn' : '', '叛乱风险')),
      el('div', { class: 'row-gap' },
        gov ? el('button', {
          class: 'btn btn-sm',
          onclick: () => DS.UI.showView('characters'),
        }, '查看此地官员') : null),
    );
  }

  /* ============================================================
   * 朝堂视图（廷议）
   * ============================================================ */
  const courtSel = new Set();
  const courtView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      [...courtSel].forEach((id) => { if (!DS.State.getCharacter(state, id)) courtSel.delete(id); });
      while (courtSel.size > 3) courtSel.delete([...courtSel][0]);

      const grid = el('div', { class: 'court-grid' },
        ...state.characters.map((c) => {
          const picked = courtSel.has(c.id);
          return el('button', {
            class: 'court-card' + (picked ? ' picked' : ''),
            'aria-pressed': picked,
            onclick: () => {
              if (courtSel.has(c.id)) courtSel.delete(c.id);
              else { if (courtSel.size >= 3) { DS.UI.toast('一次至多召对三位大臣。', 'warn'); return; } courtSel.add(c.id); }
              courtView.render(host);
            },
          },
            portrait(c, 40),
            el('div', { class: 'court-card-info' },
              el('strong', {}, c.name),
              el('div', { class: 'muted small' }, `${c.role} · ${c.faction}`),
              el('div', { class: 'small' }, `忠${Math.round(c.loyalty)} 能${c.ability} 信${Math.round(c.trust)}`)),
          );
        }));

      host.append(
        sectionTitle(t().view_court, el('span', { class: 'muted small' }, '选择 1～3 位大臣听其意见；不同大臣立场不同。')),
        grid,
        el('div', { class: 'row-gap' },
          el('button', {
            class: 'btn btn-primary',
            disabled: courtSel.size === 0 || DS.UI.isBusy(),
            onclick: () => DS.Game.runCouncil([...courtSel]),
          }, `召集廷议（已选 ${courtSel.size}/3）`),
          el('button', { class: 'btn', onclick: () => { courtSel.clear(); courtView.render(host); } }, '清空选择')),

        transcriptPanel(state),
      );
    },
  };

  function transcriptPanel(state) {
    const logs = (state.councilLog || []).slice(0, 5); // 最近五次廷议
    if (!logs.length) return emptyHint('尚未举行廷议。选择大臣后点「召集廷议」。');
    return el('div', { class: 'panel' },
      ...logs.map((log) => el('div', { class: 'council-session' },
        el('h4', {}, `${log.date} 廷议　`,
          el('span', { class: 'muted small' }, log.consensus)),
        ...log.speeches.map((sp) => el('blockquote', { class: 'speech' },
          el('footer', { class: 'speech-head' },
            el('strong', {}, sp.name),
            el('span', { class: 'muted small' }, `${sp.role} · 立场：${sp.stance} · ${supportLabel(sp.support)}`)),
          el('p', {}, sp.content),
          el('button', {
            class: 'btn btn-sm',
            title: '把该建议写入圣旨输入框，并记录君臣信任变化',
            onclick: () => DS.Game.adoptAdvice(sp.characterId, sp.content),
          }, '采纳此议 ▸'))))));
  }
  function supportLabel(s) { return s === 'support' ? '赞同' : s === 'oppose' ? '反对' : '保留'; }

  /* ============================================================
   * 人物视图
   * ============================================================ */
  const charsView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      host.append(sectionTitle(t().view_chars, el('span', { class: 'muted small' }, '点击人物查看详情并可「召见」问对。')));
      const grid = el('div', { class: 'char-grid' });
      for (const c of state.characters) {
        grid.append(el('button', {
          class: 'char-card',
          onclick: () => characterModal(c.id),
          'aria-label': `${c.name}，${c.role}`,
        },
          portrait(c),
          el('div', { class: 'char-info' },
            el('strong', {}, c.name),
            el('div', { class: 'muted small' }, `${c.role} · ${c.faction}`),
            el('div', { class: 'small' }, `忠诚 ${Math.round(c.loyalty)}｜信任 ${Math.round(c.trust)}｜能力 ${c.ability}`)),
        ));
      }
      host.append(grid);
    },
  };

  function characterModal(id) {
    const state = DS.Game.state();
    const c = DS.State.getCharacter(state, id);
    if (!c) return;
    const secretRevealed = (state.flags.revealedSecrets || []).includes(c.id);

    DS.UI.modal({
      title: `${c.name} · ${c.role}`, wide: true,
      build(body, ctx) {
        const rels = Object.entries(c.relationships || {}).map(([oid, r]) => {
          const o = DS.State.getCharacter(state, oid);
          return o ? `${o.name}（${r.type}）` : null;
        }).filter(Boolean);

        body.append(el('div', { class: 'char-detail' },
          el('div', { class: 'char-head' },
            portrait(c, 72),
            el('div', {},
              el('p', {}, c.desc),
              el('p', { class: 'small muted' }, `性格：${c.personality.join(' · ')}`))),
          el('div', { class: 'kv-grid' },
            kv('派系', c.faction), kv('年龄', `${c.age}`),
            kv('忠诚', bar(c.loyalty, c.loyalty < 40 ? 'bad' : '')),
            kv('对陛下的信任', bar(c.trust, '')),
            kv('能力', bar(c.ability, '')), kv('野心', bar(c.ambition, 'warn')),
            kv('贪腐倾向', bar(c.corruption, 'bad')),
            kv('当前事务', c.task)),
          rels.length ? kv('人物关系', rels.join('、')) : null,
          kv('近期言行', c.dialogueMemory.length
            ? el('ul', { class: 'mini-list' }, ...c.dialogueMemory.slice(-3).reverse().map((m) => el('li', { class: 'small' }, m)))
            : '（尚无）'),
          el('div', { class: 'secret-line' },
            el('strong', {}, '秘密情报：'),
            c.secrets.length
              ? (secretRevealed
                ? el('span', { class: 'secret-open' }, c.secrets.join('；'))
                : el('span', { class: 'muted' }, `已探明 ${c.secrets.length} 条（未揭示）`))
              : el('span', { class: 'muted' }, '未发现'),
            (!secretRevealed && c.secrets.length) ? el('button', {
              class: 'btn btn-sm', style: 'margin-left:.6rem',
              onclick: () => { ctx.close(); DS.Game.investigateSecret(c.id); },
            }, '命缇骑密查') : null),
        ));

        // 对话记录容器
        const chatBox = el('div', { class: 'chat-box', 'aria-live': 'polite' });
        renderChatHistory(chatBox, c);
        const ta = el('textarea', { class: 'chat-input', rows: '2', placeholder: `向 ${c.name} 问话……（例如：你怎么看现在的财政危机？）`, 'aria-label': '对话输入' });
        const sendBtn = el('button', { class: 'btn btn-primary', onclick: doSend }, '召见问对');
        function doSend() {
          const msg = ta.value.trim();
          if (!msg || sendBtn.disabled) return;
          sendBtn.disabled = true;
          ta.value = '';
          DS.Game.talkTo(c.id, msg).finally(() => {
            sendBtn.disabled = false;
            renderChatHistory(chatBox, c);
            chatBox.scrollTop = chatBox.scrollHeight;
          }).catch(() => {});
        }
        ta.addEventListener('keydown', (ev) => {
          if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') doSend();
        });
        body.append(el('hr'), el('h4', {}, '召见问对'), chatBox,
          el('div', { class: 'chat-compose' }, ta, sendBtn));
      },
      actions: [{ label: t().btn_close }],
    });
  }

  function renderChatHistory(box, c) {
    box.textContent = '';
    box.textContent = '';
    if (!c.dialogueMemory.length) {
      box.append(emptyHint('君臣尚未交谈。'));
      return;
    }
    for (const m of c.dialogueMemory.slice(-8)) {
      const mine = m.startsWith('【陛下】');
      box.append(el('div', { class: `chat-msg ${mine ? 'mine' : 'theirs'}` }, m.replace(/^【[^】]+】/, '')));
    }
  }

  /* ============================================================
   * 国策视图
   * ============================================================ */
  const CATS = ['政治', '财政', '农业', '军事', '教育', '科技', '外交', '民生', '行政'];
  const policiesView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      host.append(sectionTitle(t().view_policy, el('span', { class: 'muted small' }, '国策只改变世界规则参数；事件仍由世界状态与推演产生。')));
      for (const cat of CATS) {
        const items = state.policiesKnown.filter((p) => p.cat === cat);
        if (!items.length) continue;
        host.append(el('details', { class: 'policy-cat', open: 'true' },
          el('summary', {}, `${cat}（${items.filter((p) => state.activePolicies.includes(p.id)).length}/${items.length}）`),
          el('div', { class: 'policy-list' },
            ...items.map((p) => policyCard(state, p)))));
      }
    },
  };

  function policyCard(state, p) {
    const adopted = state.activePolicies.includes(p.id);
    const missingPrereq = (p.prereq || []).filter((pid) => !state.activePolicies.includes(pid));
    const canAfford = state.country.treasury >= p.cost;
    const namesOf = (ids) => ids.map((pid) => (state.policiesKnown.find((x) => x.id === pid) || {}).name).filter(Boolean).join('、');
    return el('div', { class: 'policy-card' + (adopted ? ' adopted' : '') },
      el('header', {}, el('strong', {}, p.name),
        adopted ? el('span', { class: 'tag tag-ok' }, '已推行') : null),
      el('p', { class: 'small muted' }, p.side),
      kv('成本', DS.util.fmtMoney(p.cost)),
      (p.prereq && p.prereq.length) ? kv('前置', namesOf(p.prereq) + (missingPrereq.length ? '（未满足）' : '')) : null,
      kv('即时效果', describeChanges(p.instant)),
      Object.keys(p.ongoing || {}).length ? kv('持续效果', describeOngoing(p.ongoing)) : null,
      !adopted ? el('button', {
        class: 'btn btn-sm btn-primary',
        disabled: missingPrereq.length > 0 || !canAfford,
        title: !canAfford ? '国库不足' : '',
        onclick: () => DS.Game.adoptPolicy(p.id),
      }, canAfford ? '推行此策' : '国库不足') : null);
  }
  function describeChanges(ch) {
    if (!ch) return '—';
    const names = { treasury: '国库', food: '粮食', publicSupport: '民心', stability: '稳定', corruption: '腐败', bureaucracy: '官僚效率', militaryPower: '军力', authority: '皇权', morale: '士气' };
    return Object.entries(ch).map(([k, v]) => `${names[k] || k} ${v > 0 ? '+' : ''}${v}`).join('，') || '—';
  }
  function describeOngoing(o) {
    const names = { incomeMult: '岁入', grainMult: '粮产', tradeMult: '贸易', armyPayMult: '军费', reliefEffMult: '赈济' };
    return Object.entries(o).map(([k, v]) => k.endsWith('Mult')
      ? `${names[k] || k} ${(v > 0 ? '+' : '') + Math.round(v * 100)}%`
      : ({ corruptionDrift: '腐败漂移', loyaltyDrift: '民心漂移', securityBonus: '治安', borderDefenseBonus: '边防', adminBonus: '行政效率' }[k] || k) + ' ' + (v > 0 ? '+' : '') + v
    ).join('，');
  }

  /* ============================================================
   * 事件视图
   * ============================================================ */
  const evtFilter = { sev: 'all', cat: 'all' };
  const eventsView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      const sevSel = el('select', { 'aria-label': '按严重程度筛选' },
        el('option', { value: 'all' }, '全部程度'),
        ...['critical', 'high', 'medium', 'low'].map((s) => el('option', { value: s, selected: evtFilter.sev === s ? '' : null },
          { critical: '危机', high: '严重', medium: '一般', low: '轻微' }[s])));
      const cats = [...new Set(state.events.map((e) => e.category))];
      const catSel = el('select', { 'aria-label': '按类别筛选' },
        el('option', { value: 'all' }, '全部类别'),
        ...cats.map((ct) => el('option', { value: ct, selected: evtFilter.cat === ct ? '' : null }, ct)));
      sevSel.addEventListener('change', () => { evtFilter.sev = sevSel.value; eventsView.render(host); });
      catSel.addEventListener('change', () => { evtFilter.cat = catSel.value; eventsView.render(host); });

      let list = state.events;
      if (evtFilter.sev !== 'all') list = list.filter((e) => e.severity === evtFilter.sev);
      if (evtFilter.cat !== 'all') list = list.filter((e) => e.category === evtFilter.cat);
      list = list.slice(0, 80);

      host.append(sectionTitle(t().view_events, el('span', { class: 'filters' }, sevSel, catSel)));
      if (!list.length) host.append(emptyHint('暂无符合条件的事件。'));
      for (const e of list) {
        const region = e.regionId ? DS.State.getRegion(state, e.regionId) : null;
        const person = e.characterId ? DS.State.getCharacter(state, e.characterId) : null;
        host.append(el('article', { class: `event-card sev-${e.severity}` },
          el('header', {}, severityTag(e.severity), el('strong', {}, ` ${e.title}`)),
          el('div', { class: 'muted small' }, `${e.date} · ${e.category}${region ? ' · ' + region.name : ''}${person ? ' · ' + person.name : ''}`),
          el('p', { class: 'event-desc' }, e.description)));
      }
    },
  };

  /* ============================================================
   * 外交视图
   * ============================================================ */
  const diploView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      host.append(sectionTitle(t().view_diplo, el('span', { class: 'muted small' }, '可对任何势力以自然语言下诏（互市、和亲、岁币、宣战……）。')));
      for (const d of state.diplomacy) {
        const relCls = d.relation <= -30 ? 'bad' : d.relation >= 30 ? 'good' : '';
        host.append(el('article', { class: 'diplo-card panel' },
          el('header', {}, el('strong', {}, d.name), el('span', { class: 'tag' }, d.type),
            d.borderPressure >= 60 ? el('span', { class: 'tag sev-high' }, '边警') : null),
          el('p', { class: 'muted small' }, d.desc),
          el('div', { class: 'kv-grid' },
            kv('关系', bar((d.relation + 100) / 2, relCls, '关系')),
            kv('信任', bar(d.trust, '', '信任')),
            kv('贸易', bar(d.trade, '', '贸易')),
            kv('威胁', bar(d.threat, 'bad', '威胁')),
            kv('边压', bar(d.borderPressure, d.borderPressure >= 60 ? 'bad' : '', '边境压力')))));
      }
    },
  };

  /* ============================================================
   * 国史实录视图
   * ============================================================ */
  const histState = { q: '', year: 'all', type: 'all', page: 0, pageSize: 40 };
  const historyView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      histState.q = histState.q || '';

      const search = el('input', { type: 'search', placeholder: '搜索标题/描述关键词…', value: histState.q, 'aria-label': '搜索实录' });
      search.addEventListener('input', DS.util.debounce(() => {
        histState.q = search.value.trim();
        histState.page = 0;
        historyView.render(host);
      }, 250));

      const years = [...new Set(state.history.map((h) => h.date.split(' 年')[0]))].sort().reverse();
      const yearSel = el('select', { 'aria-label': '按年份筛选' },
        el('option', { value: 'all' }, '全部年份'),
        ...years.map((y) => el('option', { value: y, selected: histState.year === y ? '' : null }, y + ' 年')));
      yearSel.addEventListener('change', () => { histState.year = yearSel.value; histState.page = 0; historyView.render(host); });

      const types = [['all', '全部类型'], ['system', '系统'], ['order', '政令'], ['event', '事件'], ['relation', '人物关系'], ['policy', '国策']];
      const typeSel = el('select', { 'aria-label': '按类型筛选' },
        ...types.map(([v, lbl]) => el('option', { value: v, selected: histState.type === v ? '' : null }, lbl)));
      typeSel.addEventListener('change', () => { histState.type = typeSel.value; histState.page = 0; historyView.render(host); });

      let list = state.history;
      if (histState.year !== 'all') list = list.filter((h) => h.date.startsWith(histState.year + ' 年'));
      if (histState.type !== 'all') list = list.filter((h) => h.type === histState.type);
      if (histState.q) list = list.filter((h) => (h.title + h.description).includes(histState.q));

      const pages = Math.max(1, Math.ceil(list.length / histState.pageSize));
      histState.page = DS.util.clamp(histState.page, 0, pages - 1);
      const pageItems = list.slice(histState.page * histState.pageSize, (histState.page + 1) * histState.pageSize);

      host.append(sectionTitle(`《国史实录》`, el('span', { class: 'muted small' }, `共 ${list.length} 条`)),
        el('div', { class: 'hist-filters' }, search, yearSel, typeSel));

      if (!pageItems.length) host.append(emptyHint('没有符合条件的记录。'));
      const ul = el('ul', { class: 'hist-list' });
      for (const h of pageItems) {
        ul.append(el('li', { class: `hist-item type-${h.type}` },
          el('div', { class: 'hist-date' }, h.date),
          el('div', {},
            el('div', {}, el('strong', {}, h.title), el('span', { class: 'tag' }, typeName(h.type))),
            h.description ? el('p', { class: 'muted small' }, h.description) : null)));
      }
      host.append(ul);

      const pager = el('div', { class: 'pager' },
        el('button', { class: 'btn btn-sm', disabled: histState.page === 0 ? true : null, onclick: () => { histState.page--; historyView.render(host); } }, '‹ 上一页'),
        el('span', { class: 'muted small' }, `第 ${histState.page + 1} / ${pages} 页`),
        el('button', { class: 'btn btn-sm', disabled: histState.page >= pages - 1 ? true : null, onclick: () => { histState.page++; historyView.render(host); } }, '下一页 ›'));
      host.append(pager);
    },
  };
  function typeName(tp) {
    return ({ system: '系统', order: '政令', event: '事件', relation: '关系', policy: '国策' })[tp] || tp;
  }

  /* ============================================================
   * 存档视图
   * ============================================================ */
  const savesView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const state = DS.Game.state();
      host.append(sectionTitle(t().view_saves, el('span', { class: 'muted small' }, '自动保存于每次结束回合后写入 auto 槽。')));

      for (const meta of DS.Storage.listSaves()) {
        const row = el('div', { class: 'save-row' },
          el('div', { class: 'save-slot' }, meta.slot === 'auto' ? '自动' : meta.slot.toUpperCase()),
          meta.empty
            ? el('div', { class: 'muted' }, '—— 空 ——')
            : el('div', { class: 'save-meta' },
              el('div', {}, `${meta.meta.dynasty || ''} ${meta.meta.ruler || ''} · ${meta.meta.date || ''} · 第 ${meta.meta.turn || '?'} 回合`),
              el('div', { class: 'muted small' }, new Date(meta.timestamp).toLocaleString('zh-CN') + (meta.checksumMismatch ? ' ⚠ 校验和不匹配' : '') + (meta.label ? ' · ' + meta.label : ''))),
          el('div', { class: 'save-actions' },
            !meta.empty ? el('button', {
              class: 'btn btn-sm', disabled: !state,
              onclick: () => DS.UI.confirmDialog(`读取存档「${meta.slot}」？当前未保存的进度将丢失。`, () => DS.Game.loadSlot(meta.slot)),
            }, t().btn_load) : null,
            el('button', {
              class: 'btn btn-sm btn-primary', disabled: !state,
              onclick: () => DS.Game.saveToSlot(meta.slot),
            }, t().btn_save),
            !meta.empty ? el('button', { class: 'btn btn-sm', onclick: () => { try { DS.Storage.exportSave(meta.slot); } catch (e) { DS.UI.toast(e.message, 'error'); } } }, t().btn_export) : null,
            !meta.empty ? el('button', {
              class: 'btn btn-sm btn-danger',
              onclick: () => DS.UI.confirmDialog(`删除存档「${meta.slot}」？该操作不可撤销。`, () => { DS.Storage.deleteSave(meta.slot); savesView.render(host); DS.UI.toast('已删除'); }, true),
            }, t().btn_delete) : null));
        host.append(row);
      }

      // 导入
      const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        try {
          const text = await DS.util.readFileText(f);
          const res = DS.Storage.importSave(text);
          DS.UI.toast(`导入成功，已写入 ${res.slot}` + (res.checksumMismatch ? '（⚠ 校验和不匹配）' : ''), 'success');
          savesView.render(host);
        } catch (e) { DS.UI.toast('导入失败：' + e.message, 'error', 6000); }
      });
      host.append(el('div', { class: 'row-gap', style: 'margin-top:1rem' },
        el('button', { class: 'btn', onclick: () => fileInput.click() }, '📂 导入存档文件'),
        fileInput));
    },
  };

  /* ============================================================
   * 设置视图
   * ============================================================ */
  let setTab = 'ai';
  let editingProfileId = null;

  const settingsView = {
    render(host) {
      host.textContent = ''; // 幂等：内部重渲染时先清空，避免新旧 DOM 并存
      const tabs = [
        ['ai', t().set_tab_ai], ['sim', t().set_tab_sim], ['game', t().set_tab_game],
        ['prompt', t().set_tab_prompt], ['data', t().set_tab_data], ['debug', t().set_tab_debug],
      ];
      host.append(sectionTitle(t().view_settings),
        el('div', { class: 'tabs', role: 'tablist' },
          ...tabs.map(([id, label]) => el('button', {
            class: 'tab' + (setTab === id ? ' active' : ''), role: 'tab',
            'aria-selected': setTab === id,
            onclick: () => { setTab = id; settingsView.render(host); },
          }, label))),
        el('div', { class: 'settings-body' }));
      const body = qs('.settings-body', host);
      ({ ai: renderAiTab, sim: renderSimTab, game: renderGameTab, prompt: renderPromptTab, data: renderDataTab, debug: renderDebugTab }[setTab])(body);
    },
  };

  /* ---------------- AI 标签页 ---------------- */
  function renderAiTab(body) {
    const st = DS.Storage.loadSettings();

    // Profile 列表
    const listBox = el('div', { class: 'profile-list' });
    for (const p of st.api.profiles) {
      listBox.append(el('div', { class: 'profile-row' + (editingProfileId === p.id ? ' editing' : '') },
        el('div', {},
          el('strong', {}, p.name),
          el('span', { class: 'tag' }, kindLabel(p.kind)),
          p.kind !== 'mock' ? el('div', { class: 'muted small' }, `${p.baseUrl || ''} · ${p.model || ''}`) : null),
        el('div', { class: 'row-gap' },
          el('button', { class: 'btn btn-sm', onclick: () => { editingProfileId = p.id; settingsView.render(body.parentNode); } }, '编辑'),
          p.kind !== 'mock' ? el('button', {
            class: 'btn btn-sm', onclick: async (ev) => {
              const btn = ev.target; btn.disabled = true; btn.textContent = '测试中…';
              try {
                const r = await DS.aiService.testProfile(p.id);
                DS.UI.modal({
                  title: '连接成功 ✓',
                  build(b) {
                    b.append(kv('模型', r.model), kv('响应时间', `${r.latencyMs} ms`), kv('回复', r.reply));
                  },
                  actions: [{ label: t().btn_close, primary: true }],
                });
              } catch (e) { showApiError(e); }
              btn.disabled = false; btn.textContent = t().btn_test;
            },
          }, t().btn_test) : null,
          p.kind !== 'mock' ? el('button', {
            class: 'btn btn-sm',
            onclick: () => {
              const copy = JSON.parse(JSON.stringify(p));
              copy.id = 'prof_' + DS.util.uid('').slice(2);
              copy.name += ' 副本';
              copy.apiKey = '';
              st.api.profiles.push(copy);
              persistAndRerender(st, body);
            },
          }, '复制') : null,
          p.kind !== 'mock' ? el('button', { class: 'btn btn-sm', onclick: () => exportProfile(p) }, '导出') : null,
          p.kind !== 'mock' ? el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: () => DS.UI.confirmDialog(`删除配置「${p.name}」？`, () => {
              st.api.profiles = st.api.profiles.filter((x) => x.id !== p.id);
              for (const k of Object.keys(st.api.purposes)) if (st.api.purposes[k] === p.id) st.api.purposes[k] = 'mock_local';
              if (editingProfileId === p.id) editingProfileId = null;
              persistAndRerender(st, body);
            }, true),
          }, t().btn_delete) : null)));
    }

    body.append(
      el('div', { class: 'callout callout-warn' },
        '安全提示：纯前端页面直连 API 时，API Key 会暴露在浏览器网络请求中。敏感 Key 请使用「代理 URL」模式（Browser → 你的代理 → AI API）。本作不会、也绝不声称浏览器端保存的 Key 是安全的。',
      ),
      sectionTitle('API 配置（Profiles）', el('div', { class: 'row-gap' },
        el('button', { class: 'btn btn-sm btn-primary', onclick: () => { editingProfileId = 'NEW'; settingsView.render(body.parentNode); } }, '＋ 新建配置'),
        el('button', { class: 'btn btn-sm', onclick: () => profileFileInput(body) }, '导入配置'),
      )),
      listBox);

    // 编辑表单
    const editing = editingProfileId === 'NEW'
      ? blankProfile()
      : st.api.profiles.find((p) => p.id === editingProfileId);
    if (editing) renderProfileForm(body, st, editing);

    // 用途映射（多模型）
    body.append(sectionTitle('模型用途分配（可为不同任务使用不同模型）'));
    const purposeBox = el('div', {});
    for (const [key, label] of [['simulation', '政令推演'], ['dialogue', 'NPC 对话'], ['summary', '史官评语']]) {
      const sel = el('select', { 'aria-label': label });
      for (const p of st.api.profiles) sel.append(el('option', { value: p.id, selected: st.api.purposes[key] === p.id ? '' : null }, p.name));
      sel.addEventListener('change', () => { st.api.purposes[key] = sel.value; DS.Storage.saveSettings(st); DS.UI.renderTopbar(); });
      purposeBox.append(kv(label, sel));
    }
    body.append(purposeBox);

    // Token 控制
    body.append(sectionTitle('Token 与请求控制'));
    const num = (key, label, min, max, stepv, hintv) => {
      const inp = el('input', { type: 'number', min, max, step: stepv, value: st.ai[key], 'aria-label': label });
      inp.addEventListener('change', () => {
        st.ai[key] = DS.util.clamp(Number(inp.value) || min, min, max);
        DS.Storage.saveSettings(st);
      });
      const wrap = kv(label + (hintv ? `（${hintv}）` : ''), inp);
      return wrap;
    };
    body.append(num('timeoutMs', '超时（毫秒）', 5000, 300000, 1000),
      num('maxRetries', 'JSON 失败自动重试次数', 0, 3, 1),
      quickModeSelect(st));
    body.append(el('p', { class: 'muted small' }, '注：temperature/top_p 等参数是否生效取决于具体 API 的支持情况；快速/标准/高质量仅改变默认 max_tokens 建议，不保证所有服务都遵守。'));

    // CORS 说明
    body.append(el('div', { class: 'callout' },
      'CORS 提示：部分 API 不允许浏览器跨域请求。如果控制台出现 CORS 错误，请改用支持 CORS 的 API 服务，或自行部署后端代理并填写「代理 URL」。'));
  }

  function quickModeSelect(st) {
    const modes = [['fast', '快速（max_tokens≈800）'], ['standard', '标准（≈2000）'], ['quality', '高质量（≈4000）']];
    const sel = el('select', { 'aria-label': '推理质量' },
      ...modes.map(([v, l]) => el('option', { value: v, selected: st.ai.quickMode === v ? '' : null }, l)));
    sel.addEventListener('change', () => {
      st.ai.quickMode = sel.value;
      const suggest = { fast: 1500, standard: 4000, quality: 8000 }[sel.value];
      for (const p of st.api.profiles) if (p.kind !== 'mock') p.maxTokens = suggest;
      DS.Storage.saveSettings(st);
      DS.UI.toast(`已应用「${sel.value}」预设到所有配置（max_tokens=${suggest}）。推理模型请选「质量优先」。`);
    });
    return kv('推理质量预设', sel);
  }

  function kindLabel(kind) {
    return { mock: '本地 Demo', custom: '自定义请求' }[kind] || 'OpenAI Compatible';
  }
  function blankProfile() {
    return {
      id: 'NEW', name: '我的 API', kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1', path: '/chat/completions',
      apiKey: '', model: '', temperature: 0.7, maxTokens: 4000, topP: '', timeoutMs: 60000,
      proxyUrl: '', method: 'POST', responsePath: 'choices.0.message.content',
      headers: {}, bodyTemplate: '',
    };
  }

  function renderProfileForm(body, st, prof) {
    const isNew = prof.id === 'NEW';
    const F = {};
    const field = (key, label, opts = {}) => {
      const inp = opts.rows
        ? el('textarea', { rows: opts.rows, value: prof[key] != null ? String(prof[key]) : '', placeholder: opts.ph || '', 'aria-label': label })
        : el('input', { type: opts.type || 'text', value: prof[key] != null ? String(prof[key]) : '', placeholder: opts.ph || '', 'aria-label': label, step: opts.step });
      F[key] = inp;
      return kv(label, inp);
    };

    const kindSel = el('select', { 'aria-label': '接口类型' },
      el('option', { value: 'openai-compatible', selected: prof.kind === 'openai-compatible' ? '' : null }, 'OpenAI Compatible（默认）'),
      el('option', { value: 'custom', selected: prof.kind === 'custom' ? '' : null }, 'Custom（完全自定义请求）'));
    F.kind = kindSel;

    // API Key 输入 + 显示/隐藏
    const keyInput = el('input', { type: 'password', value: prof.apiKey || '', placeholder: 'sk-••••••••••••••', 'aria-label': 'API Key', autocomplete: 'off' });
    F.apiKey = keyInput;
    const eyeBtn = el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-label': '显示/隐藏 API Key',
      onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; },
    }, '👁');

    const form = el('div', { class: 'panel profile-form' },
      el('h4', {}, isNew ? '新建 API 配置' : `编辑：${prof.name}`),
      field('name', '名称'),
      kv('接口类型', kindSel),
      field('baseUrl', 'Base URL', { ph: 'https://api.example.com/v1' }),
      field('path', '请求路径', { ph: '/chat/completions' }),
      kv('请求方式（Custom 模式）', (() => {
        const sel = el('select', { 'aria-label': '请求方式' },
          ...['POST', 'PUT', 'GET'].map((m) => el('option', { value: m, selected: (prof.method || 'POST') === m ? '' : null }, m)));
        F.methodSel = sel;
        return sel;
      })()),
      field('model', '模型名称', { ph: 'example-model' }),
      kv('API Key（仅保存在本机浏览器）', el('span', { class: 'key-row' }, keyInput, eyeBtn)),
      field('proxyUrl', '代理 URL（可选，填写后请求走代理而非直连）', { ph: 'https://my-proxy.example.com/v1' }),
      field('temperature', 'Temperature', { type: 'number', step: '0.05' }),
      field('maxTokens', 'Max Tokens（推理模型建议 ≥8000）', { type: 'number' }),
      field('topP', 'top_p（可选）', { type: 'number', step: '0.05' }),
      field('timeoutMs', '超时（毫秒）', { type: 'number' }),
      field('responsePath', 'Response JSON Path', { ph: 'choices.0.message.content' }),
      field('headersText', '额外 Headers（每行 Key: Value）', { rows: 2, ph: 'X-Title: DynastySim' }),
      el('p', { class: 'muted small' }, 'Custom 模式可用：请求方式 POST/PUT、Body 模板占位符 {{model}} {{messages_json}} {{system}} {{user}} {{temperature}} {{max_tokens}}'),
      field('bodyTemplate', 'Body 模板（仅 Custom 模式；留空用默认结构）', { rows: 4, ph: '{"model":"{{model}}","messages":{{messages_json}},"temperature":{{temperature}}}' }),
      el('div', { class: 'row-gap' },
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            // 收集表单
            prof.kind = F.kind.value;
            if (F.methodSel) prof.method = F.methodSel.value;
            for (const k of ['name', 'baseUrl', 'path', 'model', 'proxyUrl', 'responsePath']) {
              if (F[k]) prof[k] = F[k].value.trim();
            }
            prof.apiKey = F.apiKey.value.trim();
            for (const k of ['temperature', 'maxTokens', 'topP', 'timeoutMs']) {
              if (F[k]) prof[k] = F[k].value === '' ? (k === 'topP' ? '' : undefined) : Number(F[k].value);
            }
            // headers 解析
            prof.headers = {};
            const lines = (F.headersText ? F.headersText.value : '').split('\n');
            for (const line of lines) {
              const i = line.indexOf(':');
              if (i > 0) prof.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            }
            prof.bodyTemplate = F.bodyTemplate ? F.bodyTemplate.value : '';
            if (isNew) {
              prof.id = 'prof_' + DS.util.uid('').slice(2);
              st.api.profiles.push(prof);
              if (!st.api.profiles.some((x) => x.id === st.api.purposes.simulation && x.kind !== 'mock')) {
                // 不强制切换，保持用户选择
              }
            }
            DS.Storage.saveSettings(st);
            editingProfileId = null;
            DS.UI.toast('配置已保存');
            DS.UI.renderTopbar();
            settingsView.render(body.closest('.view') || document.body);
          },
        }, '保存配置'),
        el('button', { class: 'btn', onclick: () => { editingProfileId = null; settingsView.render(body.closest('.view') || document.body); } }, t().btn_cancel)),
    );
    body.append(form);
  }

  function exportProfile(p) {
    const clone = { ...p };
    delete clone.apiKey; // 导出默认剥离密钥
    DS.util.download(`dynasty-api-profile-${DS.util.todayStamp()}.json`, JSON.stringify(clone, null, 2));
    DS.UI.toast('已导出配置（不含 API Key）');
  }
  function profileFileInput(body) {
    const inp = el('input', { type: 'file', accept: '.json', style: 'display:none' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      inp.remove();
      if (!f) return;
      try {
        const obj = JSON.parse(await DS.util.readFileText(f));
        if (!obj || !obj.name) throw new Error('缺少 name 字段');
        const st = DS.Storage.loadSettings();
        st.api.profiles.push({
          ...blankProfile(), ...obj,
          id: 'prof_' + DS.util.uid('').slice(2),
          apiKey: '', // 导入的配置一律不带 Key，需手动填
        });
        DS.Storage.saveSettings(st);
        DS.UI.toast('配置已导入（出于安全考虑未导入 API Key）');
        settingsView.render(body.closest('.view') || document.body);
      } catch (e) { DS.UI.toast('导入失败：' + e.message, 'error'); }
    });
    document.body.append(inp);
    inp.click();
  }

  function persistAndRerender(st, body) {
    DS.Storage.saveSettings(st);
    DS.UI.renderTopbar();
    settingsView.render(body.closest('.view') || document.body);
  }

  /** 统一展示 API 错误（含状态码/原因建议/响应正文掩蔽） */
  function showApiError(err) {
    const e = err instanceof DS.AI.AIError ? err : new DS.AI.AIError(String(err && err.message || err));
    DS.UI.modal({
      title: 'API 请求失败',
      build(body) {
        body.append(
          el('p', {}, el('strong', {}, e.message)),
          e.httpStatus ? kv('HTTP 状态码', String(e.httpStatus)) : null,
          e.suggestion ? el('div', { class: 'callout' }, `可能原因与建议：${e.suggestion}`) : null,
          e.bodySnippet ? kv('响应正文（已掩蔽密钥）', el('pre', { class: 'snippet' }, e.bodySnippet)) : null,
        );
      },
      actions: [{ label: t().btn_close, primary: true }],
    });
  }

  /* ---------------- 推演标签页 ---------------- */
  function renderSimTab(body) {
    const st = DS.Storage.loadSettings();
    const defs = [
      ['inertia', '历史惯性', '越高则变革阻力越大、世界越难被一句话扭转'],
      ['randomness', '随机性', '影响事件时机与细节的波动'],
      ['npcIndependence', 'NPC 独立性', '越高则大臣越多依据自身利益行动'],
      ['eventDensity', '事件密度', '每回合随机事件的期望数量'],
      ['longTermImpact', '长期后果强度', '影响延迟后果的力度'],
    ];
    body.append(sectionTitle('推演参数（实时生效）'));
    for (const [key, label, hintv] of defs) {
      const rangeEl = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st.simulation[key]), 'aria-label': label });
      const valSpan = el('span', { class: 'range-val' }, Math.round(st.simulation[key] * 100) + '%');
      rangeEl.addEventListener('input', () => { valSpan.textContent = Math.round(rangeEl.value * 100) + '%'; });
      rangeEl.addEventListener('change', () => { st.simulation[key] = Number(rangeEl.value); DS.Storage.saveSettings(st); });
      body.append(kv(`${label}　`, el('span', { class: 'range-row' }, rangeEl, valSpan)),
        el('p', { class: 'muted small', style: 'margin:-4px 0 8px 84px' }, hintv));
    }
    // 难度
    const diffSel = el('select', { 'aria-label': '难度' },
      ...DS.DATA.DIFFICULTIES.map((d) => el('option', { value: d.id, selected: st.difficulty === d.id ? '' : null }, `${d.label} — ${d.desc}`)));
    diffSel.addEventListener('change', () => {
      st.difficulty = diffSel.value;
      DS.Storage.saveSettings(st);
      DS.UI.toast('难度将作用于新游戏；进行中的对局保持开局时难度。');
    });
    body.append(sectionTitle('难度'), kv('难度预设', diffSel),
      el('p', { class: 'muted small' }, '故事=强历史惯性；标准=均衡；困难=资源紧张执行下降；自由=弱惯性可离经叛道。'));
  }

  /* ---------------- 游戏标签页 ---------------- */
  function renderGameTab(body) {
    const st = DS.Storage.loadSettings();
    const langSel = el('select', { 'aria-label': '语言' },
      ...DS.I18N.LANGUAGES.map((l) => el('option', { value: l.id, selected: st.lang === l.id ? '' : null }, l.label)));
    langSel.addEventListener('change', () => {
      st.lang = langSel.value; DS.Storage.saveSettings(st);
      DS.I18N.setLang(langSel.value);
      DS.UI.refreshCurrent(); DS.UI.renderTopbar();
    });

    const themeSel = el('select', { 'aria-label': '主题' },
      ...[['classic', '默认古典'], ['dark', '深色'], ['light', '浅色']].map(([v, l]) =>
        el('option', { value: v, selected: st.theme === v ? '' : null }, l)));
    themeSel.addEventListener('change', () => {
      st.theme = themeSel.value; DS.Storage.saveSettings(st);
      applyTheme(st.theme);
    });

    const chk = (key, label) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!st[key];
      cb.addEventListener('change', () => {
        st[key] = cb.checked; DS.Storage.saveSettings(st);
        if (key === 'reduceMotion') applyTheme(st.theme);
        if (key === 'debugMode') DS.UI.renderTopbar();
      });
      return kv(label, cb);
    };

    body.append(
      sectionTitle('通用'),
      kv('语言 / Language', langSel),
      kv('主题', themeSel),
      chk('reduceMotion', '减少动画'),
      chk('autosave', '自动保存（每回合结束）'),
      chk('debugMode', '调试模式（显示 Prompt / 响应 / Inspector）'),
    );
    const seedInfo = DS.Game.state() ? kv('当前随机种子', el('code', {}, String(DS.Game.state().seed))) : null;
    if (seedInfo) body.append(sectionTitle('随机性'), seedInfo,
      el('p', { class: 'muted small' }, '同一 Seed + 相同世界状态下，本地推演结果接近一致（固定种子）。新游戏时可指定种子。'));
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('reduce-motion', !!DS.Storage.loadSettings().reduceMotion);
  }

  /* ---------------- Prompt 标签页 ---------------- */
  function renderPromptTab(body) {
    const st = DS.Storage.loadSettings();
    const defs = [
      ['worldview', '世界观 Prompt'], ['system', '系统 System Prompt'], ['npc', 'NPC Prompt'],
      ['simulation', '推演 Prompt'], ['event', '事件 Prompt'], ['summary', '总结 Prompt'],
    ];
    const boxes = {};
    for (const [key, label] of defs) {
      const ta = el('textarea', { rows: key === 'simulation' || key === 'system' ? 9 : 5, 'aria-label': label });
      ta.value = st.prompts[key] || DS.DATA.DEFAULT_PROMPTS[key] || '';
      boxes[key] = ta;
      body.append(kv(label, ta));
    }
    body.append(el('div', { class: 'row-gap' },
      el('button', {
        class: 'btn btn-primary', onclick: () => {
          for (const [key, ta] of Object.entries(boxes)) st.prompts[key] = ta.value;
          DS.Storage.saveSettings(st);
          DS.UI.toast('Prompts 已保存，下次推演生效');
        },
      }, '保存全部 Prompts'),
      el('button', {
        class: 'btn', onclick: () => DS.UI.confirmDialog('恢复全部默认 Prompt？你的修改将被覆盖。', () => {
          st.prompts = DS.util.deepClone(DS.DATA.DEFAULT_PROMPTS);
          DS.Storage.saveSettings(st);
          const host = body.closest('.view');
          if (host) settingsView.render(host);
          else { body.textContent = ''; renderPromptTab(body); }
          DS.UI.toast('已恢复默认 Prompts');
        }),
      }, '恢复默认 Prompt')));
  }

  /* ---------------- 数据标签页 ---------------- */
  function renderDataTab(body) {
    body.append(sectionTitle('数据管理'),
      kv('导出全部数据', el('button', {
        class: 'btn', onclick: exportAllData,
      }, '导出设置+剧本（不含存档）')),
      el('div', { class: 'row-gap', style: 'margin-top: .6rem' },
        el('button', {
          class: 'btn', onclick: () => {
            const st = DS.Storage.loadSettings();
            DS.util.download('dynasty-settings.json', JSON.stringify({ ...st, api: { ...st.api, profiles: st.api.profiles.map((p) => ({ ...p, apiKey: '' })) } }, null, 2));
          },
        }, '导出设置 JSON'),
        (() => {
          const inp = el('input', { type: 'file', accept: '.json', style: 'display:none' });
          const btn = el('button', {
            class: 'btn', onclick: () => inp.click(),
          }, '导入设置 JSON');
          inp.addEventListener('change', async () => {
            const f = inp.files[0]; inp.value = '';
            if (!f) return;
            try {
              const obj = JSON.parse(await DS.util.readFileText(f));
              const merged = DS.Storage.migrateSettingsPublic ? DS.Storage.migrateSettingsPublic(obj) : obj;
              DS.Storage.saveSettings(merged);
              DS.UI.toast('设置已导入（Key 未随文件保存，需重填）');
              applyTheme(DS.Storage.loadSettings().theme);
            } catch (e) { DS.UI.toast('导入失败：' + e.message, 'error'); }
          });
          const wrap = el('span', {}, btn, inp);
          return wrap;
        })()),
      el('hr'),
      kv('恢复默认设置', el('button', {
        class: 'btn btn-danger', onclick: () => DS.UI.confirmDialog('恢复全部默认设置？（不影响存档）', () => {
          DS.Storage.resetSettings();
          DS.I18N.setLang('zh-CN');
          applyTheme('classic');
          DS.UI.toast('已恢复默认设置');
        }, true),
      })),
      kv('清空全部本地数据', el('button', {
        class: 'btn btn-danger', onclick: () => DS.UI.confirmDialog('将删除所有存档、设置与剧本，且不可恢复。确定？', () => {
          DS.Storage.clearAll();
          location.reload();
        }, true),
      })));
  }

  function exportAllData() {
    const st = DS.Storage.loadSettings();
    const data = {
      kind: 'dynasty-backup',
      schemaVersion: 1,
      exportedAt: DS.util.nowISO(),
      scenarios: DS.Storage.listScenarios(),
      settings: { ...st, api: { ...st.api, profiles: st.api.profiles.map((p) => ({ ...p, apiKey: '' })) } },
    };
    DS.util.download(`dynasty-backup-${DS.util.todayStamp()}.json`, JSON.stringify(data, null, 2));
    DS.UI.toast('备份已导出（不包含 API Key 与存档正文）');
  }

  /* ---------------- 调试标签页 ---------------- */
  function renderDebugTab(body) {
    const dbg = DS.aiService.debug;
    const state = DS.Game.state();
    const enabled = DS.Storage.loadSettings().debugMode;

    if (!enabled) {
      body.append(el('div', { class: 'callout' }, '调试模式未开启。请在「游戏」标签页勾选「调试模式」以解锁 Simulation Inspector。'));
      return;
    }
    body.append(sectionTitle('Simulation Inspector（开发者）'));

    const block = (title, contentNode) => {
      const det = el('details', { class: 'dbg-block' }, el('summary', {}, title), contentNode);
      body.append(det);
      return det;
    };

    if (state) {
      block('World State（截断显示）', el('pre', { class: 'snippet' }, DS.util.trunc(JSON.stringify(state, null, 2), 60000)));
      block('NPC State', el('pre', { class: 'snippet' }, JSON.stringify(state.characters.map((c) => ({
        id: c.id, name: c.name, role: c.role, faction: c.faction, loyalty: Math.round(c.loyalty), trust: Math.round(c.trust), corruption: c.corruption, task: c.task,
      })), null, 2)));
      block('Faction State', el('pre', { class: 'snippet' }, JSON.stringify(state.factions, null, 2)));
      block('Event Queue（pendingEvents）', el('pre', { class: 'snippet' }, JSON.stringify(state.pendingEvents, null, 2)));
      block('Long-term Memory', el('pre', { class: 'snippet' }, JSON.stringify(state.longTermMemory, null, 2)));
    } else {
      body.append(emptyHint('尚未开始游戏。'));
    }

    block('最后一次 Prompt（AI Context 分层）', el('pre', { class: 'snippet' }, dbg.lastPrompt
      ? `[${dbg.lastPrompt.purpose}] @${dbg.lastPrompt.at}\n--- SYSTEM ---\n${DS.util.trunc(dbg.lastPrompt.system, 6000)}\n--- USER ---\n${DS.util.trunc(dbg.lastPrompt.user, 12000)}`
      : '（尚无请求）'));
    block('最后一次 AI Response', el('pre', { class: 'snippet' }, dbg.lastResponse || '（尚无响应）'));
    block('请求统计', el('pre', { class: 'snippet' }, JSON.stringify({
      requestUrl: dbg.requestUrl, latencyMs: dbg.latencyMs, usage: dbg.usage, parseStatus: dbg.parseStatus,
    }, null, 2)));
  }

  DS.Views = {
    world: worldView, court: courtView, characters: charsView, policies: policiesView,
    events: eventsView, diplomacy: diploView, history: historyView, saves: savesView,
    settings: settingsView, showApiError, applyTheme,
  };
})(window.DynastySim = window.DynastySim || {});
