/* ============================================================================
 * state.js — 中央世界状态系统（唯一数据源）
 * ----------------------------------------------------------------------------
 * · createNewGame(config)      世界初始化器
 * · normalizeState(raw)        存档修复 / 版本迁移
 * · validateAIResult(result,s) AI 返回结果验证器（不合格拒绝应用）
 * · applyChanges(s,changes,m)  状态应用器（统一加钱/民心/人物/地区变化，含钳制与原因记录）
 * · advanceMonth(s)            时间推进（经济/灾害/事件队列/NPC漂移/随机事件/败亡判定）
 * · evaluateEnding(s)          结局评定（多结局 + 帝王生涯评分）
 * 所有 UI 只读取这里产出的 gameState，禁止各自保存冲突数据。
 * ==========================================================================*/
(function (DS) {
  'use strict';
  const { clamp } = DS.util;

  const SCHEMA_VERSION = 1;

  /* ---------------- 指标定义（上下限 + 展示） ---------------- */
  const PCT = [0, 100];
  const METRIC_BOUNDS = {
    publicSupport: PCT, stability: PCT, corruption: PCT, authority: PCT,
    legitimacy: PCT, morale: PCT, bureaucracy: PCT, militaryPower: PCT,
    borderPressure: PCT,
  };
  /** AI 可能输出的 snake_case → 内部 camelCase */
  const SNAKE_MAP = {
    public_support: 'publicSupport', military_power: 'militaryPower',
    border_pressure: 'borderPressure', tax_rate: 'taxRate',
  };
  function normKey(k) { return SNAKE_MAP[k] || k; }

  const METRIC_DEFS = [
    { key: 'treasury', label: '国库', kind: 'money', hint: '太仓与内库存银。收入不足支出时将转为债务。' },
    { key: 'food', label: '粮食', kind: 'grain', hint: '全国仓储存粮（石）。饥馑则民乱生。' },
    { key: 'publicSupport', label: '民心', kind: 'pct', hint: '天下百姓对朝廷的拥戴程度。' },
    { key: 'authority', label: '皇权', kind: 'pct', hint: '皇帝对官僚体系的实际掌控力。过低则政令不行。' },
    { key: 'stability', label: '稳定', kind: 'pct', hint: '社会整体安定程度，受民生、灾荒、边患共同影响。' },
    { key: 'corruption', label: '腐败', kind: 'pct', inverted: true, hint: '官僚系统的贪腐程度，越高政令执行损耗越大。' },
    { key: 'militaryPower', label: '军力', kind: 'pct', hint: '军队战力与士气之综合。欠饷则士气崩坏。' },
    { key: 'population', label: '人口', kind: 'pop', hint: '全国编户人口。灾荒与战乱致其衰减。' },
  ];

  /* ============================ 世界初始化 ============================ */
  /**
   * @param {object} cfg {dynastyName,countryName,rulerName,eraName,year,difficulty,seed,scenarioId,intro}
   */
  function createNewGame(cfg) {
    cfg = cfg || {};
    const D = DS.DATA;
    const diff = D.DIFFICULTIES.find((d) => d.id === cfg.difficulty) || D.DIFFICULTIES[1];
    const scenario = D.SCENARIOS.find((s) => s.id === cfg.scenarioId) || D.SCENARIOS[0];
    const seed = Number.isInteger(cfg.seed) && cfg.seed > 0 ? cfg.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    const rng = DS.util.deriveRng(seed, 'init');

    const rm = diff.resourceMult;

    const state = {
      schemaVersion: SCHEMA_VERSION,
      seed,
      createdAt: DS.util.nowISO(),
      turn: 1,
      date: { year: Number(cfg.year) || scenario.year || 1627, month: 1, day: 1 },
      difficulty: diff.id,
      dynasty: {
        name: cfg.dynastyName || scenario.dynastyName || '大晟',
        countryName: cfg.countryName || scenario.countryName || '大晟帝国',
      },
      ruler: {
        name: cfg.rulerName || scenario.rulerName || '景明帝',
        eraName: cfg.eraName || scenario.eraName || '景明',
        authority: 62, legitimacy: 74,
      },
      country: {
        treasury: Math.round(480000 * rm),
        food: Math.round(820000 * rm),
        population: 52000000,
        stability: 52, publicSupport: 47,
        corruption: 44, bureaucracy: 58,
        militaryPower: 56, morale: 54,
        borderPressure: 62, debt: 0,
      },
      trends: {},            // 每项指标最近变化 {delta, reason, turn}
      regions: DS.util.deepClone(D.REGIONS).map((r) => ({
        ...r,
        grain: Math.round(r.grain * rm),
        income: Math.round(r.income * rm),
        loyalty: clamp(r.loyalty + DS.util.intRange(rng, -3, 3), 0, 100),
        unrest: clamp(r.unrest + DS.util.intRange(rng, -3, 3), 0, 100),
      })),
      factions: DS.util.deepClone(D.FACTIONS),
      characters: DS.util.deepClone(D.CHARACTERS),
      relationsSeed: DS.util.deepClone(D.CHARACTER_RELATIONS),
      diplomacy: DS.util.deepClone(D.DIPLOMACY),
      wars: [],
      policiesKnown: DS.util.deepClone(D.POLICY_TREE), // 国策树定义
      activePolicies: [],    // 已推行国策 id
      events: [],            // 已发生事件（新在前）
      pendingEvents: [],     // 事件队列
      longTermMemory: ['先帝骤崩，新君即位；西北大旱，辽东欠饷，朝野观望。'],
      history: [],
      councilLog: [],
      flags: { rebellionProgress: 0, lastOrderCategory: null, revealedSecrets: [], lowStreak: 0 },
      stats: {
        ordersIssued: 0, policiesAdopted: 0, warsResolved: 0,
        sums: { stability: 0, publicSupport: 0, militaryPower: 0, corruption: 0, treasuryPeak: 0 },
        count: 0,
      },
      gameOver: null,
      intro: cfg.intro || '',
    };

    // 应用剧本覆盖（深合并；剧本优先级最高）
    if (scenario.overrides) deepMerge(state, scenario.overrides);

    // 初始化关系映射与信任初值
    for (const rel of state.relationsSeed) {
      const a = state.characters.find((c) => c.id === rel.a);
      if (!a) continue;
      a.relationships = a.relationships || {};
      a.relationships[rel.b] = { type: rel.type, note: rel.note };
    }
    for (const c of state.characters) {
      c.trust = c.trust != null ? c.trust : clamp(c.loyalty - DS.util.intRange(rng, 0, 8), 5, 95);
      c.dialogueMemory = [];
    }

    recordHistory(state, { type: 'system', title: '新君即位', description: `${state.ruler.name} 受遗诏即皇帝位，改元 ${state.ruler.eraName}，以是年为元年。` });
    return state;
  }

  /** 深合并（对象递归，数组/标量直接覆盖） */
  function deepMerge(target, src) {
    for (const [k, v] of Object.entries(src || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
        deepMerge(target[k], v);
      } else target[k] = v;
    }
    return target;
  }

  /* ---------------- 存档修复 / 迁移 ---------------- */
  const MIGRATIONS = { 1: (s) => s };

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('存档缺少 gameState');
    let s = JSON.parse(JSON.stringify(raw));
    let v = s.schemaVersion || s.version || 1;
    while (v < SCHEMA_VERSION) {
      const mig = MIGRATIONS[v];
      if (!mig) break;
      s = mig(s); v++;
    }
    s.schemaVersion = SCHEMA_VERSION;
    // 补齐缺失字段，保证旧档兼容
    const base = () => ({
      trends: {}, pendingEvents: [], longTermMemory: [], history: [], councilLog: [],
      activePolicies: [], wars: [],
      stats: { ordersIssued: 0, policiesAdopted: 0, warsResolved: 0, sums: { stability: 0, publicSupport: 0, militaryPower: 0, corruption: 0, treasuryPeak: 0 }, count: 0 },
      flags: { rebellionProgress: 0, lastOrderCategory: null, revealedSecrets: [], lowStreak: 0 },
    });
    const b = base();
    for (const [k, val] of Object.entries(b)) if (s[k] == null) s[k] = JSON.parse(JSON.stringify(val));
    if (!s.date) s.date = { year: 1627, month: 1, day: 1 };
    if (!s.ruler) s.ruler = { name: '皇帝', eraName: '景明', authority: 60, legitimacy: 70 };
    if (!s.dynasty) s.dynasty = { name: '大晟', countryName: '大晟帝国' };
    if (!s.policiesKnown) s.policiesKnown = DS.util.deepClone(DS.DATA.POLICY_TREE);
    for (const c of s.characters || []) {
      if (c.trust == null) c.trust = c.loyalty || 60;
      if (!Array.isArray(c.dialogueMemory)) c.dialogueMemory = [];
    }
    return s;
  }

  /* ============================ 记录器 ============================ */
  function recordHistory(state, entry) {
    if (!entry || !entry.title) return;
    state.history.unshift({
      id: DS.util.uid('h'),
      turn: state.turn,
      date: DS.util.dateLabel(state.date),
      type: entry.type || 'event',
      title: String(entry.title).slice(0, 60),
      description: String(entry.description || '').slice(0, 400),
      ts: DS.util.nowISO(),
    });
    if (state.history.length > 800) state.history.length = 800;
  }

  function addEvent(state, evt) {
    if (!evt || !evt.title) return null;
    const e = {
      id: DS.util.uid('ev'),
      turn: state.turn,
      date: DS.util.dateLabel(state.date),
      category: evt.category || '国家事件',
      title: String(evt.title).slice(0, 60),
      description: String(evt.description || '').slice(0, 500),
      severity: ['low', 'medium', 'high', 'critical'].includes(evt.severity) ? evt.severity : 'medium',
      regionId: evt.regionId && getRegion(state, evt.regionId) ? evt.regionId : null,
      characterId: evt.characterId && getCharacter(state, evt.characterId) ? evt.characterId : null,
      source: evt.source || 'world',
    };
    state.events.unshift(e);
    if (state.events.length > 300) state.events.length = 300;
    if (e.severity !== 'low') recordHistory(state, { type: 'event', title: e.title, description: e.description });
    return e;
  }

  function addPendingEvent(state, pe) {
    state.pendingEvents.push({
      id: DS.util.uid('pe'),
      dueTurn: state.turn + clamp(Math.round(pe.afterTurns ?? pe.after_turns ?? 2), 1, 24),
      title: String(pe.title || '未知后果').slice(0, 60),
      description: String(pe.description || '').slice(0, 400),
      severity: ['low', 'medium', 'high', 'critical'].includes(pe.severity) ? pe.severity : 'medium',
      effects: pe.effects || null,
      source: pe.source || 'world',
    });
  }

  /* ============================ 状态应用器 ============================
   * 唯一允许修改核心数值的入口。所有变化都经过：
   * 键名规范化 → 数值校验 → 幅度钳制 → 上下限钳制 → 趋势记录。
   */
  const RESOURCE_KEYS = new Set(['treasury', 'food', 'debt']);
  const POP_KEYS = new Set(['population']);

  function clampDelta(key, delta, state) {
    if (!isFinite(delta)) return 0;
    if (METRIC_BOUNDS[key]) {
      const lim = key === 'borderPressure' ? 15 : 20; // 百分比指标单次幅度上限
      return clamp(delta, -lim, lim);
    }
    if (POP_KEYS.has(key)) {
      const cur = state.country.population || 1;
      return clamp(delta, -cur * 0.02, cur * 0.02); // 人口单次 ≤±2%
    }
    if (RESOURCE_KEYS.has(key)) {
      const cur = Math.abs(state.country[key] || 0);
      const cap = Math.max(cur * 0.5, 100000);
      return clamp(delta, -cap, cap);
    }
    return delta;
  }

  /**
   * @param {object} changes 扁平键值对（支持 snake_case）
   * @param {object} meta {reason} 变化原因（写入趋势与 tooltip）
   * @returns {object} 实际生效的增量 {key: delta}
   */
  function applyChanges(state, changes, meta) {
    const applied = {};
    const reason = (meta && meta.reason) || '';
    for (const [rawKey, rawVal] of Object.entries(changes || {})) {
      const key = normKey(rawKey);
      const val = Number(rawVal);
      if (!isFinite(val) || val === 0) continue;
      if (!(key in state.country) && !(key in state.ruler)) continue;

      let delta = clampDelta(key, val, state);
      if (Math.abs(delta) < 0.5 && delta !== 0) delta = Math.sign(delta) * 0.5; // 避免被钳制成无声无息

      const target = key in state.ruler ? state.ruler : state.country;
      const bounds = METRIC_BOUNDS[key];
      const before = target[key];
      let after = before + delta;
      if (bounds) after = clamp(after, bounds[0], bounds[1]);
      else if (key === 'debt') after = Math.max(0, after);
      else if (after < 0) after = 0;
      const realDelta = Math.round((after - before) * 10) / 10;
      if (realDelta === 0) continue;

      target[key] = after;
      applied[key] = realDelta;
      pushTrend(state, key, realDelta, reason);
    }
    return applied;
  }

  function pushTrend(state, key, delta, reason) {
    state.trends[key] = state.trends[key] || [];
    state.trends[key].unshift({ turn: state.turn, delta, reason: String(reason || '').slice(0, 80), date: DS.util.dateLabel(state.date) });
    if (state.trends[key].length > 30) state.trends[key].length = 30;
  }

  /* ---------------- 人物 / 地区变化应用 ---------------- */
  function applyNpcChanges(state, list, fallbackReason) {
    const applied = [];
    for (const ch of Array.isArray(list) ? list : []) {
      const c = getCharacter(state, ch && ch.id);
      if (!c) continue;
      const parts = [];
      const dLoyal = Number(ch.loyalty);
      if (isFinite(dLoyal) && dLoyal) {
        const before = c.loyalty;
        c.loyalty = clamp(before + clamp(dLoyal, -25, 25), 0, 100);
        if (c.loyalty !== before) parts.push(`忠诚 ${before}→${c.loyalty}`);
      }
      const dCorr = Number(ch.corruption);
      if (isFinite(dCorr) && dCorr) {
        const before = c.corruption;
        c.corruption = clamp(before + clamp(dCorr, -25, 25), 0, 100);
        if (c.corruption !== before) parts.push(`贪腐 ${before}→${c.corruption}`);
      }
      const dTrust = Number(ch.trust_delta ?? ch.trustDelta);
      if (isFinite(dTrust) && dTrust) {
        const before = c.trust;
        c.trust = clamp(before + clamp(dTrust, -15, 15), 0, 100);
        if (c.trust !== before) {
          parts.push(`信任 ${before}→${c.trust}`);
          recordHistory(state, {
            type: 'relation',
            title: `${c.name} 对陛下的信任 ${dTrust > 0 ? '+' : ''}${Math.round(c.trust - before)}`,
            description: `原因：${ch.reason || fallbackReason || '朝局变动'}（信任 ${before} → ${c.trust}）`,
          });
        }
      }
      if (parts.length) applied.push({ id: c.id, name: c.name, detail: parts.join('，'), reason: ch.reason || fallbackReason || '' });
    }
    return applied;
  }

  const REGION_CHANGE_KEYS = new Set(['population', 'grain', 'income', 'taxRate', 'loyalty', 'security', 'corruption', 'agriculture', 'commerce', 'military', 'unrest']);

  function applyRegionalChanges(state, list, fallbackReason) {
    const applied = [];
    for (const rc of Array.isArray(list) ? list : []) {
      const r = getRegion(state, rc && (rc.region_id || rc.regionId));
      if (!r) continue;
      const parts = [];
      for (const [rk, rv] of Object.entries(rc.changes || {})) {
        const key = normKey(rk);
        if (!REGION_CHANGE_KEYS.has(key)) continue;
        const num = Number(rv);
        if (!isFinite(num) || num === 0) continue;
        const before = r[key];
        let after;
        if (key === 'taxRate') after = clamp(before + clamp(num, -15, 15), 0, 45);
        else if (['loyalty', 'security', 'corruption', 'unrest'].includes(key)) after = clamp(before + clamp(num, -25, 25), 0, 100);
        else if (key === 'population') after = Math.max(1000, before + clamp(num, -before * 0.05, before * 0.05));
        else if (['grain', 'income'].includes(key)) after = Math.max(0, before + clamp(num, -(before * 0.6 + 50000), before * 0.6 + 50000));
        else after = clamp(before + num, 0, 100);
        after = Math.round(after * 10) / 10;
        if (after !== before) {
          r[key] = after;
          parts.push(`${key} ${before}→${after}`);
        }
      }
      if (parts.length) applied.push({ regionId: r.id, name: r.name, detail: parts.join('，'), reason: rc.reason || fallbackReason || '' });
    }
    return applied;
  }

  /* ============================ AI 结果验证器 ============================
   * 不合格则返回 ok=false，调用方必须在不触碰状态的前提下报错。
   */
  function validateAIResult(result, state) {
    const warnings = [];
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { ok: false, errors: ['AI 返回的不是 JSON 对象'] };
    }
    const summary = result.turn_summary || result.narrative;
    if (!summary || typeof summary !== 'string') {
      return { ok: false, errors: ['缺少 turn_summary / narrative 字段'] };
    }
    const out = {
      intent: (result.intent && typeof result.intent === 'object') ? result.intent : null,
      turn_summary: String(result.turn_summary || '').slice(0, 200),
      narrative: String(result.narrative || '').slice(0, 2000),
      decisions: strList(result.decisions, 8, 120),
      state_changes: sanitizeFlatChanges(result.state_changes, warnings),
      events: [],
      npc_changes: [],
      regional_changes: [],
      new_risks: strList(result.new_risks, 6, 160),
      future_consequences: [],
      historical_record: String(result.historical_record || '').slice(0, 200),
    };

    // 事件结构校验
    for (const ev of Array.isArray(result.events) ? result.events.slice(0, 6) : []) {
      if (!ev || typeof ev !== 'object' || !ev.title) { warnings.push('丢弃一个缺少标题的事件'); continue; }
      const rid = ev.region_id || ev.regionId;
      const cid = ev.character_id || ev.characterId;
      out.events.push({
        title: String(ev.title).slice(0, 60),
        description: String(ev.description || '').slice(0, 500),
        severity: ['low', 'medium', 'high', 'critical'].includes(ev.severity) ? ev.severity : 'medium',
        category: ev.category ? String(ev.category).slice(0, 20) : '政令事件',
        regionId: rid && getRegion(state, rid) ? rid : null,
        characterId: cid && getCharacter(state, cid) ? cid : null,
        effects: sanitizeFlatChanges(ev.effects, warnings),
      });
      if (rid && !getRegion(state, rid)) warnings.push(`事件“${DS.util.trunc(ev.title, 12)}”引用了未知地区 ${rid}，已忽略地区标注`);
    }
    // 人物变化校验
    for (const nc of Array.isArray(result.npc_changes) ? result.npc_changes.slice(0, 10) : []) {
      if (!nc || !getCharacter(state, nc.id)) { if (nc && nc.id) warnings.push(`忽略未知人物 ${nc.id}`); continue; }
      out.npc_changes.push({
        id: nc.id,
        loyalty: Number(nc.loyalty) || 0,
        corruption: Number(nc.corruption) || 0,
        trust_delta: Number(nc.trust_delta ?? nc.trustDelta) || 0,
        reason: String(nc.reason || '').slice(0, 100),
      });
    }
    // 地区变化校验
    for (const rc of Array.isArray(result.regional_changes) ? result.regional_changes.slice(0, 10) : []) {
      const rid = rc && (rc.region_id || rc.regionId);
      if (!getRegion(state, rid)) { if (rid) warnings.push(`忽略未知地区变化 ${rid}`); continue; }
      out.regional_changes.push({
        region_id: rid,
        changes: rc.changes && typeof rc.changes === 'object' ? rc.changes : {},
        reason: String(rc.reason || '').slice(0, 100),
      });
    }
    // 长期后果校验
    for (const fc of Array.isArray(result.future_consequences) ? result.future_consequences.slice(0, 6) : []) {
      if (typeof fc === 'string') { out.future_consequences.push({ title: DS.util.trunc(fc, 40), description: fc, afterTurns: 2, severity: 'low' }); continue; }
      if (!fc || typeof fc !== 'object') continue;
      out.future_consequences.push({
        title: String(fc.title || '后续影响').slice(0, 60),
        description: String(fc.description || '').slice(0, 400),
        severity: ['low', 'medium', 'high', 'critical'].includes(fc.severity) ? fc.severity : 'medium',
        afterTurns: clamp(Math.round(Number(fc.after_turns ?? fc.afterTurns) || 2), 1, 24),
        effects: sanitizeFlatChanges(fc.effects, warnings),
      });
    }
    return { ok: true, value: out, warnings };
  }

  function sanitizeFlatChanges(src, warnings) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const [k, v] of Object.entries(src)) {
      const key = normKey(k);
      const allowed = [...Object.keys(METRIC_BOUNDS), 'treasury', 'food', 'population', 'debt'];
      if (!allowed.includes(key)) { warnings.push(`忽略未知指标 ${k}`); continue; }
      const num = Number(v);
      if (!isFinite(num)) { warnings.push(`忽略非法数值 ${k}=${v}`); continue; }
      out[key] = num;
    }
    return out;
  }
  function strList(arr, max, len) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => DS.util.trunc(x, len));
  }

  /* ============================ 政策修正聚合 ============================ */
  function computeModifiers(state) {
    const m = {
      incomeMult: 1, grainMult: 1, tradeMult: 1, armyPayMult: 1, reliefEffMult: 1,
      corruptionDrift: 0, loyaltyDrift: 0, securityBonus: 0, borderDefenseBonus: 0, adminBonus: 0,
    };
    for (const pid of state.activePolicies || []) {
      const p = (state.policiesKnown || []).find((x) => x.id === pid);
      if (!p || !p.ongoing) continue;
      for (const [k, v] of Object.entries(p.ongoing)) {
        if (typeof v !== 'number') continue;
        if (k.endsWith('Mult')) m[k] *= (1 + v);
        else m[k] = (m[k] || 0) + v;
      }
    }
    return m;
  }

  /* ============================ 月度推演（时间系统） ============================ */
  /** 地区 income 字段为税基年入基数；折算为月度实收的系数 */
  const INCOME_SCALE = 0.35;

  function advanceMonth(state) {
    const rng = DS.util.deriveRng(state.seed, 'tick', state.turn);
    const mod = computeModifiers(state);
    const report = { income: 0, expense: 0, reliefCost: 0, grainNet: 0, firedEvents: [], notes: [] };

    /* ---- 地区层：粮、赈、治安、民心、叛乱风险 ---- */
    let sumLoyalty = 0, sumWeight = 0, sumUnrest = 0, sumCorr = 0;
    let unrestHigh = 0;
    for (const r of state.regions) {
      const season = DS.util.seasonOf(state.date.month);

      // 灾害演化（抽象表现：只改强度与存续，不渲染不适内容）
      if (r.disaster) {
        const t = r.disaster.type;
        let pUp = 0.12, pDown = 0.16;
        if (t === '旱灾' && season === '夏') pUp += 0.15;
        if (t === '洪灾' && season === '夏') pUp += 0.2;
        if (t === '蝗灾' && season === '秋') pUp += 0.15;
        if (t === '疫情') { pUp = 0.1; pDown = 0.12; }
        if (mod.reliefEffMult > 1) pDown += 0.08; // 常平仓等政策加速平息
        const roll = rng();
        if (roll < pDown) {
          r.disaster.severity -= 1;
          if (r.disaster.severity <= 0) { r.disaster = null; report.notes.push(`${r.name}灾情平息`); }
        } else if (roll > 1 - pUp && r.disaster.severity < 5) r.disaster.severity += 1;
      } else {
        // 新发灾害概率（受腐败影响：水利失修更易成灾）
        const pNew = 0.03 + r.corruption / 1400;
        if (rng() < pNew) {
          const pool = season === '夏' ? ['洪灾', '旱灾', '疫情'] : season === '秋' ? ['蝗灾', '旱灾'] : season === '春' ? ['旱灾', '疫情'] : ['疫情', '饥荒'];
          r.disaster = { type: DS.util.pick(rng, pool), severity: DS.util.intRange(rng, 1, 2) };
          addEvent(state, {
            category: '自然事件', severity: r.disaster.severity >= 2 ? 'medium' : 'low',
            title: `${r.name}发生${r.disaster.type}`,
            description: `${r.name}报告${r.disaster.type}，强度${DS.DATA.SEVERITY_LABELS[r.disaster.severity]}。地方正设法应对。`,
            regionId: r.id, source: 'tick',
          });
        }
      }

      // 粮食（春播秋收的抽象节奏）
      const disMul = r.disaster ? Math.max(0.2, 1 - 0.18 * r.disaster.severity) : 1;
      let pc = 0; // 人均月变化（石）
      if (season === '春') pc = -0.002;
      else if (season === '夏') pc = -0.0005;
      else if (season === '秋') pc = (r.agriculture / 50) * 0.048 * mod.grainMult * disMul;
      else pc = -0.004;
      const dGrain = r.population * pc;
      r.grain = Math.max(0, r.grain + dGrain);
      report.grainNet += dGrain;

      // 收入（税基 × 税率 × 民心系数 − 腐败截留；INCOME_SCALE 将年入基数折算为月入）
      const leak = 1 - 0.35 * (r.corruption / 100);
      const eff = r.income * (r.taxRate / 18) * (0.85 + r.loyalty / 220) * leak * mod.incomeMult;
      report.income += eff * INCOME_SCALE;

      // 赈灾基准开销（朝廷默认要花的安抚成本）
      if (r.disaster) report.reliefCost += r.disaster.severity * 6000;

      // 饥荒判定 → 可能升级为饥荒灾害
      if (!r.disaster && r.grain < r.population * 0.03 && rng() < 0.25) {
        r.disaster = { type: '饥荒', severity: 2 };
        addEvent(state, { category: '社会事件', severity: 'high', title: `${r.name}出现饥荒`, description: `${r.name}存粮告罄，市面粮价飞涨，饥民开始外逃。`, regionId: r.id, source: 'tick' });
      }

      // 民心向目标值回归
      const target = clamp(
        52 + (18 - r.taxRate) * 0.8 + mod.securityBonus * 0.3 + mod.loyaltyDrift * 3
        - (r.disaster ? r.disaster.severity * 5 : 0)
        - (r.grain < r.population * 0.06 ? 10 : 0)
        + (r.unrest > 60 ? -8 : 0),
        0, 100);
      r.loyalty = clamp(r.loyalty + (target - r.loyalty) * 0.18 + DS.util.range(rng, -1, 1), 0, 100);

      // 治安缓慢回归
      r.security = clamp(r.security + (clamp(50 + mod.securityBonus - r.unrest / 8, 0, 100) - r.security) * 0.12, 0, 100);
      r.corruption = clamp(r.corruption + 0.12 + mod.corruptionDrift + DS.util.range(rng, -0.3, 0.3), 0, 100);

      // 叛乱风险重估
      const hunger = r.grain < r.population * 0.05 ? 14 : 0;
      r.unrest = clamp(
        (r.disaster ? r.disaster.severity * 6 : 0) + hunger
        + (100 - r.loyalty) * 0.35 + r.taxRate * 0.18 + r.corruption * 0.15
        - r.security * 0.22, 0, 100);

      // 高风险 → 入队叛乱隐患（事件队列）
      if (r.unrest >= 75 && !state.pendingEvents.some((p) => p.title.includes(r.name))) {
        addPendingEvent(state, {
          title: `${r.name}民变酝酿`,
          description: `${r.name}叛乱风险已达 ${Math.round(r.unrest)}，流民啸聚山泽。若数月内局势不改，恐生大乱。`,
          severity: 'high', afterTurns: DS.util.intRange(rng, 1, 2), source: 'tick',
          effects: { stability: -4, publicSupport: -3 },
        });
      }

      sumLoyalty += r.loyalty * r.population; sumWeight += r.population;
      sumUnrest += r.unrest; sumCorr += r.corruption;
      if (r.unrest >= 70) unrestHigh++;
    }
    const avgLoyalty = sumLoyalty / Math.max(1, sumWeight);
    const avgUnrest = sumUnrest / state.regions.length;
    const avgCorr = sumCorr / state.regions.length;

    /* ---- 国家财政 ---- */
    const C = state.country;
    const disasterRegions = state.regions.filter((x) => x.disaster).length;
    const expenses =
      30000 + state.ruler.authority * 180                    // 宫廷
      + C.militaryPower * 1150 * mod.armyPayMult             // 军费
      + 22000 + C.bureaucracy * 240                          // 行政
      + report.reliefCost;                                   // 赈济
    report.expense = expenses;
    const netIncome = report.income - expenses;
    report.netIncome = netIncome;
    if (netIncome >= 0) {
      applyChanges(state, { treasury: netIncome }, { reason: `岁入 ${DS.util.fmtMoney(report.income)} − 岁出 ${DS.util.fmtMoney(expenses)}` });
    } else {
      // 赤字转国债
      const deficit = -netIncome;
      C.debt = Math.round((C.debt + deficit) * 10) / 10;
      report.notes.push(`入不敷出 ${DS.util.fmtMoney(deficit)}，记入国债`);
      pushTrend(state, 'treasury', -deficit, `赤字转国债（国债 ${DS.util.fmtMoney(C.debt)}）`);
      if (C.debt > 200000) applyChanges(state, { stability: -1, morale: -1 }, { reason: '财政恶化，欠俸欠饷传闻四起' });
    }
    if (C.treasury > state.stats.sums.treasuryPeak) state.stats.sums.treasuryPeak = C.treasury;

    // 国家粮储 = 各地存粮汇总的中央调剂（简化：中央可控仓廪约为总存 35%）
    const totalGrain = state.regions.reduce((a, r) => a + r.grain, 0);
    const foodBefore = C.food;
    C.food = Math.round(totalGrain * 0.35);
    pushTrend(state, 'food', Math.round(C.food - foodBefore), '各州县粮入库与常平调拨');

    /* ---- 人口 ---- */
    let dPop = 0;
    for (const r of state.regions) {
      let g = r.population * (((r.loyalty - 46) / 12000) + ((r.security - 46) / 18000));
      if (r.disaster) g -= r.population * 0.0035 * r.disaster.severity * (r.disaster.type === '饥荒' ? 1.6 : 1);
      g = clamp(g, -r.population * 0.02, r.population * 0.008);
      r.population = Math.round(r.population + g);
      dPop += g;
    }
    applyChanges(state, { population: dPop }, { reason: '生养死亡与流徙之和' });

    /* ---- 国家综合指标向地区实况收敛 ---- */
    applyChanges(state, { publicSupport: (avgLoyalty - C.publicSupport) * 0.22 }, { reason: '各地民心加权' });

    const stabTarget = clamp(
      0.45 * avgLoyalty + 34 - avgUnrest * 0.28
      - Math.max(...state.diplomacy.map((d) => d.borderPressure)) * 0.07
      + (C.debt > 100000 ? -6 : 0) + (C.treasury < 50000 ? -6 : 4),
      0, 100);
    applyChanges(state, { stability: (stabTarget - C.stability) * 0.2 }, { reason: `民乱风险均值 ${Math.round(avgUnrest)}` });

    applyChanges(state, { corruption: (avgCorr - C.corruption) * 0.18 }, { reason: '地方吏治实况' });

    // 军心：足饷则升，欠饷则降
    const paidOk = C.treasury > 60000 && C.debt < 150000;
    const moraleTarget = clamp(52 + (paidOk ? 8 : -18) + mod.borderDefenseBonus * 0.4, 0, 100);
    applyChanges(state, { morale: (moraleTarget - C.morale) * 0.25 }, { reason: paidOk ? '军饷按期发放' : '粮饷积欠，军中怨言渐起' });
    const mpTarget = clamp(C.morale * 0.55 + 26 + mod.borderDefenseBonus * 0.3, 0, 100);
    applyChanges(state, { militaryPower: (mpTarget - C.militaryPower) * 0.15 }, { reason: '训练与士气变化' });

    /* ---- 边疆与外交 ---- */
    for (const d of state.diplomacy) {
      const hostile = d.threat >= 50;
      const target = hostile
        ? clamp(d.threat - mod.borderDefenseBonus * 0.8 - C.militaryPower * 0.15, 5, 95)
        : clamp(20 - mod.tradeMult * 6 + d.threat * 0.3, 0, 60);
      d.borderPressure = clamp(d.borderPressure + (target - d.borderPressure) * 0.12 + DS.util.range(rng, -1.5, 1.5), 0, 100);
      d.relation = clamp(d.relation + DS.util.range(rng, -1.2, 1.2) + (hostile ? -0.4 : 0.2), -100, 100);
      if (mod.tradeMult > 1 && d.trade > 20) d.trade = clamp(d.trade + 0.6 * mod.tradeMult, 0, 100);
    }
    const bp = Math.max(...state.diplomacy.map((x) => x.borderPressure));
    applyChanges(state, { borderPressure: (bp - C.borderPressure) * 0.25 }, { reason: '边镇塘报汇总' });

    /* ---- 事件队列：到期触发 ---- */
    const due = state.pendingEvents.filter((p) => p.dueTurn <= state.turn);
    if (due.length) {
      state.pendingEvents = state.pendingEvents.filter((p) => p.dueTurn > state.turn);
      for (const p of due) {
        addEvent(state, { category: '后续事件', title: p.title, description: p.description, severity: p.severity, source: p.source || 'queue' });
        if (p.effects) applyChanges(state, p.effects, { reason: p.title });
        report.firedEvents.push(p.title);
      }
    }

    /* ---- 随机事件（密度受设置与难度控制，权重受世界状态约束） ---- */
    const settings = DS.Storage ? DS.Storage.loadSettings() : null;
    const densityUser = settings ? settings.simulation.eventDensity : 0.5;
    const densityDiff = (DS.DATA.DIFFICULTIES.find((d) => d.id === state.difficulty) || DS.DATA.DIFFICULTIES[1]).eventDensity;
    const crisisBoost = avgUnrest / 150 + (C.treasury < 80000 ? 0.25 : 0) + (bp > 70 ? 0.15 : 0);
    const expected = densityUser * densityDiff * (0.55 + crisisBoost) * 2.2;
    let nRandom = Math.floor(expected);
    if (rng() < expected - nRandom) nRandom++;
    nRandom = Math.min(nRandom, 3);
    fireRandomEvents(state, rng, nRandom, report);

    /* ---- 人物漂移（忠诚/信任随国势浮动） ---- */
    for (const c of state.characters) {
      const drift = (C.publicSupport - 50) / 28 + (paidOk ? 0.6 : -1.2) + DS.util.range(rng, -0.8, 0.8);
      const before = c.loyalty;
      c.loyalty = clamp(c.loyalty + drift, 3, 100);
      if (Math.abs(c.loyalty - before) >= 2.5) {
        recordHistory(state, { type: 'relation', title: `${c.name} 忠诚 ${Math.round(before)}→${Math.round(c.loyalty)}`, description: `原因：朝局与国势变化（民心 ${Math.round(C.publicSupport)}，${paidOk ? '军饷如期' : '财用窘迫'}）` });
      }
    }

    /* ---- 长期记忆压缩（每 6 回合） ---- */
    if (state.turn % 6 === 0) {
      const worst = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
      const mem = `【${DS.util.dateLabel(state.date)}】民心${Math.round(C.publicSupport)}·稳定${Math.round(C.stability)}·库银${DS.util.fmtRes(C.treasury, '两')}·最忧者${worst.name}(乱${Math.round(worst.unrest)})`;
      state.longTermMemory.unshift(mem);
      if (state.longTermMemory.length > 12) state.longTermMemory.length = 12;
    }

    /* ---- 统计累计（结局评价用） ---- */
    const st = state.stats;
    st.count++;
    st.sums.stability += C.stability; st.sums.publicSupport += C.publicSupport;
    st.sums.militaryPower += C.militaryPower; st.sums.corruption += C.corruption;

    /* ---- 时间推进 ---- */
    state.date.month++;
    if (state.date.month > 12) { state.date.month = 1; state.date.year++; }
    state.turn++;

    /* ---- 败亡判定 ---- */
    checkCollapse(state, { avgUnrest, unrestHigh });

    return report;
  }

  /* ---------------- 随机事件触发 ---------------- */
  function fireRandomEvents(state, rng, count, report) {
    if (count <= 0) return;
    const T = EVENT_TEMPLATES;
    const pool = T.map((tpl) => ({ tpl, w: Math.max(0, tpl.weight(state)) })).filter((x) => x.w > 0);
    for (let i = 0; i < count && pool.length; i++) {
      const chosen = DS.util.weightedPick(rng, pool, (x) => x.w);
      if (!chosen) break;
      const idx = pool.indexOf(chosen);
      pool.splice(idx, 1);
      try {
        const built = chosen.tpl.gen(state, rng);
        if (built) {
          addEvent(state, { ...built, category: chosen.tpl.cat, source: 'random' });
          if (built.effects) applyChanges(state, built.effects, { reason: built.title });
          if (built.followup) addPendingEvent(state, { ...built.followup, source: 'random' });
          report.firedEvents.push(built.title);
        }
      } catch (_e) { /* 单个模板失败不影响回合 */ }
    }
  }

  /* ============================ 内置事件模板（22 个） ============================
   * weight(state) 返回 0 表示不可能发生；gen 生成描述与效果。
   * 随机性只决定时机，因果由世界状态决定。
   */
  const worstRegionBy = (s, key) => [...s.regions].sort((a, b) => b[key] - a[key])[0];

  const EVENT_TEMPLATES = [
    { id: 'et_drought', cat: '自然事件', weight: (s) => s.regions.some((r) => r.disaster && r.disaster.type === '旱灾') ? 3 : 0,
      gen: (s) => { const r = s.regions.find((x) => x.disaster && x.disaster.type === '旱灾'); return { title: `${r.name}旱情持续`, description: `${r.name}又逾一月无有效降水，河渠见底，乡民开始凿井抢水。`, severity: r.disaster.severity >= 3 ? 'high' : 'medium', regionId: r.id, effects: { stability: -1 } }; } },
    { id: 'et_flood', cat: '自然事件', weight: (s) => (s.date.month >= 5 && s.date.month <= 8) ? 2.2 : 0.4,
      gen: (s) => { const reg = s.regions[5]; return { title: `${reg.name}河堤漫溢`, description: `连日暴雨，${reg.name}低洼处河水漫堤，田庐被淹，灾黎栖于高埠。`, severity: 'medium', regionId: reg.id, effects: { food: -30000, publicSupport: -2 }, followup: { title: `${reg.name}水患善后`, description: '水退之后，淤田补种需要钱粮，地方申请缓征。', severity: 'low', afterTurns: 2 } }; } },
    { id: 'et_locust', cat: '自然事件', weight: (s) => (s.date.month >= 7 && s.date.month <= 9) ? 1.8 : 0.2,
      gen: (s) => { const reg = s.regions.filter((x) => x.agriculture > 40)[0] || s.regions[4]; return { title: `${reg.name}飞蝗过境`, description: '蝗群自东而来，落处禾稼立尽。农人击鼓驱赶，收效甚微。', severity: 'medium', regionId: reg.id, effects: { food: -45000, stability: -1 } }; } },
    { id: 'et_plague', cat: '自然事件', weight: (s) => s.regions.some((r) => r.disaster && (r.disaster.type === '饥荒' || r.disaster.type === '洪灾')) ? 1.6 : 0.3,
      gen: (s) => { const r = s.regions.find((x) => x.disaster) || s.regions[0]; return { title: `${r.name}时疫渐起`, description: '大灾之后有大疫。城乡出现发热之症，医官建议隔离病患、掩埋秽物。', severity: 'medium', regionId: r.id, effects: { population: -Math.round(r.population * 0.002), publicSupport: -1 } }; } },
    { id: 'et_relief_plea', cat: '社会事件', weight: (s) => s.regions.some((r) => r.disaster && r.disaster.severity >= 3) ? 2.5 : 0,
      gen: (s) => { const r = s.regions.find((x) => x.disaster && x.disaster.severity >= 3); return { title: `${r.name}巡抚急奏请赈`, description: `${r.name}奏称：仓粮将尽，请速拨银米，迟恐生变。`, severity: 'high', regionId: r.id, characterId: r.governor || null }; } },
    { id: 'et_graft', cat: '政治事件', weight: (s) => s.country.corruption >= 45 ? 2.2 : 0.3,
      gen: (s, rng) => { const cands = s.characters.filter((c) => c.corruption >= 40); const c = DS.util.pick(rng, cands.length ? cands : s.characters); return { title: `${c.role}${c.name}被参贪墨`, description: `有言官密奏：${c.role}${c.name}经手款项账目不清，请旨查办。`, severity: 'medium', characterId: c.id, followup: { title: `核查${c.role}衙门账目`, description: s.country.bureaucracy >= 65 ? '账册核对已毕，吏治尚算清明，追缴了部分赃款。' : '卷宗散乱，最终不了了之。', severity: 'low', afterTurns: 2, effects: s.country.bureaucracy >= 65 ? { treasury: 20000, corruption: -1 } : {} } }; } },
    { id: 'et_faction', cat: '政治事件', weight: () => 1.4,
      gen: (s, rng) => { const f1 = DS.util.pick(rng, s.factions); let f2 = DS.util.pick(rng, s.factions); if (f2.id === f1.id) f2 = s.factions[(s.factions.indexOf(f1) + 1) % s.factions.length]; return { title: `${f1.name}与${f2.name}互攻不休`, description: '两派官员就近期政务互相弹劾，奏疏往来，政务为之一滞。', severity: 'low', effects: { bureaucracy: -1 } }; } },
    { id: 'et_censor', cat: '政治事件', weight: () => 1.2,
      gen: () => ({ title: '御史轮值进言', description: '御史呈上条陈：今民力凋敝而用度不减，愿陛下节流恤民，慎用人、清赋役。', severity: 'low' }) },
    { id: 'et_border_raid', cat: '军事事件', weight: (s) => Math.max(...s.diplomacy.map((d) => d.borderPressure)) >= 60 ? 2.6 : 0,
      gen: (s) => { const d = [...s.diplomacy].sort((a, b) => b.borderPressure - a.borderPressure)[0]; return { title: `${d.name}叩边`, description: `${d.name}游骑犯边，掠人畜而去。边将请求增兵添饷。`, severity: 'high', effects: { borderPressure: 3, morale: -1 }, followup: { title: '边镇请饷', description: '督抚合词请拨明年边饷，若再拖欠，恐边军解体。', severity: 'medium', afterTurns: 1, effects: { morale: -2 } } }; } },
    { id: 'et_pay_petition', cat: '军事事件', weight: (s) => s.country.morale <= 48 ? 2.4 : 0,
      gen: () => ({ title: '各镇乞饷文书纷至', description: '欠饷既久，各镇军官联名乞饷，言辞渐有不逊之意。', severity: 'medium', effects: { morale: -1 } }) },
    { id: 'et_mutiny_risk', cat: '军事事件', weight: (s) => s.country.morale <= 32 ? 3 : 0,
      gen: () => ({ title: '营中夜噪', description: '有营伍因欠饷聚众鼓噪，焚燎营门，官弁弹压不住。所幸未成大乱。', severity: 'critical', effects: { morale: -3, stability: -3, militaryPower: -2 } }) },
    { id: 'et_hoarding', cat: '财政事件', weight: (s) => s.country.food < 500000 ? 2.4 : 0.4,
      gen: () => ({ title: '粮商囤积居奇', description: '富商巨室乘灾闭籴，斗米千钱，小民惶惶。', severity: 'medium', effects: { publicSupport: -2 }, followup: { title: '粮价续涨', description: '若无平粜之举，粮价仍将上腾。', severity: 'low', afterTurns: 1 } }) },
    { id: 'et_silver', cat: '财政事件', weight: (s) => s.country.treasury < 120000 ? 2.2 : 0.4,
      gen: () => ({ title: '太仓告急', description: '户部奏：各处请讨文书堆积，而库藏所余无几，请陛下早定开源之策。', severity: 'high' }) },
    { id: 'et_levee', cat: '工程事件', weight: () => 1.0,
      gen: (s) => { const reg = s.regions[4]; return { title: '黄河伏汛堪危', description: '河工禀报：堤防岁久失修，伏汛将至。工部估算需银数万两。', severity: 'medium', regionId: reg.id, followup: { title: '伏汛过关与否', description: s.activePolicies.includes('p_xiuqu') ? '因渠堰新修，宣泄有道，伏汛平安过境。' : '堤多处渗漏，幸抢救及时，未至溃决，然险象环生。', severity: 'low', afterTurns: 2, effects: s.activePolicies.includes('p_xiuqu') ? {} : { food: -20000 } } }; } },
    { id: 'et_petition_students', cat: '社会事件', weight: (s) => s.country.publicSupport <= 38 ? 1.8 : 0.4,
      gen: () => ({ title: '诸生伏阙上书', description: '国子监生数百人跪于宫门，恳请轻徭薄赋、罢黜贪残。士林清议为之鼓动。', severity: 'medium', effects: { publicSupport: 1 } }) },
    { id: 'et_sect', cat: '社会事件', weight: (s) => s.country.stability <= 40 ? 2.2 : 0.3,
      gen: (s) => { const r = worstRegionBy(s, 'unrest') || s.regions[0]; return { title: `${r.name}闻民间教门传教`, description: `缇骑密报：${r.name}有教门借施药赈济之名聚集流民，其志难测。`, severity: 'medium', regionId: r.id }; } },
    { id: 'et_tribute', cat: '外交事件', weight: (s) => s.diplomacy.some((d) => d.relation >= 40) ? 1.4 : 0,
      gen: (s) => { const d = s.diplomacy.filter((x) => x.relation >= 40)[0]; return { title: `${d.name}遣使入贡`, description: `${d.name}使团抵京，献方物，请市易。礼部议接待事宜。`, severity: 'low', effects: { treasury: 8000, authority: 1 } }; } },
    { id: 'et_demand', cat: '外交事件', weight: (s) => s.diplomacy.some((d) => d.relation <= -40) ? 2.0 : 0.3,
      gen: (s) => { const d = s.diplomacy.filter((x) => x.relation <= -40)[0]; return { title: `${d.name}移文勒索`, description: `${d.name}来书索岁币三十万两，语多威胁，限一月内答复。`, severity: 'high' }; } },
    { id: 'et_caravan', cat: '外交事件', weight: (s) => s.diplomacy.some((d) => d.trade >= 50) ? 1.5 : 0.3,
      gen: () => ({ title: '商队抵达互市', description: '西域驼队络绎而至，抽分关税入库，市面颇形热闹。', severity: 'low', effects: { treasury: 15000 } }) },
    { id: 'et_good_harvest', cat: '自然事件', weight: (s) => (s.date.month >= 8 && s.date.month <= 10 && s.regions.some((r) => r.agriculture >= 60 && !r.disaster)) ? 1.8 : 0,
      gen: (s) => { const r = s.regions.filter((x) => x.agriculture >= 60 && !x.disaster)[0] || s.regions[4]; return { title: `${r.name}秋成丰稔`, description: `是岁${r.name}风雨应时，禾黍倍收，斗米复贱，闾里稍安。`, severity: 'low', regionId: r.id, effects: { food: 60000, publicSupport: 2 } }; } },
    { id: 'et_craft', cat: '科技事件', weight: (s) => (s.activePolicies.includes('p_liju') ? 1.5 : 0.5),
      gen: () => ({ title: '匠作献新械', description: '有巧匠献改良水车与代耕之具，试之果便。工部请推广之。', severity: 'low' }) },
    { id: 'et_bandits', cat: '社会事件', weight: (s) => s.regions.some((r) => r.security <= 42) ? 1.8 : 0.4,
      gen: (s) => { const r = [...s.regions].sort((a, b) => a.security - b.security)[0]; return { title: `${r.name}盗匪结聚`, description: `${r.name}山多林密，饥民从盗者众，道路劫掠时有。`, severity: 'medium', regionId: r.id, effects: { stability: -1 } }; } },
    { id: 'et_gentry', cat: '社会事件', weight: () => 1.1,
      gen: (s, rng) => { const r = DS.util.pick(rng, s.regions.filter((x) => x.commerce >= 60)) || s.regions[6]; return { title: `${r.name}士绅公呈`, description: `${r.name}绅衿联名呈请：逋赋积年，乞蠲免旧欠，以苏民困。`, severity: 'low', regionId: r.id }; } },
  ];

  /* ============================ 败亡判定 ============================ */
  function checkCollapse(state, ctx) {
    const C = state.country;
    // 民变大势：连续高压则累积 rebellionProgress
    if (ctx.avgUnrest >= 72 && C.publicSupport <= 16) {
      state.flags.lowStreak++;
      if (state.flags.lowStreak >= 2) state.flags.rebellionProgress++;
    } else {
      state.flags.lowStreak = Math.max(0, state.flags.lowStreak - 1);
      if (ctx.avgUnrest < 55 && C.publicSupport >= 30) state.flags.rebellionProgress = Math.max(0, state.flags.rebellionProgress - 1);
    }
    if (!state.gameOver && (state.flags.rebellionProgress >= 2 || C.authority <= 8 || C.debt >= 300000)) {
      state.gameOver = evaluateEnding(state);
      recordHistory(state, { type: 'system', title: `【终局】${state.gameOver.label}`, description: state.gameOver.desc });
    }
  }

  /* ============================ 结局评定 ============================ */
  function averageScores(state) {
    const st = state.stats;
    const n = Math.max(1, st.count);
    return {
      stability: st.sums.stability / n,
      publicSupport: st.sums.publicSupport / n,
      militaryPower: st.sums.militaryPower / n,
      corruption: st.sums.corruption / n,
    };
  }

  function evaluateEnding(state) {
    const C = state.country;
    const avgRaw = averageScores(state);
    const avg = {
      stability: Math.round(avgRaw.stability),
      publicSupport: Math.round(avgRaw.publicSupport),
      militaryPower: Math.round(avgRaw.militaryPower),
      corruption: Math.round(avgRaw.corruption),
    };
    const regionsUnrestHigh = state.regions.filter((r) => r.unrest >= 70).length;
    const ctx = { avg, regionsUnrestHigh };

    const reignTurns = Math.max(1, state.turn - 1);
    const years = reignTurns / 12;
    const scores = {
      economy: clamp(Math.round((C.treasury / 1200000) * 55 + (C.debt === 0 ? 20 : Math.max(0, 20 - C.debt / 20000))), 0, 100),
      livelihood: clamp(Math.round(avg.publicSupport * 0.6 + clamp(C.food / 8000, 0, 40)), 0, 100),
      military: clamp(Math.round(avg.militaryPower * 0.7 + (100 - C.borderPressure) * 0.3), 0, 100),
      political: clamp(Math.round((state.ruler.authority + 100 - C.corruption + C.bureaucracy) / 3), 0, 100),
      diplomatic: clamp(Math.round(state.diplomacy.reduce((a, d) => a + (d.relation + 100) / 2, 0) / state.diplomacy.length), 0, 100),
      reform: clamp(Math.round(state.stats.policiesAdopted * 12 + (100 - C.corruption) * 0.35 + C.bureaucracy * 0.2), 0, 100),
      stabilityScore: Math.round(avg.stability),
    };

    let ended = DS.DATA.ENDINGS.find((e) => { try { return e.test(state, ctx); } catch (_err) { return false; } });
    ended = ended || DS.DATA.ENDINGS[DS.DATA.ENDINGS.length - 1];

    return {
      id: ended.id, label: ended.label, icon: ended.icon, desc: ended.desc,
      scores,
      stats: {
        reignYears: Math.round(years * 10) / 10,
        turns: state.turn,
        orders: state.stats.ordersIssued,
        policies: state.stats.policiesAdopted,
        events: state.events.length,
        historyEntries: state.history.length,
        seed: state.seed,
      },
      avg,
    };
  }

  /* ============================ 查询辅助 ============================ */
  function getRegion(state, id) { return state.regions.find((r) => r.id === id) || null; }
  function getCharacter(state, id) { return (state.characters || []).find((c) => c.id === id) || null; }
  function getFaction(state, nameOrId) {
    return state.factions.find((f) => f.id === nameOrId || f.name === nameOrId) || null;
  }
  function situationLine(state) {
    const C = state.country;
    const monthlyBurn = Math.round(30000 + C.militaryPower * 1150 + 22000 + C.bureaucracy * 240);
    const netMonthly = estimateIncome(state) - monthlyBurn;
    const coverMonths = netMonthly >= 0 ? Infinity : Math.floor(C.treasury / Math.max(1, -netMonthly));
    const disasters = state.regions.filter((r) => r.disaster);
    const risky = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
    const parts = [];
    parts.push(disasters.length ? `${disasters.map((r) => `${r.name}${r.disaster.type}`).join('、')}未解` : '四方无事');
    parts.push(`${risky.name}乱险 ${Math.round(risky.unrest)}`);
    parts.push(coverMonths > 24 ? '库帑尚裕' : coverMonths > 8 ? `库银约支 ${coverMonths} 月` : '库藏告急');
    return parts.join(' · ');
  }
  function estimateIncome(state) {
    return state.regions.reduce((a, r) => {
      const leak = 1 - 0.35 * (r.corruption / 100);
      return a + r.income * (r.taxRate / 18) * (0.85 + r.loyalty / 220) * leak * INCOME_SCALE;
    }, 0);
  }

  DS.State = {
    SCHEMA_VERSION, METRIC_DEFS, METRIC_BOUNDS, SNAKE_MAP, normKey,
    createNewGame, normalizeState,
    recordHistory, addEvent, addPendingEvent,
    validateAIResult, applyChanges, applyNpcChanges, applyRegionalChanges,
    computeModifiers, advanceMonth, fireRandomEvents,
    evaluateEnding, averageScores, checkCollapse,
    getRegion, getCharacter, getFaction, situationLine, estimateIncome,
    EVENT_TEMPLATES,
  };
})(window.DynastySim = window.DynastySim || {});
