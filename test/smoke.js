/* 无头冒烟测试：在 Node 中加载全部模块，跑通 创建→政令→推进36回合→结局 全流程 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 环境桩 ----
global.window = global;
global.performance = global.performance || { now: () => Date.now() };
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// ---- 加载模块（顺序同 index.html）----
const files = ['utils', 'i18n', 'data', 'state', 'mockai', 'ai', 'storage'];
for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf-8');
  vm.runInThisContext(code, { filename: f + '.js' });
}
const DS = global.window.DynastySim;
const assert = (cond, msg) => { if (!cond) { console.error('✗ FAIL:', msg); process.exitCode = 1; } else console.log('✓', msg); };

/* ========== 1. 世界初始化 ========== */
let s = DS.State.createNewGame({ scenarioId: 'sc_default', seed: 1627, difficulty: 'standard' });
assert(s.regions.length === 8, '8 个地区');
assert(s.characters.length === 12, '12 位人物');
assert(s.factions.length === 6, '6 个派系');
assert(s.diplomacy.length === 5, '5 个外交势力');
assert(s.policiesKnown.length >= 15, `国策树 ${s.policiesKnown.length} 项`);
assert(s.history.length === 1 && s.history[0].title === '新君即位', '开局史册记录');
assert(typeof s.seed === 'number' && s.seed > 0, '随机种子已生成');

/* ========== 2. Mock 政令推演（多类别） ========== */
const orders = [
  '拨款五十万两赈济西北灾民，并派御史监督发放。',
  '朕决定减免灾区税赋一年。',
  '加征辽东军饷三成。',
  '命都察院彻查江南织造亏空一案。',
  '开边市与北狄互市。',
  '缩减宫中用度。',
];
for (const text of orders) {
  const raw = DS.Mock.simulateOrder(s, text);
  const check = DS.State.validateAIResult(raw, s);
  assert(check.ok, `推演校验通过：${text.slice(0, 10)}…${check.ok ? '' : ' → ' + JSON.stringify(check.errors)}`);
}

/* ========== 3. 完整应用管线（模拟 game.js） ========== */
function applyResult(st, result, originalText) {
  DS.State.recordHistory(st, { type: 'order', title: `帝下诏：${result.intent.category}`, description: originalText });
  DS.State.applyChanges(st, result.state_changes, { reason: result.turn_summary });
  for (const ev of result.events) {
    DS.State.addEvent(st, { ...ev, source: 'edict' });
    if (ev.effects) DS.State.applyChanges(st, ev.effects, { reason: ev.title });
  }
  DS.State.applyNpcChanges(st, result.npc_changes, result.turn_summary);
  DS.State.applyRegionalChanges(st, result.regional_changes, result.turn_summary);
  for (const fc of result.future_consequences) DS.State.addPendingEvent(st, { ...fc, source: 'ai' });
  st.stats.ordersIssued++;
}
const before = { treasury: s.country.treasury, loyaltyXb: s.regions[0].loyalty };
applyResult(s, DS.Mock.simulateOrder(s, orders[0]), orders[0]);
assert(s.country.treasury < before.treasury, `赈灾扣款生效（${before.treasury} → ${s.country.treasury}）`);
assert(s.regions[0].loyalty > before.loyaltyXb, '西北民心因赈济上升');
assert(s.stats.ordersIssued === 1, '政令计数');

/* ========== 4. 验证器拒绝坏数据 & 钳制 ========== */
const bad = DS.State.validateAIResult({ foo: 1 }, s);
assert(!bad.ok, '缺少 summary 的结果被拒绝');
const wild = DS.State.validateAIResult({
  turn_summary: '作弊', narrative: 'x',
  state_changes: { public_support: 999999, treasury: -9e9 },
}, s);
const psBefore = s.country.publicSupport;
assert(wild.ok, '非法大数值通过了结构校验（结构合法，幅度交给应用器钳制）');
DS.State.applyChanges(s, wild.value.state_changes, { reason: 'test-clamp' });
const psDelta = s.country.publicSupport - psBefore;
assert(psDelta <= 20.5, `民心 +999999 在应用时被钳制（实际增量 ${psDelta.toFixed(1)}）`);
assert(s.country.publicSupport <= 100, '指标未越上界');
// 国库 -9e9 也应被钳制为有限扣减
assert(isFinite(s.country.treasury) && s.country.treasury >= 0, '国库扣减被钳制且不为负');

/* ========== 5. 廷议 / 对话 / 秘密保护 ========== */
const council = DS.Mock.runCouncil(s, ['c1', 'c2', 'c8']);
assert(council.speeches.length === 3, '廷议三位大臣发言');
assert(new Set(council.speeches.map((x) => x.content)).size === 3, '三人发言互不相同');
const dlg = DS.Mock.dialogue(s, 'c9', '你怎么看现在的财政危机？');
assert(dlg.reply.length > 10, 'NPC 对话返回');
assert(!dlg.reply.includes('织造银'), '秘密未被泄露（未揭示前）');
const verdict = DS.Mock.verdict(s, DS.State.evaluateEnding(s));
assert(verdict.includes('史臣曰'), '史官评语生成');

/* ========== 6. 时间推进 36 回合 ========== */
let firedTotal = 0, eventsTotal = s.events.length;
for (let i = 0; i < 36; i++) {
  const rep = DS.State.advanceMonth(s);
  firedTotal += rep.firedEvents.length;
  assert(isFinite(s.country.treasury) && isFinite(s.country.food), `回合 ${i + 1} 数值有限性`);
}
eventsTotal = s.events.length - eventsTotal;
console.log(`   … 36 回合后：${s.date.year}年${s.date.month}月 第${s.turn}回合 | 国库 ${Math.round(s.country.treasury)} | 民心 ${Math.round(s.country.publicSupport)} | 稳定 ${Math.round(s.country.stability)} | 事件+${eventsTotal} | 队列触发${firedTotal}`);
assert(eventsTotal > 0, '时间推进产生了事件');
assert(firedTotal > 0, '事件队列有到期触发');
assert(s.longTermMemory.length >= 1, '长期记忆已压缩');
assert(s.date.year >= 1630, '年份正常推进');

/* ========== 7. 存档往返 ========== */
const w = DS.Storage.writeSave('slot1', s, '测试存档');
assert(w.ok, '写档成功');
const r = DS.Storage.readSave('slot1');
assert(r && !r.corrupt && r.state.turn === s.turn, '读档往返一致');
const list = DS.Storage.listSaves();
assert(list.find((m) => m.slot === 'slot1') && !list.find((m) => m.slot === 'slot1').empty, '槽位列表正确');
// 校验和篡改检测
const tampered = JSON.parse(localStorage.getItem('dynasty_save_slot1'));
tampered.gameState.country.treasury = 1;
localStorage.setItem('dynasty_save_slot1', JSON.stringify(tampered));
const r2 = DS.Storage.readSave('slot1');
assert(r2.checksumMismatch === true, '篡改被 checksum 发现');

/* ========== 8. AI JSON 提取与修复 ========== */
const cases = [
  ['{"a":1}', 1],
  ['```json\n{"a":2}\n```', 2],
  ['前置说明 {"a":3} 后置说明', 3],
  ['{"a":4,}'],
  ['{"a":5，“b”:“中文引号”}'],
];
let parsedOk = 0;
for (const c of cases) if (DS.AI.extractJSON(c[0]) && true) parsedOk++;
assert(parsedOk >= 4, `JSON 提取/修复 ${parsedOk}/5 用例通过`);

/* ========== 9. 结局评定 ========== */
const ending = DS.State.evaluateEnding(s);
assert(ending.label && ending.scores, `结局评定：${ending.label}`);
assert(Object.keys(ending.scores).length === 7, '七维评分齐全');

/* ========== 10. Prompt 构建分层 ========== */
const simPrompt = DS.AI.PromptBuilder.simulation(s, '测试诏书');
assert(simPrompt.system.includes('世界状态推演引擎'), 'System Prompt 含核心约束');
assert(simPrompt.user.includes('【L1 世界基础】') && simPrompt.user.includes('【L6 皇帝政令】'), '上下文 L1~L6 分层');
assert(simPrompt.user.includes('测试诏书'), '玩家命令进入上下文');

console.log('\n=== 冒烟测试完成 ===');
process.exit(process.exitCode || 0);
