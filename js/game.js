/* ============================================================================
 * game.js — 游戏编排层
 * ----------------------------------------------------------------------------
 * 核心循环：观察天下 → 廷议 → 自然语言下诏 → AI/Mock 推演 → 验证 → 应用状态
 *           → 事件与历史记录 → 结束回合（时间推进）→ 下一回合。
 * 本文件是唯一把 AI 层、状态层、UI 层粘合在一起的地方。
 * ==========================================================================*/
(function (DS) {
  'use strict';
  const { el } = DS.util;

  /** 本文件专用的行式键值 / 进度条小组件（与 views.js 内部实现保持一致观感） */
  function kv(label, valueNode) {
    return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, label), el('span', { class: 'kv-v' }, valueNode));
  }
  function bar(v, cls, label) {
    const pct = DS.util.clamp(Math.round(v), 0, 100);
    return el('div', { class: 'bar-wrap' },
      el('div', { class: `bar ${cls || ''}`, style: `width:${pct}%` }),
      el('span', { class: 'bar-num' }, String(pct)));
  }

  let _state = null;
  let lastAutosaveAt = 0;
  let endingShown = false;

  /* ============================ 开局 ============================ */
  function newGame(cfg) {
    _state = DS.State.createNewGame(cfg);
    endingShown = false;
    // 剧本引子写入历史
    DS.State.recordHistory(_state, { type: 'system', title: '引子', description: DS.util.trunc(DS.DATA.prologue({
      year: _state.date.year, dynastyName: _state.dynasty.name, eraName: _state.ruler.eraName, rulerName: _state.ruler.name,
    }), 380) });
    enterGame();
    // 展示剧情引子
    DS.UI.modal({
      title: `序章 · ${_state.dynasty.name}${_state.ruler.eraName}元年`,
      wide: true,
      build(body) {
        const pre = document.createElement('pre');
        pre.className = 'prologue';
        pre.textContent = DS.DATA.prologue({
          year: _state.date.year, dynastyName: _state.dynasty.name, eraName: _state.ruler.eraName, rulerName: _state.ruler.name,
        });
        body.append(pre);
      },
      actions: [{ label: '开始亲政 ▶', primary: true }],
    });
    autoSave('开局');
  }

  function enterGame() {
    document.querySelector('#welcome-screen').hidden = true;
    document.querySelector('#app').hidden = false;
    DS.Views.applyTheme(DS.Storage.loadSettings().theme);
    DS.UI.renderTopbar();
    DS.UI.showView('world');
  }

  function state() { return _state && !_state.gameOver ? _state : (_state || null); }
  /** 终局后仍允许查看，但禁止发布政令 */
  function rawState() { return _state; }

  /* ============================ 发布政令 ============================ */
  async function submitOrder(text) {
    text = String(text || '').trim();
    if (!rawState()) { DS.UI.toast(DS.I18N.t('no_game'), 'warn'); return; }
    if (rawState().gameOver) { DS.UI.toast('大位已终，无法再下诏。可读取存档或开始新游戏。', 'warn'); return; }
    if (!text) { DS.UI.toast(DS.I18N.t('order_empty'), 'warn'); return; }
    if (DS.UI.isBusy()) return;

    DS.UI.setBusy(true);
    const abortCtrl = new AbortController();
    DS.UI.loading(true, {
      cancellable: true,
      onCancel: () => { abortCtrl.abort(new DOMException('cancelled', 'AbortError')); },
    });

    try {
      const st = rawState();
      const isMock = DS.aiService.isActiveMock('simulation');

      // ① 取得推演 JSON（AI 或 Mock 同构）
      let parsed;
      if (isMock) {
        const out = await DS.aiService.chatRaw('simulation', '', '', {
          mockKind: 'order', mockState: st, mockPayload: { text }, signal: abortCtrl.signal,
        });
        parsed = DS.AI.extractJSON(out.text);
        if (!parsed) throw new DS.AI.AIError('Demo 引擎输出异常', { kind: 'parse' });
        DS.aiService.debug.parseStatus = '本地引擎生成';
      } else {
        const { system, user } = DS.AI.PromptBuilder.simulation(st, text);
        parsed = await DS.aiService.chatJSON('simulation', system, user, {
          mockKind: 'order', mockState: st, mockPayload: { text }, signal: abortCtrl.signal,
        });
      }

      // ② 校验（不合格则整体拒绝，不触碰状态）
      const check = DS.State.validateAIResult(parsed, st);
      if (!check.ok) throw new DS.AI.AIError('推演结果校验未通过：' + (check.errors || []).join('；'), { kind: 'parse' });
      const result = check.value;
      if (check.warnings.length) {
        console.warn('[推演警告]', check.warnings.join('；'));
      }

      // ③ 应用（唯一入口：apply* 系列）
      const applyInfo = applySimulationResult(st, result, text);

      // ④ 反馈
      const applied = applyInfo;
      DS.UI.clearOrderInput();
      DS.UI.renderTopbar();
      DS.UI.refreshCurrent();
      showOrderResult(result, check.warnings, applied);
      autoSave('政令后');
    } catch (err) {
      handleRuntimeError(err);
    } finally {
      DS.UI.loading(false);
      DS.UI.setBusy(false);
    }
  }

  /** 把验证过的结果写入世界（含事件、人物、地区、长期后果、史册） */
  function applySimulationResult(st, result, originalText) {
    const C = st.country;
    // 政令本身入史
    DS.State.recordHistory(st, {
      type: 'order',
      title: `帝下诏：${result.intent && result.intent.category ? result.intent.category : '谕令'}`,
      description: DS.util.trunc(originalText, 160),
    });

    const changeSummary = {};
    // 主状态变化
    Object.assign(changeSummary, DS.State.applyChanges(st, result.state_changes, { reason: result.turn_summary || '政令' }));
    // 附带事件的直接效果
    for (const ev of result.events) {
      DS.State.addEvent(st, { ...ev, category: ev.category || '政令事件', source: 'edict' });
      if (ev.effects) Object.assign(changeSummary, DS.State.applyChanges(st, ev.effects, { reason: ev.title }));
    }
    // 人物 / 地区
    const npcApplied = DS.State.applyNpcChanges(st, result.npc_changes, result.turn_summary);
    const regApplied = DS.State.applyRegionalChanges(st, result.regional_changes, result.turn_summary);
    // 长期后果 → 事件队列
    for (const fc of result.future_consequences) {
      DS.State.addPendingEvent(st, { ...fc, source: 'ai' });
    }
    // 风险提示 → 记忆与史册
    for (const risk of result.new_risks) {
      if (!st.longTermMemory.includes(risk)) {
        st.longTermMemory.unshift(risk);
        if (st.longTermMemory.length > 12) st.longTermMemory.length = 12;
      }
    }
    if (result.historical_record) {
      DS.State.recordHistory(st, { type: 'event', title: '史官记', description: result.historical_record });
    }
    st.flags.lastOrderCategory = result.intent ? result.intent.category : null;
    st.stats.ordersIssued++;
    return { changeSummary, npcApplied, regApplied };
  }

  function showOrderResult(result, warnings, applied) {
    const npcApplied = (applied && applied.npcApplied) || [];
    const regApplied = (applied && applied.regApplied) || [];
    DS.UI.modal({
      title: `📜 推演结果 · ${result.turn_summary || ''}`,
      wide: true,
      build(body) {
        body.append(
          el('p', { class: 'narrative' }, result.narrative || ''),
          result.decisions && result.decisions.length
            ? el('div', {}, el('strong', {}, '决定：'),
              el('ul', { class: 'mini-list' }, ...result.decisions.map((d) => el('li', {}, d))))
            : null,
          deltaGrid(changeSummaryOf(result)),
          (npcApplied.length || regApplied.length) ? el('h4', {}) : null,
          npcApplied.length ? kvList('臣工反应', npcApplied.map((n) => `${n.name}：${n.detail}`)) : null,
          regApplied.length ? kvList('地方变化', regApplied.map((n) => `${n.name}：${n.detail}`)) : null,
          result.events && result.events.length ? el('h4', {}, '伴随事件') : null,
          ...(result.events || []).map((e) => el('p', { class: 'event-inline' }, `[${e.severity}] ${e.title} — ${e.description}`)),
          (result.new_risks && result.new_risks.length) ? el('div', { class: 'callout callout-warn' }, '新增隐患：' + result.new_risks.join('；')) : null,
          (warnings && warnings.length) ? el('details', { class: 'dbg-block' }, el('summary', {}, `解析警告（${warnings.length}）`),
            el('pre', { class: 'snippet' }, warnings.join('\n'))) : null,
        );
      },
      actions: [{ label: '知道了', primary: true }],
    });
  }
  function changeSummaryOf(result) {
    // 汇总主变化 + 事件效果用于展示
    const merged = {};
    for (const [k, v] of Object.entries(result.state_changes)) merged[k] = (merged[k] || 0) + v;
    for (const e of result.events || []) for (const [k, v] of Object.entries(e.effects || {})) merged[k] = (merged[k] || 0) + v;
    return merged;
  }
  function deltaGrid(merged) {
    const names = {
      treasury: ['国库', fmtDeltaRes], food: ['粮食', fmtDeltaRes], population: ['人口', fmtDeltaRes],
      publicSupport: ['民心', fmtDeltaPct], stability: ['稳定', fmtDeltaPct], corruption: ['腐败', fmtDeltaPct],
      bureaucracy: ['官僚效率', fmtDeltaPct], militaryPower: ['军力', fmtDeltaPct], morale: ['士气', fmtDeltaPct],
      authority: ['皇权', fmtDeltaPct], borderPressure: ['边压', fmtDeltaPct], debt: ['国债', fmtDeltaRes],
    };
    const entries = Object.entries(merged).filter(([k, v]) => Math.abs(v) >= 0.5);
    if (!entries.length) return el('p', { class: 'muted' }, '本回合核心指标无明显变化。');
    return el('div', { class: 'delta-grid' },
      ...entries.map(([k, v]) => {
        const [label, fn] = names[k] || [k, (x) => String(Math.round(x * 10) / 10)];
        return el('span', { class: `delta-pill ${v > 0 ? 'up' : 'down'}` }, `${label} ${fn(v)}`);
      }));
  }
  function fmtDeltaPct(v) { return (v > 0 ? '+' : '') + Math.round(v * 10) / 10; }
  function fmtDeltaRes(v) { return (v > 0 ? '+' : '') + DS.util.fmtMoney(v); }
  function kvList(title, items) {
    return el('div', {}, el('strong', {}, title),
      el('ul', { class: 'mini-list' }, ...items.map((x) => el('li', {}, x))));
  }

  /* ============================ 廷议 ============================ */
  async function runCouncil(charIds) {
    if (!rawState() || !charIds.length) return;
    if (DS.UI.isBusy()) return;
    DS.UI.setBusy(true);
    try {
      const st = rawState();
      const isMock = DS.aiService.isActiveMock('dialogue');
      let council;
      if (isMock) {
        const out = await DS.aiService.chatRaw('dialogue', '', '', { mockKind: 'council', mockState: st, mockPayload: { charIds } });
        council = DS.AI.extractJSON(out.text);
      } else {
        const { system, user } = DS.AI.PromptBuilder.council(st, charIds);
        council = await DS.aiService.chatJSON('dialogue', system, user, {});
      }
      if (!council || !Array.isArray(council.speeches) || !council.speeches.length) {
        throw new DS.AI.AIError('廷议返回格式异常', { kind: 'parse', suggestion: '重试一次，或切换到本地 Demo 引擎。' });
      }
      st.councilLog.unshift({
        date: DS.util.dateLabel(st.date),
        turn: st.turn,
        consensus: council.consensus || '各有主张',
        speeches: council.speeches.slice(0, 3).map((s) => ({
          characterId: s.characterId || (s.id ?? ''),
          name: s.name || '', role: s.role || '',
          stance: s.stance || '', support: s.support || 'cautious',
          content: String(s.content || '').slice(0, 400),
        })).filter((s) => DS.State.getCharacter(st, s.characterId)),
      });
      if (st.councilLog.length > 12) st.councilLog.length = 12;
      DS.State.recordHistory(st, { type: 'event', title: '召对廷臣', description: `召${st.councilLog[0].speeches.map((s) => s.name).join('、')}廷议，${st.councilLog[0].consensus}。` });
      DS.UI.refreshCurrent();
      autoSave('廷议后');
    } catch (err) {
      handleRuntimeError(err);
    } finally {
      DS.UI.setBusy(false);
    }
  }

  /** 采纳某臣廷议：填入圣旨框并记录信任 */
  function adoptAdvice(charId, content) {
    const st = rawState();
    const c = DS.State.getCharacter(st, charId);
    if (!c) return;
    const core = String(content || '').replace(/^臣[^：:]{0,6}[：:]?/, '').trim();
    const draft = core.slice(0, 80) + (core.length > 80 ? '……' : '');
    const input = document.querySelector('#order-input');
    input.value = `依${c.name}所奏：${draft}`;
    input.dispatchEvent(new Event('input'));
    input.focus();
    DS.State.applyNpcChanges(st, [{ id: charId, trust_delta: 3, reason: '陛下当廷采纳其建议（草拟中）' }]);
    DS.UI.toast(`已按 ${c.name} 之意草拟圣旨，可自行修改后颁布。`, 'info');
    DS.UI.renderTopbar();
  }

  /* ============================ NPC 对话 ============================ */
  async function talkTo(charId, message) {
    const st = rawState();
    const c = DS.State.getCharacter(st, charId);
    if (!c) return Promise.resolve();
    c.dialogueMemory.push(`【陛下】${message}`);
    if (c.dialogueMemory.length > 10) c.dialogueMemory.shift();
    try {
      const isMock = DS.aiService.isActiveMock('dialogue');
      let replyObj;
      if (isMock) {
        const out = await DS.aiService.chatRaw('dialogue', '', '', {
          mockKind: 'dialogue', mockState: st, mockPayload: { charId, message },
        });
        replyObj = DS.AI.extractJSON(out.text);
      } else {
        const { system, user } = DS.AI.PromptBuilder.dialogue(st, charId, message, c.dialogueMemory);
        replyObj = await DS.aiService.chatJSON('dialogue', system, user, { temperature: 0.9, maxTokens: 500 });
      }
      const reply = replyObj && replyObj.reply ? String(replyObj.reply) : '……（沉默不语。）';
      const attitude = replyObj && replyObj.attitude ? replyObj.attitude : '';
      c.dialogueMemory.push(`【${c.name}${attitude ? '·' + attitude : ''}】${reply}`);
      if (replyObj && isFinite(Number(replyObj.trust_delta))) {
        DS.State.applyNpcChanges(st, [{ id: charId, trust_delta: Number(replyObj.trust_delta), reason: '君臣召对' }]);
      }
      DS.UI.renderTopbar();
    } catch (err) {
      c.dialogueMemory.push(`【${c.name}】（侍立无言——${err.message}）`);
      handleRuntimeError(err);
    }
  }

  /** 缇骑密查秘密：成败皆有后果 */
  function investigateSecret(charId) {
    const st = rawState();
    const c = DS.State.getCharacter(st, charId);
    if (!c || !c.secrets.length) return;
    const spy = st.characters.find((x) => x.role === '锦衣卫指挥使');
    const successChance = 0.55 + (spy ? spy.ability / 300 : 0.1);
    if (Math.random() < successChance) {
      st.flags.revealedSecrets.push(charId);
      DS.UI.modal({
        title: `缇骑回报 · ${c.name}`,
        build(body) { body.append(el('p', {}, c.secrets.join('；'))); },
        actions: [{ label: '朕知道了', primary: true }],
      });
      DS.State.recordHistory(st, { type: 'relation', title: `缇骑密查${c.name}得手`, description: `查明隐情：${c.secrets[0]}` });
    } else {
      DS.State.applyNpcChanges(st, [{ id: charId, trust_delta: -6, reason: '风闻缇骑暗查，心生疑惧' }]);
      DS.UI.toast('密查走漏了风声，对方有所警觉（信任下降）。', 'warn');
    }
  }

  /* ============================ 国策 ============================ */
  function adoptPolicy(pid) {
    const st = rawState();
    if (!st || st.gameOver) return;
    const p = st.policiesKnown.find((x) => x.id === pid);
    if (!p || st.activePolicies.includes(pid)) return;
    const missing = (p.prereq || []).filter((id) => !st.activePolicies.includes(id));
    if (missing.length) { DS.UI.toast('前置国策未满足。', 'warn'); return; }
    if (st.country.treasury < p.cost) { DS.UI.toast('国库不足以推行此策。', 'warn'); return; }
    DS.UI.confirmDialog(`推行「${p.name}」？需国帑 ${DS.util.fmtMoney(p.cost)}。`, () => {
      DS.State.applyChanges(st, { treasury: -p.cost }, { reason: `推行国策：${p.name}` });
      DS.State.applyChanges(st, p.instant || {}, { reason: `国策生效：${p.name}` });
      st.activePolicies.push(pid);
      st.stats.policiesAdopted++;
      DS.State.recordHistory(st, { type: 'policy', title: `推行国策：${p.name}`, description: p.side || '' });
      DS.UI.toast(`「${p.name}」已推行`, 'success');
      DS.UI.renderTopbar();
      DS.UI.refreshCurrent();
      autoSave('国策后');
    });
  }

  /* ============================ 结束回合 ============================ */
  async function endTurn() {
    if (!rawState()) return;
    if (DS.UI.isBusy()) return;
    DS.UI.setBusy(true);
    try {
      const st = rawState();
      const report = DS.State.advanceMonth(st);
      DS.UI.renderTopbar();
      DS.UI.refreshCurrent();

      // 回合小结
      const lines = [];
      lines.push(`岁入 ${DS.util.fmtMoney(report.income)} ／ 岁出 ${DS.util.fmtMoney(report.expense)}（${report.netIncome >= 0 ? '盈余' : '亏空'} ${DS.util.fmtMoney(Math.abs(report.netIncome))}）`);
      if (report.notes.length) lines.push(...report.notes);
      if (report.firedEvents.length) lines.push('触发事件：' + report.firedEvents.join('、'));
      DS.UI.toast(lines.join('\n'), report.netIncome >= 0 ? 'info' : 'warn', 5200);

      autoSave('回合末');
      if (st.gameOver && !endingShown) { endingShown = true; await showEnding(st.gameOver, true); }
    } catch (err) {
      handleRuntimeError(err);
    } finally {
      DS.UI.setBusy(false);
    }
  }

  /* ============================ 终局 ============================ */
  async function showEnding(ending, final) {
    let verdictText = '（本地评语）' ;
    try {
      const st = rawState();
      if (!DS.aiService.isActiveMock('summary')) {
        const { system, user } = DS.AI.PromptBuilder.summary(st, ending);
        const out = await DS.aiService.chatRaw('summary', system, user, { maxTokens: 800 });
        verdictText = out.text.trim();
      } else {
        const o = await DS.aiService.chatRaw('summary', '', '', { mockKind: 'verdict', mockState: st, mockPayload: { ending } });
        verdictText = o.text;
      }
    } catch (_e) { verdictText = '史官执笔踌躇，一时未能成文。（AI 评语获取失败）'; }

    DS.UI.modal({
      title: `${ending.icon} 帝王生涯评价 · ${ending.label}`,
      wide: true,
      dismissable: false,
      build(body) {
        const sc = ending.scores;
        const dims = [['economy', '经济'], ['livelihood', '民生'], ['military', '军事'], ['political', '政治'], ['diplomatic', '外交'], ['reform', '改革'], ['stabilityScore', '稳定']];
        body.append(
          el('p', { class: 'narrative' }, ending.desc),
          el('div', { class: 'kv-grid' },
            ...dims.map(([k, label]) => kv(label, bar(sc[k] || 0, '', label)))),
          el('div', { class: 'kv-grid' },
            kv('在位年数', `${ending.stats.reignYears} 年（${ending.stats.turns} 回合）`),
            kv('颁布政令', `${ending.stats.orders} 道`),
            kv('推行国策', `${ending.stats.policies} 项`),
            kv('记录事件', `${ending.stats.events} 起`),
            kv('实录条目', `${ending.stats.historyEntries} 条`),
            kv('随机种子', String(ending.stats.seed))),
          el('h4', {}, '史官评语'),
          el('pre', { class: 'prologue' }, verdictText),
        );
      },
      actions: final
        ? [
          { label: '读取存档', onClick: () => { DS.UI.showView('saves'); } },
          { label: '开启新王朝', primary: true, onClick: () => backToWelcome(true) },
        ]
        : [{ label: '退朝', primary: true }],
    });
  }

  function abdicate() {
    const st = rawState();
    if (!st) return;
    const ending = DS.State.evaluateEnding(st);
    showEnding(ending, false);
  }

  /* ============================ 存档 ============================ */
  function autoSave(label) {
    const stg = DS.Storage.loadSettings();
    if (!stg.autosave || !rawState()) return;
    const now = Date.now();
    if (now - lastAutosaveAt < 20000) return; // 节流 20s
    lastAutosaveAt = now;
    const r = DS.Storage.writeSave('auto', rawState(), label || '自动保存');
    if (!r.ok) DS.UI.toast(r.error, 'error');
  }

  function quickSave() {
    const slots = DS.Storage.SLOTS.filter((s) => s !== 'auto');
    const empty = DS.Storage.listSaves().find((m) => m.empty && m.slot !== 'auto');
    const target = empty ? empty.slot : 'slot1';
    saveToSlot(target);
  }

  function saveToSlot(slot) {
    if (!rawState()) { DS.UI.toast(DS.I18N.t('no_game'), 'warn'); return; }
    const r = DS.Storage.writeSave(slot, rawState(), '');
    if (r.ok) DS.UI.toast(`${DS.I18N.t('saved_ok', { slot })}`, 'success');
    else DS.UI.toast(r.error, 'error');
    if (DS.UI.currentView === 'saves') DS.UI.refreshCurrent();
  }

  function loadSlot(slot) {
    const r = DS.Storage.readSave(slot);
    if (!r) { DS.UI.toast('该存档为空。', 'warn'); return; }
    if (r.corrupt) { DS.UI.toast('存档已损坏：' + r.error, 'error'); return; }
    _state = r.state;
    endingShown = false;
    if (r.checksumMismatch) DS.UI.toast('⚠ 该存档校验和不匹配，可能被手动修改过。', 'warn', 6000);
    enterGame();
    DS.UI.toast(`已读取存档：${slot}`, 'success');
  }

  function backToWelcome(force) {
    const go = () => {
      autoSave('返回主菜单');
      document.querySelector('#app').hidden = true;
      document.querySelector('#welcome-screen').hidden = false;
    };
    if (force) go();
    else DS.UI.confirmDialog('返回主菜单？（进度会先自动保存到 auto 槽）', go);
  }

  /* ============================ 错误处理 ============================ */
  function handleRuntimeError(err) {
    if (err instanceof DS.AI.AIError) {
      if (err.kind === 'cancel') { DS.UI.toast('已取消本次推演。', 'info'); return; }
      DS.Views.showApiError(err);
      return;
    }
    console.error(err);
    DS.UI.toast('发生意外错误：' + (err && err.message ? err.message : err), 'error', 6000);
  }

  DS.Game = {
    newGame, state, rawState,
    submitOrder, runCouncil, adoptAdvice, talkTo, investigateSecret,
    adoptPolicy, endTurn, abdicate,
    quickSave, saveToSlot, loadSlot, backToWelcome,
    showEnding,
  };
})(window.DynastySim = window.DynastySim || {});
