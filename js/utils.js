/* ============================================================================
 * utils.js — 基础工具库
 * ----------------------------------------------------------------------------
 * 提供：DOM 构建辅助（自动文本节点，天然防 XSS）、HTML 转义、数字/货币格式化、
 *       可种子化随机数（mulberry32 + 字符串哈希）、深拷贝、下载/读文件等。
 * 约定：本文件顶层不触碰 document，可在 Node 中安全加载做无头测试。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  /* ---------------- HTML 转义（XSS 防护核心） ---------------- */
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"'`]/g, (c) => ESC_MAP[c]);
  }

  /** 在任意字符串中掩蔽指定密钥片段，避免日志泄漏完整 API Key */
  function maskSecret(text, secret) {
    if (!secret || !text) return text;
    let out = String(text).split(secret).join(maskKey(secret));
    // 常见 Bearer 形式也一并掩蔽
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-~+/=]{8,}/g, (_m, p1) => p1 + '••••••••');
    return out;
  }

  /** Key 的展示形式：sk-••••••1234 */
  function maskKey(key) {
    const s = String(key || '');
    if (!s) return '（未设置）';
    if (s.length <= 8) return '•'.repeat(s.length);
    return s.slice(0, 3) + '•'.repeat(Math.min(10, Math.max(4, s.length - 7))) + s.slice(-4);
  }

  /* ---------------- DOM 构建 ----------------
   * el(tag, attrs, ...children)：子节点若为字符串一律走 createTextNode，
   * 因此“用户输入/AI 输出”通过 el() 插入时天然免疫 XSS。
   */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { appendChildren(node, c); continue; }
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /* ---------------- 数值与格式化 ---------------- */
  function clamp(v, min, max) {
    if (typeof v !== 'number' || !isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  /** 千分位整数 */
  function fmtInt(n) {
    if (n == null || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('zh-CN');
  }
  /** 资源型大数：1.2 万两 / 350 万石 */
  function fmtRes(n, unit) {
    if (n == null || !isFinite(n)) return '—';
    const abs = Math.abs(n);
    let text;
    if (abs >= 100000000) text = round1(n / 100000000) + ' 亿';
    else if (abs >= 10000) text = round1(n / 10000) + ' 万';
    else text = fmtInt(n);
    return unit ? text + ' ' + unit : text;
  }
  function fmtMoney(n) { return fmtRes(n, '两'); }
  function fmtSigned(n) {
    if (n == null || !isFinite(n)) return '';
    const v = Math.round(n * 10) / 10;
    return (v > 0 ? '+' : '') + fmtInt(v);
  }

  const SEASON_OF_MONTH = { 12: '冬', 1: '春', 2: '春', 3: '春', 4: '夏', 5: '夏', 6: '夏', 7: '秋', 8: '秋', 9: '秋', 10: '冬', 11: '冬' };
  function seasonOf(month) { return SEASON_OF_MONTH[month] || ''; }
  function dateLabel(date) { return `${date.year} 年 ${date.month} 月`; }

  /* ---------------- 可种子化随机数 ----------------
   * mulberry32：确定性 PRNG。同一 seed + 同一调用序列 → 相同结果。
   * 游戏内所有随机都必须经由 RNG 派生（seed + turn + salt），保证可复现。
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** FNV-1a 字符串哈希 → uint32 */
  function hash32(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  /** 由基础 seed 与若干盐派生子随机源（回合内不同用途互不影响序列） */
  function deriveRng(seed, ...salts) {
    return mulberry32(hash32(salts.join('|')) ^ (seed >>> 0));
  }
  function range(rng, min, max) { return min + rng() * (max - min); }
  function intRange(rng, min, max) { return Math.floor(range(rng, min, max + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  /** 按权重挑选：weightFn(item)=>number */
  function weightedPick(rng, items, weightFn) {
    const wf = weightFn || ((it) => it.w == null ? 0 : it.w);
    let total = 0;
    for (const it of items) total += Math.max(0, wf(it));
    if (total <= 0) return null;
    let r = rng() * total;
    for (const it of items) {
      r -= Math.max(0, wf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  /* ---------------- 其他 ---------------- */
  function deepClone(obj) {
    if (obj == null) return obj;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch (_) {/* 含函数等不可克隆对象时退回 JSON */ }
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() { return new Date().toISOString(); }

  function todayStamp() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 触发浏览器下载 */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
  }

  /** FileReader Promise 化：读取本地文本文件 */
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsText(file, 'utf-8');
    });
  }

  /** 简易防抖 */
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /** djb2 校验和（存档完整性提示用，非加密） */
  function checksum(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** 截断长文本 */
  function trunc(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  DS.util = {
    esc, maskSecret, maskKey,
    el, qs, qsa,
    clamp, round1, fmtInt, fmtRes, fmtMoney, fmtSigned,
    seasonOf, dateLabel,
    mulberry32, hash32, deriveRng, range, intRange, pick, weightedPick,
    deepClone, uid, nowISO, todayStamp,
    download, readFileText, debounce, checksum, trunc,
  };
})(window.DynastySim = window.DynastySim || {});
