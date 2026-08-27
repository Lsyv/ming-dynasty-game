/* ============================================================================
 * map.js — 天下地图（原创抽象 SVG 地图）
 * ----------------------------------------------------------------------------
 * · 8 个地区以不规则多边形呈现（由包围盒+确定性抖动生成，风格化不写实）
 * · 图层：标准 / 民心 / 财政 / 粮食 / 灾害 / 动乱 / 军事 / 治安
 * · 灾害用抽象符号（日纹、波纹、蝗点、疫符、饥纹），不含任何不适画面
 * · 不做逐帧重绘：仅图层切换或状态变化时重建
 * ==========================================================================*/
(function (DS) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LAYERS = [
    { id: 'standard', label: '标准' },
    { id: 'publicSupport', label: '民心' },
    { id: 'income', label: '财政' },
    { id: 'grain', label: '粮食' },
    { id: 'disaster', label: '灾害' },
    { id: 'unrest', label: '动乱' },
    { id: 'military', label: '军事' },
    { id: 'security', label: '治安' },
  ];

  /** 由包围盒生成不规则六边形顶点（抖动量由地区 id 确定，稳定可复现） */
  function polyPoints(r) {
    const h = DS.util.hash32('geo' + r.id);
    const j = (i, amp) => ((h >> (i * 3)) % 7 - 3) / 3 * amp;
    const x = r.x, y = r.y, w = r.w, hh = r.h;
    const pts = [
      [x + w * 0.12, y + j(1, 10)],            // 左上
      [x + w * 0.55, y + Math.max(4, 8 + j(2, 8))],   // 上中
      [x + w * 0.94, y + j(3, 10)],            // 右上
      [x + w * 0.9, y + hh * 0.62],            // 右中偏下
      [x + w * 0.5, y + hh - Math.max(4, 6 + j(4, 8))], // 下中
      [x + w * 0.08, y + hh * 0.7],            // 左下
    ];
    return pts.map((p) => p.map((n) => Math.round(n)).join(',')).join(' ');
  }

  /** 数值 → 颜色（0..100）。goodDir=true 时值越大越青绿，越小越赤红 */
  function valueColor(v, goodDir) {
    const t = DS.util.clamp(v / 100, 0, 1);
    // 红(#c0392b) → 土黄(#d9b44a) → 青绿(#4e8d6e)
    const stops = [[192, 57, 43], [217, 180, 74], [78, 141, 110]];
    const pos = goodDir ? t : 1 - t;
    const seg = pos < 0.5 ? 0 : 1;
    const localT = pos < 0.5 ? pos / 0.5 : (pos - 0.5) / 0.5;
    const c0 = stops[seg], c1 = stops[seg + 1];
    const mix = c0.map((c, i) => Math.round(c + (c1[i] - c[i]) * localT));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    return n;
  }

  /* ---------------- 灾害抽象符号 ---------------- */
  function drawDisasterGlyph(g, cx, cy, type, severity) {
    const col = { '旱灾': '#e67e22', '洪灾': '#2980b9', '蝗灾': '#8e6e1f', '疫情': '#8e44ad', '饥荒': '#7f8c8d' }[type] || '#999';
    if (type === '旱灾') {
      g.append(svgEl('circle', { cx, cy, r: 7, fill: 'none', stroke: col, 'stroke-width': 2 }));
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        g.append(svgEl('line', {
          x1: cx + Math.cos(a) * 9.5, y1: cy + Math.sin(a) * 9.5,
          x2: cx + Math.cos(a) * 13, y2: cy + Math.sin(a) * 13,
          stroke: col, 'stroke-width': 2,
        }));
      }
    } else if (type === '洪灾') {
      for (let i = -1; i <= 1; i++) {
        g.append(svgEl('path', {
          d: `M ${cx - 12} ${cy + i * 6} q 4 -5 8 0 t 8 0 t 8 0`,
          fill: 'none', stroke: col, 'stroke-width': 2,
        }));
      }
    } else if (type === '蝗灾') {
      const dots = [[0, -6], [-7, 5], [7, 5]];
      for (const [dx, dy] of dots) g.append(svgEl('circle', { cx: cx + dx, cy: cy + dy, r: 3.2, fill: col }));
    } else if (type === '疫情') {
      g.append(svgEl('rect', { x: cx - 3, y: cy - 9, width: 6, height: 18, fill: col, rx: 2 }));
      g.append(svgEl('rect', { x: cx - 9, y: cy - 3, width: 18, height: 6, fill: col, rx: 2 }));
    } else { // 饥荒：空碗弧线
      g.append(svgEl('path', { d: `M ${cx - 10} ${cy} a 10 10 0 0 0 20 0 z`, fill: 'none', stroke: col, 'stroke-width': 2.5 }));
      g.append(svgEl('line', { x1: cx - 13, y1: cy, x2: cx + 13, y2: cy, stroke: col, 'stroke-width': 2.5 }));
    }
    // 强度刻度（一~五 用短竖线表示）
    for (let i = 0; i < severity; i++) {
      g.append(svgEl('rect', { x: cx - 8 + i * 5, y: cy + 14, width: 3, height: 5, fill: col, rx: 1 }));
    }
  }

  /* ---------------- 主渲染 ---------------- */
  /**
   * @param {HTMLElement} container
   * @param {object} state 游戏状态
   * @param {string} layer 图层 id
   * @param {(regionId:string)=>void} onRegionClick
   */
  function render(container, state, layer, onRegionClick) {
    container.textContent = '';
    const svg = svgEl('svg', {
      viewBox: '0 0 1000 720',
      class: 'map-svg',
      role: 'img',
      'aria-label': '天下地图：' + (LAYERS.find((l) => l.id === layer) || {}).label,
      preserveAspectRatio: 'xMidYMid meet',
    });

    // 海洋底色 + 装饰性「海岸线」
    svg.append(svgEl('rect', { x: 0, y: 0, width: 1000, height: 720, class: 'map-sea' }));
    svg.append(svgEl('path', {
      d: 'M 60 40 C 200 120, 160 260, 80 340 M 950 90 C 900 200, 960 300, 900 380',
      class: 'map-wave-deco', fill: 'none',
    }));

    for (const r of state.regions) {
      const g = svgEl('g', {
        class: 'map-region' + (r.disaster ? ' has-disaster' : ''),
        role: 'button', tabindex: '0',
        'aria-label': `${r.name}，点击查看详情`,
      });
      const pts = polyPoints(r);

      // 填充色取决于图层
      let fill = 'var(--map-land)';
      let badge = '';
      switch (layer) {
        case 'publicSupport': fill = valueColor(r.loyalty, true); break;
        case 'unrest': fill = valueColor(r.unrest, false); break;
        case 'security': fill = valueColor(r.security, true); break;
        case 'military': fill = valueColor(r.military, true); break;
        case 'grain': fill = valueColor(DS.util.clamp((r.grain / Math.max(1, r.population)) * 400, 0, 100), true); break;
        case 'income': fill = valueColor(DS.util.clamp((r.income / 170000) * 100, 0, 100), true); break;
        case 'disaster': fill = r.disaster ? valueColor(r.disaster.severity * 20, false) : 'var(--map-land-calm)'; break;
        default: fill = r.disaster ? 'var(--map-land)' : 'var(--map-land-calm)';
      }

      g.append(svgEl('polygon', {
        points: pts, fill, class: 'map-poly',
        stroke: 'rgba(0,0,0,.35)', 'stroke-width': 2,
      }));

      // 名称与主数值标签
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const label = svgEl('text', { x: cx, y: cy - 6, class: 'map-label', 'text-anchor': 'middle' });
      label.textContent = r.name;
      g.append(label);

      const valText = {
        standard: r.unrest >= 60 ? '乱' : '安',
        publicSupport: `民 ${Math.round(r.loyalty)}`,
        income: `${DS.util.fmtRes(r.income)}两/月`,
        grain: `粮 ${DS.util.fmtRes(r.grain, '石')}`,
        disaster: r.disaster ? `${r.disaster.type}` : '无灾',
        unrest: `乱 ${Math.round(r.unrest)}`,
        military: `军 ${Math.round(r.military)}`,
        security: `治 ${Math.round(r.security)}`,
      }[layer] || '';
      const sub = svgEl('text', { x: cx, y: cy + 16, class: 'map-sublabel', 'text-anchor': 'middle' });
      sub.textContent = valText;
      g.append(sub);

      // 灾害符号
      if (r.disaster && (layer === 'standard' || layer === 'disaster')) {
        drawDisasterGlyph(g, r.x + r.w - 26, r.y + 26, r.disaster.type, r.disaster.severity);
      }

      // 交互
      const activate = () => onRegionClick && onRegionClick(r.id);
      g.addEventListener('click', activate);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); } });
      svg.append(g);
    }

    // 指北针装饰
    const compass = svgEl('g', { class: 'map-compass' });
    compass.append(svgEl('circle', { cx: 52, cy: 668, r: 18, class: 'compass-ring' }));
    compass.append(svgEl('path', { d: 'M 52 652 L 58 672 L 52 667 L 46 672 Z', class: 'compass-needle' }));
    const north = svgEl('text', { x: 52, y: 700, 'text-anchor': 'middle', class: 'compass-label' });
    north.textContent = '北';
    compass.append(north);
    svg.append(compass);

    container.append(svg);
  }

  DS.MapView = { render, LAYERS };
})(window.DynastySim = window.DynastySim || {});
