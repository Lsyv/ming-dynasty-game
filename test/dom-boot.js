/* DOM 级启动测试：用 jsdom 走完 欢迎页→新游戏→下诏→结束回合→召见对话 全流程 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

// 补齐 jsdom 缺失的全局
window.AbortController = window.AbortController || global.AbortController;
window.DOMException = window.DOMException || global.DOMException;
window.structuredClone = window.structuredClone || ((o) => JSON.parse(JSON.stringify(o)));

// app.js 监听 DOMContentLoaded，但 jsdom 构造时该事件已派发 → 手动捕获并触发
let bootFn = null;
const origAdd = document.addEventListener.bind(document);
document.addEventListener = (type, fn, opts) => {
  if (type === 'DOMContentLoaded') { bootFn = fn; return; }
  return origAdd(type, fn, opts);
};

// 按 index.html 的顺序执行脚本
for (const f of ['utils', 'i18n', 'data', 'state', 'mockai', 'ai', 'storage', 'map', 'ui', 'views', 'game', 'app']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf-8');
  window.eval(code + `\n//# sourceURL=${f}.js`);
}
if (!bootFn) { console.error('✗ 未捕获到启动回调'); process.exit(1); }
bootFn();

const DS = window.DynastySim;
let failed = 0;
const assert = (cond, msg) => { console.log((cond ? '✓' : '✗ FAIL') + ' ' + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const clickByText = (root, text) => {
  const el = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (el) el.click();
  return el;
};

(async () => {
  /* 1. 首屏 */
  assert(!$('#welcome-screen').hidden, '欢迎界面可见');
  assert($('#app').hidden, '主界面初始隐藏');
  assert(document.querySelectorAll('#w-btn-new,#w-btn-load,#w-btn-api,#w-btn-help,#w-btn-demo').length === 5, '五个欢迎按钮齐全');

  /* 2. 新游戏表单 → 登基 */
  $('#w-btn-new').click();
  let modal = $('#modal-root .modal');
  assert(!!modal, '新游戏弹窗出现');
  // 保持默认剧本（危局剧本会在数回合内触发终局弹窗，属正常游戏行为）
  clickByText(modal, '登基');
  await sleep(30);
  assert(!$('#app').hidden, '登基后主界面显示');
  assert($('#metric-strip').children.length === 8, '顶栏 8 项指标渲染');
  assert(document.querySelectorAll('.nav-item').length === 9, '侧栏 9 个导航项');
  assert($('.map-svg') && $$('.map-region').length === 8, 'SVG 地图与 8 地区渲染');

  function $$(sel) { return [...document.querySelectorAll(sel)]; }

  /* 3. 序章关闭后发布政令（Mock 推演） */
  clickByText($('#modal-root'), '开始亲政');
  await sleep(20);
  assert($$('#modal-root .modal').length === 0, '序章已关闭');

  const ta = $('#order-input');
  ta.value = '拨款五十万两赈济西北灾民，并派御史督办。';
  $('#btn-issue').click();
  assert($('#btn-issue').disabled === true, '发布政令后按钮立即禁用（防重复提交）');
  // 等待 Mock 引擎（300~900ms 延迟）+ 渲染
  for (let i = 0; i < 40 && !$('#modal-root .modal'); i++) await sleep(100);
  modal = $('#modal-root .modal');
  assert(!!modal && modal.textContent.includes('推演结果'), '政令推演结果弹窗出现');
  assert(modal.textContent.includes('赈'), '结果叙述包含赈灾内容');
  clickByText(modal, '知道了');
  await sleep(20);

  /* 4. 结束回合 ×3（时间推进） */
  const hudBefore = $('#hud-date').textContent;
  for (let i = 0; i < 3; i++) {
    while ($('#btn-endturn').disabled) await sleep(50);
    $('#btn-endturn').click();
    for (let j = 0; j < 30 && $('#btn-endturn').disabled; j++) await sleep(50);
  }
  assert($('#hud-date').textContent !== hudBefore, `时间推进（${hudBefore} → ${$('#hud-date').textContent}）`);
  assert($('#hud-turn').textContent.includes('4'), '回合数推进到第 4 回合');

  /* 5. 图层切换 */
  clickByText(document, '民心');
  await sleep(20);
  assert([...$$('.layer-chip')].some((c) => c.classList.contains('active') && c.textContent === '民心'), '图层切换生效');

  /* 6. 人物视图 + 召见对话 */
  [...document.querySelectorAll('.nav-item')].find((b) => b.dataset.view === 'characters').click();
  await sleep(20);
  assert($$('.char-card').length === 12, '人物卡片 12 张');
  const beforeCount = $('#modal-root').children.length;
  console.log('   [debug] 打开人物前 modal-root 子节点数:', beforeCount);
  if (beforeCount > 0) {
    console.log('   [debug] 已存在的弹窗标题:', [...$('#modal-root').querySelectorAll('.modal-head h3')].map(h => h.textContent));
  }
  $$('.char-card')[0].click();
  await sleep(60);
  const allModals = $$('#modal-root .modal');
  console.log('   [debug] 点击后弹窗数:', allModals.length,
    '| 标题:', allModals.map(m => m.querySelector('.modal-head h3')?.textContent));
  console.log('   [debug] 首个弹窗 body tags:', allModals[0]
    ? [...allModals[0].querySelectorAll('.modal-body > *')].map(n => n.tagName + '.' + n.className).join(', ')
    : '(无)');
  modal = $('#modal-root .modal');
  assert(!!modal && modal.querySelector('.chat-input'), '人物详情含召见对话框');
  const chatInput = modal.querySelector('.chat-input');
  chatInput.value = '你怎么看现在的财政危机？';
  clickByText(modal, '召见问对');
  for (let i = 0; i < 30 && !modal.querySelector('.chat-msg.theirs'); i++) await sleep(100);
  assert(modal.querySelector('.chat-msg.mine'), '玩家问话上屏');
  assert(modal.querySelector('.chat-msg.theirs'), 'NPC 答复上屏');
  clickByText(modal.parentElement, '关闭') || $('.modal-head .icon-btn').click();
  await sleep(20);

  /* 7. 廷议 */
  [...document.querySelectorAll('.nav-item')].find((b) => b.dataset.view === 'court').click();
  await sleep(20);
  $$('.court-card')[0].click(); $$('.court-card')[1].click(); $$('.court-card')[2].click();
  clickByText($('#view'), '召集廷议');
  for (let i = 0; i < 40 && !$('#view .speech'); i++) await sleep(100);
  assert($$('#view .speech').length >= 3, '廷议三段发言渲染');
  assert($('#view').textContent.includes('采纳此议'), '存在采纳建议入口');

  /* 8. 实录视图 */
  [...document.querySelectorAll('.nav-item')].find((b) => b.dataset.view === 'history').click();
  await sleep(20);
  assert($$('.hist-item').length > 3, '国史实录有记录');
  assert($('#view').textContent.includes('帝下诏'), '实录包含政令记录');

  /* 9. 存档：手动保存 + 读取回放 */
  [...document.querySelectorAll('.nav-item')].find((b) => b.dataset.view === 'saves').click();
  await sleep(20);
  const saveBtns = $$('#view .save-row button').filter((b) => b.textContent === '保存');
  saveBtns[1] && saveBtns[1].click(); // slot1
  await sleep(20);
  assert($('#toast-root').textContent.includes('已保存'), '手动保存成功提示');
  const autoMeta = DS.Storage.listSaves().find((m) => m.slot === 'auto');
  assert(autoMeta && !autoMeta.empty, '自动存档已写入');

  /* 10. 设置视图 + 调试开关 */
  [...document.querySelectorAll('.nav-item')].find((b) => b.dataset.view === 'settings').click();
  await sleep(20);
  assert($$('.tab').length === 6, '设置六个标签页');
  clickByText($('#view'), 'AI 接口');
  await sleep(20);
  assert($('#view').textContent.includes('API 配置'), 'AI 设置区渲染');
  assert($('#view').textContent.includes('暴露'), '安全提示存在');

  console.log(failed ? `\n=== ${failed} 项失败 ===` : '\n=== DOM 启动测试全部通过 ===');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
