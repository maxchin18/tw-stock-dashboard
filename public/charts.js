// ECharts 圖表建構（所有圖表皆從 analysis 結果產生）
import { fmt, fmtInt, fmtSigned, fmtPct } from '/src/util/num.js';
import { shortDate } from '/src/util/date.js';

const instances = new Map();

export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    text: v('--text'), text2: v('--text-2'), muted: v('--muted'), grid: v('--line'), track: v('--track'),
    up: v('--up'), down: v('--down'), blue: v('--blue'), amber: v('--amber'), purple: v('--purple'),
    pink: v('--pink'), teal: v('--teal'), gray: v('--gray'), card: v('--card-solid'), bg: v('--bg'),
    dark: document.documentElement.dataset.theme === 'dark',
  };
}

function alpha(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function hasEcharts() { return typeof window.echarts !== 'undefined'; }

function get(id) {
  const el = document.getElementById(id);
  if (!el || !hasEcharts()) return null;
  let inst = instances.get(id);
  if (!inst || inst.isDisposed()) {
    inst = window.echarts.init(el, null, { renderer: 'canvas' });
    instances.set(id, inst);
  }
  return inst;
}

function set(id, option) {
  const inst = get(id);
  if (!inst) return;
  inst.setOption(option, { notMerge: true });
}

export function disposeAll() {
  for (const inst of instances.values()) if (!inst.isDisposed()) inst.dispose();
  instances.clear();
}

export function resizeAll() {
  for (const inst of instances.values()) if (!inst.isDisposed()) inst.resize();
}

export function dataUrls() {
  const p = palette();
  const out = [];
  for (const [id, inst] of instances) {
    if (inst.isDisposed()) continue;
    const el = inst.getDom();
    if (!el || el.clientWidth === 0) continue;
    out.push({ id, url: inst.getDataURL({ pixelRatio: 2, backgroundColor: p.card }) });
  }
  return out;
}

function baseAxis(p) {
  return {
    axisLine: { lineStyle: { color: p.grid } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: p.grid } },
  };
}

function tooltipStyle(p) {
  return {
    backgroundColor: p.card, borderColor: p.grid, textStyle: { color: p.text, fontSize: 12 },
    extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.15);border-radius:12px;',
  };
}

/* ---------- 01 主K線 ---------- */
export function renderKline(a) {
  const p = palette();
  const s = a.series;
  const dates = s.dates.map(shortDate);
  const candles = s.opens.map((o, i) => [o, s.closes[i], s.lows[i], s.highs[i]]);
  const n = dates.length;
  const start = Math.max(0, 100 - (80 / n) * 100);
  const { support, resistance, mainCost } = a.kline;
  const mark = (y, name, color, pos) => (y == null ? null : {
    yAxis: y, name, lineStyle: { color, type: 'dashed', width: 1.2 },
    label: { formatter: `${name} ${fmt(y)}`, position: pos, color, fontSize: 11, fontWeight: 700, backgroundColor: alpha(p.card === '#ffffff' ? '#ffffff' : p.card, 0.85), padding: [2, 4], borderRadius: 4 },
  });
  const marks = [
    mark(resistance.r2 ?? resistance.r1, '高檔壓力區', p.up, 'insideEndTop'),
    mark(mainCost, '主力成本', p.purple, 'insideStartTop'),
    mark(support.s1, '支撐區', p.blue, 'insideEndBottom'),
  ].filter(Boolean);
  set('chart-k', {
    backgroundColor: 'transparent',
    animation: false,
    legend: { top: 0, left: 4, icon: 'roundRect', itemWidth: 14, itemHeight: 8, textStyle: { color: p.text2, fontSize: 11 }, data: ['K線', 'MA5', 'MA10', 'MA20', 'MA60', '成交量'] },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: p.text, color: p.card } }, ...tooltipStyle(p),
      formatter: (ps) => {
        const k = ps.find((x) => x.seriesType === 'candlestick');
        if (!k) return '';
        const i = k.dataIndex;
        const [o, c, l, h] = k.data.slice(1);
        const chg = i > 0 ? c - s.closes[i - 1] : null;
        const pct = i > 0 && s.closes[i - 1] ? (chg / s.closes[i - 1]) * 100 : null;
        const live = s.live && i === n - 1 ? ' <span style="color:' + p.up + '">● 盤中</span>' : '';
        const rows = [
          `<b>${s.dates[i]}</b>${live}`,
          `開 ${fmt(o)}　高 ${fmt(h)}　低 ${fmt(l)}　收 <b>${fmt(c)}</b>`,
          `漲跌 <span style="color:${chg >= 0 ? p.up : p.down}">${fmtSigned(chg)}（${fmtPct(pct)}）</span>`,
          `成交量 ${fmtInt(s.volumes[i])} 張${s.turnovers[i] != null ? `　${fmtInt(s.turnovers[i])} 筆` : ''}`,
          `MA5 ${fmt(s.ma5[i])}　MA10 ${fmt(s.ma10[i])}　MA20 ${fmt(s.ma20[i])}　MA60 ${fmt(s.ma60[i])}`,
        ];
        return rows.join('<br>');
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [{ left: 8, right: 62, top: 30, height: '56%' }, { left: 8, right: 62, top: '74%', height: '15%' }],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: true, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 11 } },
      { type: 'category', gridIndex: 1, data: dates, boundaryGap: true, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: p.grid } } },
    ],
    yAxis: [
      { scale: true, position: 'right', ...baseAxis(p), axisLine: { show: false } },
      { scale: true, gridIndex: 1, position: 'right', splitNumber: 2, ...baseAxis(p), axisLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10, formatter: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v) } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 12, start, end: 100, borderColor: p.grid, fillerColor: alpha(p.blue, 0.15), handleStyle: { color: p.blue }, textStyle: { color: p.muted, fontSize: 10 }, dataBackground: { lineStyle: { color: p.grid }, areaStyle: { color: p.track } } },
    ],
    series: [
      {
        name: 'K線', type: 'candlestick', data: candles,
        itemStyle: { color: p.up, color0: p.down, borderColor: p.up, borderColor0: p.down },
        markLine: { symbol: 'none', silent: true, data: marks },
      },
      { name: 'MA5', type: 'line', data: s.ma5, showSymbol: false, smooth: true, lineStyle: { width: 1.3, color: p.purple } },
      { name: 'MA10', type: 'line', data: s.ma10, showSymbol: false, smooth: true, lineStyle: { width: 1.3, color: p.teal } },
      { name: 'MA20', type: 'line', data: s.ma20, showSymbol: false, smooth: true, lineStyle: { width: 1.5, color: p.amber } },
      { name: 'MA60', type: 'line', data: s.ma60, showSymbol: false, smooth: true, lineStyle: { width: 1.3, color: p.gray, type: 'dashed' } },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: s.volumes.map((v, i) => ({ value: v, itemStyle: { color: alpha(s.closes[i] >= s.opens[i] ? p.up : p.down, 0.75) } })),
      },
    ],
  });
}

/* ---------- 03 / 05 雷達 ---------- */
function radarOption(axes, color, center, p) {
  return {
    backgroundColor: 'transparent',
    tooltip: { ...tooltipStyle(p), formatter: () => axes.map((x) => `${x.name}：<b>${fmt(x.score, 0)}</b>`).join('<br>') },
    radar: {
      indicator: axes.map((x) => ({ name: x.name, max: 100 })),
      radius: '64%', center: ['50%', '54%'],
      axisName: { color: p.text2, fontSize: 11, fontWeight: 600 },
      splitLine: { lineStyle: { color: p.grid } },
      splitArea: { areaStyle: { color: [alpha(color, 0.03), 'transparent'] } },
      axisLine: { lineStyle: { color: p.grid } },
    },
    series: [{
      type: 'radar', symbolSize: 5,
      data: [{ value: axes.map((x) => (x.score == null ? 0 : Math.round(x.score))), name: '評分', areaStyle: { color: alpha(color, 0.22) }, lineStyle: { color, width: 2 }, itemStyle: { color } }],
    }],
    graphic: center ? [{ type: 'text', left: 'center', top: '47%', style: { text: center.big, fontSize: 30, fontWeight: 900, fill: color, fontFamily: 'Inter, sans-serif' } },
      { type: 'text', left: 'center', top: '62%', style: { text: center.small, fontSize: 11, fontWeight: 700, fill: p.muted } }] : [],
  };
}

export function renderRadar(a) {
  const p = palette();
  set('chart-radar', radarOption(a.radar.axes, p.up, { big: a.radar.grade, small: `${fmt(a.radar.total, 0)}/100` }, p));
}

export function renderRisk(a) {
  const p = palette();
  set('chart-risk', radarOption(a.riskRadar.axes, p.blue, null, p));
}

/* ---------- 04 熱區圖 ---------- */
export function renderHeat(a) {
  const p = palette();
  const h = a.heatmap;
  if (!h.available) { set('chart-heat', { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: '資料不足', fill: p.muted } }] }); return; }
  const xs = h.columns.map((c) => shortDate(c.start));
  const ys = h.binLabels.map((v) => fmt(v, 0));
  const data = [];
  let max = 0;
  h.columns.forEach((c, x) => c.bins.forEach((v, y) => { data.push([x, y, v]); if (v > max) max = v; }));
  const closeBin = Math.max(0, Math.min(h.bins - 1, Math.floor((a.header.close - h.priceMin) / h.binWidth)));
  set('chart-heat', {
    backgroundColor: 'transparent',
    tooltip: { ...tooltipStyle(p), position: 'top', formatter: (q) => `${h.columns[q.value[0]].start} ～ ${h.columns[q.value[0]].end}<br>價位 ≈ ${ys[q.value[1]]}<br>成交量占比 <b>${fmt(q.value[2], 2)}%</b>` },
    grid: { left: 40, right: 6, top: 6, bottom: 34 },
    xAxis: { type: 'category', data: xs, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 9, rotate: 90, interval: 0 } },
    yAxis: { type: 'category', data: ys, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 9, interval: 3 } },
    visualMap: { show: false, min: 0, max: max || 1, inRange: { color: [p.dark ? '#1c2440' : '#e8eefc', p.blue, p.teal, p.amber, p.up] } },
    series: [{
      type: 'heatmap', data, itemStyle: { borderColor: p.card, borderWidth: 1.5, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: p.text } },
      markLine: { silent: true, symbol: 'none', data: [{ yAxis: closeBin, lineStyle: { color: p.text, width: 1.5, type: 'solid' }, label: { formatter: `現價 ${fmt(a.header.close)}`, color: p.text, fontSize: 10, fontWeight: 700, position: 'insideEndTop' } }] },
    }],
  });
}

/* ---------- 06 預測路徑 ---------- */
export function renderForecast(a) {
  const p = palette();
  const f = a.forecast;
  if (!f.available) { set('chart-forecast', { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: '報酬樣本不足', fill: p.muted } }] }); return; }
  const close = a.header.close;
  const xs = ['今日', ...f.horizons.map((h) => `${h.h}日後`)];
  const rows = [{ h: 0, median: close, up1: close, dn1: close, up2: close, dn2: close }, ...f.horizons];
  const band = (name, arr, color) => ({ name, type: 'line', stack: 'band', data: arr, showSymbol: false, lineStyle: { width: 0 }, areaStyle: { color, opacity: 0.9 }, emphasis: { disabled: true }, tooltip: { show: false } });
  set('chart-forecast', {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', ...tooltipStyle(p),
      formatter: (ps) => { const i = ps[0].dataIndex; const r = rows[i]; return `<b>${xs[i]}</b><br>中位 ${fmt(r.median)}<br>±1σ ${fmt(r.dn1)} ～ ${fmt(r.up1)}<br>±2σ ${fmt(r.dn2)} ～ ${fmt(r.up2)}`; },
    },
    grid: { left: 8, right: 14, top: 12, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: xs, boundaryGap: false, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10, interval: (i) => [0, 3, 5, 10].includes(i) } },
    yAxis: { type: 'value', scale: true, ...baseAxis(p), axisLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10, formatter: (v) => fmt(v, 0) } },
    series: [
      band('base', rows.map((r) => r.dn2), 'transparent'),
      band('下跌區間', rows.map((r) => r.dn1 - r.dn2), alpha(p.down, 0.35)),
      band('震盪區間', rows.map((r) => r.up1 - r.dn1), alpha(p.amber, 0.35)),
      band('上漲區間', rows.map((r) => r.up2 - r.up1), alpha(p.up, 0.35)),
      { name: '中位路徑', type: 'line', data: rows.map((r) => r.median), symbolSize: 6, lineStyle: { color: p.amber, width: 2 }, itemStyle: { color: p.amber } },
      { name: '+1σ', type: 'line', data: rows.map((r) => r.up1), symbolSize: 5, lineStyle: { color: p.up, width: 1.2 }, itemStyle: { color: p.up } },
      { name: '−1σ', type: 'line', data: rows.map((r) => r.dn1), symbolSize: 5, lineStyle: { color: p.down, width: 1.2 }, itemStyle: { color: p.down } },
      { name: '+2σ', type: 'line', data: rows.map((r) => r.up2), symbolSize: 4, lineStyle: { color: p.blue, width: 1, type: 'dashed' }, itemStyle: { color: p.blue } },
      { name: '−2σ', type: 'line', data: rows.map((r) => r.dn2), symbolSize: 4, lineStyle: { color: p.blue, width: 1, type: 'dashed' }, itemStyle: { color: p.blue } },
    ],
  });
}

/* ---------- 07 成本結構 ---------- */
export function renderCost(a) {
  const p = palette();
  const c = a.costStructure;
  if (!c.available) { set('chart-cost', { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: '資料不足', fill: p.muted } }] }); return; }
  const colors = { deepTrapped: p.up, trapped: p.amber, cost: p.purple, profit: p.teal, deepProfit: p.down };
  const order = ['deepTrapped', 'trapped', 'cost', 'profit', 'deepProfit'];
  set('chart-cost', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(p), valueFormatter: (v) => `${fmt(v, 1)}%` },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 8, textStyle: { color: p.text2, fontSize: 10 } },
    grid: { left: 8, right: 8, top: 40, bottom: 20, containLabel: true },
    xAxis: { type: 'category', data: c.dates.map(shortDate), boundaryGap: false, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10 } },
    yAxis: { type: 'value', max: 100, ...baseAxis(p), axisLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10, formatter: '{value}%' } },
    series: order.map((k) => ({
      name: c.labels[k], type: 'line', stack: 'total', data: c.bands[k], showSymbol: false, smooth: 0.3,
      lineStyle: { width: 0.5, color: colors[k] }, areaStyle: { color: alpha(colors[k], 0.55) }, emphasis: { focus: 'series' },
    })),
  });
}

/* ---------- 08 法人 ---------- */
export function renderInst(a) {
  const p = palette();
  const t = a.institutional;
  if (!t.available) { set('chart-inst', { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: '暫無法人資料', fill: p.muted } }] }); return; }
  const n = Math.min(20, t.dates.length);
  const sl = (arr) => arr.slice(-n).map((v) => (v == null ? null : Math.round(v)));
  const dates = t.dates.slice(-n).map(shortDate);
  set('chart-inst', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltipStyle(p), valueFormatter: (v) => `${fmtSigned(v, 0)} 張` },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 8, textStyle: { color: p.text2, fontSize: 10 } },
    grid: { left: 8, right: 8, top: 28, bottom: 22, containLabel: true },
    xAxis: { type: 'category', data: dates, ...baseAxis(p), splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '張', nameTextStyle: { color: p.muted, fontSize: 10 }, ...baseAxis(p), axisLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10 } },
      { type: 'value', name: '累積', nameTextStyle: { color: p.muted, fontSize: 10 }, ...baseAxis(p), axisLine: { show: false }, splitLine: { show: false }, axisLabel: { color: p.muted, fontSize: 10 } },
    ],
    series: [
      { name: '外資', type: 'bar', data: sl(t.foreign), itemStyle: { color: p.blue, borderRadius: 2 }, barMaxWidth: 10 },
      { name: '投信', type: 'bar', data: sl(t.trust), itemStyle: { color: p.up, borderRadius: 2 }, barMaxWidth: 10 },
      { name: '自營商', type: 'bar', data: sl(t.dealer), itemStyle: { color: p.down, borderRadius: 2 }, barMaxWidth: 10 },
      { name: '合計(累積,右軸)', type: 'line', yAxisIndex: 1, data: sl(t.cumulative.map((v, i, arr) => v - (arr[arr.length - n - 1] ?? 0))), symbolSize: 5, lineStyle: { color: p.amber, width: 2 }, itemStyle: { color: p.amber } },
    ],
  });
}

/* ---------- 13 情緒儀表 ---------- */
export function renderGauge(a) {
  const p = palette();
  const v = a.sentiment.overall;
  set('chart-gauge', {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '105%', center: ['50%', '68%'],
      axisLine: { lineStyle: { width: 16, color: [[0.4, alpha(p.down, 0.85)], [0.6, alpha(p.amber, 0.85)], [1, alpha(p.up, 0.85)]] } },
      pointer: { length: '58%', width: 5, itemStyle: { color: p.text } },
      anchor: { show: true, size: 10, itemStyle: { color: p.text } },
      axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: true, distance: -30, color: p.muted, fontSize: 9, formatter: (x) => (x === 0 || x === 50 || x === 100 ? x : '') },
      detail: { valueAnimation: true, formatter: (x) => (v == null ? '—' : `${Math.round(x)}`), offsetCenter: [0, '20%'], color: p.text, fontSize: 24, fontWeight: 800 },
      title: { show: true, offsetCenter: [0, '58%'], color: p.muted, fontSize: 11, fontWeight: 700 },
      data: [{ value: v == null ? 0 : v, name: `市場情緒：${a.sentiment.label}` }],
    }],
  });
}

/* ---------- 15 迷你走勢 ---------- */
export function renderSpark(a) {
  const p = palette();
  const c = a.chipSummary;
  if (!c.available) { set('chart-spark', { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: '—', fill: p.muted } }] }); return; }
  set('chart-spark', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(p), formatter: (ps) => `${c.sparkDates[ps[0].dataIndex]}<br>20 日累積 <b>${fmtSigned(ps[0].value, 0)} 張</b>` },
    grid: { left: 4, right: 4, top: 6, bottom: 16 },
    xAxis: { type: 'category', data: c.sparkDates.map(shortDate), boundaryGap: false, axisLabel: { color: p.muted, fontSize: 9, interval: 18 }, axisLine: { lineStyle: { color: p.grid } }, axisTick: { show: false } },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{ type: 'line', data: c.spark.map((v) => Math.round(v)), symbolSize: 4, smooth: true, lineStyle: { color: p.blue, width: 2 }, itemStyle: { color: p.blue }, areaStyle: { color: alpha(p.blue, 0.15) }, markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0, lineStyle: { color: p.muted, type: 'dashed' }, label: { show: false } }] } }],
  });
}

/* ---------- 任務三 KD + MA ---------- */
export function renderKdma(a) {
  const p = palette();
  const s = a.series;
  const dates = s.dates.map(shortDate);
  const n = dates.length;
  const start = Math.max(0, 100 - (90 / n) * 100);
  set('chart-kdma', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle(p), valueFormatter: (v) => fmt(v) },
    legend: { top: 0, textStyle: { color: p.text2, fontSize: 11 }, data: ['收盤', 'MA5', 'MA20', 'MA60', 'K', 'D'] },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [{ left: 8, right: 60, top: 30, height: '50%' }, { left: 8, right: 60, top: '66%', height: '24%' }],
    xAxis: [
      { type: 'category', data: dates, ...baseAxis(p), splitLine: { show: false } },
      { type: 'category', gridIndex: 1, data: dates, ...baseAxis(p), splitLine: { show: false }, axisLabel: { show: false } },
    ],
    yAxis: [
      { scale: true, position: 'right', ...baseAxis(p), axisLine: { show: false } },
      { gridIndex: 1, min: 0, max: 100, position: 'right', ...baseAxis(p), axisLine: { show: false }, interval: 20 },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start, end: 100 }, { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 12, start, end: 100, borderColor: p.grid, fillerColor: alpha(p.blue, 0.15), textStyle: { color: p.muted, fontSize: 10 } }],
    series: [
      { name: '收盤', type: 'line', data: s.closes, showSymbol: false, lineStyle: { color: p.text, width: 1.6 } },
      { name: 'MA5', type: 'line', data: s.ma5, showSymbol: false, lineStyle: { color: p.purple, width: 1.2 } },
      { name: 'MA20', type: 'line', data: s.ma20, showSymbol: false, lineStyle: { color: p.amber, width: 1.4 } },
      { name: 'MA60', type: 'line', data: s.ma60, showSymbol: false, lineStyle: { color: p.gray, width: 1.2, type: 'dashed' } },
      { name: 'K', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: s.k, showSymbol: false, lineStyle: { color: p.blue, width: 1.5 },
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 80, lineStyle: { color: alpha(p.up, 0.6), type: 'dashed' }, label: { show: false } }, { yAxis: 20, lineStyle: { color: alpha(p.down, 0.6), type: 'dashed' }, label: { show: false } }] } },
      { name: 'D', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: s.d, showSymbol: false, lineStyle: { color: p.amber, width: 1.5 } },
    ],
  });
}

/* ---------- 任務四 MACD ---------- */
export function renderMacd(a) {
  const p = palette();
  const s = a.series;
  const dates = s.dates.map(shortDate);
  const n = dates.length;
  const start = Math.max(0, 100 - (90 / n) * 100);
  set('chart-macd', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle(p), valueFormatter: (v) => fmt(v) },
    legend: { top: 0, textStyle: { color: p.text2, fontSize: 11 }, data: ['收盤', 'DIF', 'MACD(DEA)', '柱狀'] },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [{ left: 8, right: 60, top: 30, height: '50%' }, { left: 8, right: 60, top: '66%', height: '24%' }],
    xAxis: [
      { type: 'category', data: dates, ...baseAxis(p), splitLine: { show: false } },
      { type: 'category', gridIndex: 1, data: dates, ...baseAxis(p), splitLine: { show: false }, axisLabel: { show: false } },
    ],
    yAxis: [
      { scale: true, position: 'right', ...baseAxis(p), axisLine: { show: false } },
      { gridIndex: 1, scale: true, position: 'right', ...baseAxis(p), axisLine: { show: false } },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start, end: 100 }, { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 12, start, end: 100, borderColor: p.grid, fillerColor: alpha(p.blue, 0.15), textStyle: { color: p.muted, fontSize: 10 } }],
    series: [
      { name: '收盤', type: 'line', data: s.closes, showSymbol: false, lineStyle: { color: p.text, width: 1.6 } },
      { name: '柱狀', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: s.hist.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? p.up : p.down } })), barMaxWidth: 6 },
      { name: 'DIF', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: s.dif, showSymbol: false, lineStyle: { color: p.blue, width: 1.5 } },
      { name: 'MACD(DEA)', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: s.dea, showSymbol: false, lineStyle: { color: p.amber, width: 1.5 } },
    ],
  });
}

export function renderMain(a) {
  renderKline(a); renderRadar(a); renderHeat(a); renderRisk(a); renderForecast(a); renderCost(a); renderInst(a); renderGauge(a); renderSpark(a);
}

export function renderTabChart(name, a) {
  if (name === 'kdma') renderKdma(a);
  if (name === 'macd') renderMacd(a);
}
