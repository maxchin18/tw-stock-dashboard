// 非圖表面板的 DOM 渲染
import { fmt, fmtInt, fmtSigned, fmtPct } from '/src/util/num.js';
import { PHASE_LABEL } from '/src/util/date.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const signCls = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat');
const isNum = (v) => v != null && Number.isFinite(v);

function setText(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  if (cls !== undefined) {
    el.classList.remove('pos', 'neg', 'flat', 'warn-c', 'blue-c');
    if (cls) el.classList.add(cls);
  }
}

function kv(rows) {
  return rows.map(([k, v, cls]) => `<dt>${esc(k)}</dt><dd class="${cls || ''}">${v}</dd>`).join('');
}

function scoreColor(score, invert = false) {
  if (!isNum(score)) return 'var(--gray)';
  const good = invert ? score < 35 : score >= 65;
  const bad = invert ? score >= 60 : score < 40;
  return good ? 'var(--down)' : bad ? 'var(--up)' : 'var(--amber)';
}

function bars(items, { color, showNote } = {}) {
  return items.map((it) => {
    const s = isNum(it.score) ? Math.max(0, Math.min(100, it.score)) : 0;
    const c = it.color || color || scoreColor(it.score, true);
    return `<li class="bar-item" title="${esc(it.rawLabel || it.note || '')}">
      <span class="bar-label">${esc(it.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${s}%;background:${c}"></span></span>
      <span class="bar-value">${isNum(it.score) ? `${Math.round(it.score)}%` : '—'}</span>
      ${showNote && (it.note || it.rawLabel) ? `<span class="bar-note">${esc(it.note || it.rawLabel)}</span>` : ''}
    </li>`;
  }).join('');
}

function rings(items) {
  return items.map((it) => {
    const s = isNum(it.score) ? Math.max(0, Math.min(100, it.score)) : 0;
    const c = it.color || scoreColor(it.score, it.invert);
    return `<div class="ring-item"><div class="ring" style="--p:${s};--c:${c}"><span>${isNum(it.score) ? `${Math.round(it.score)}%` : '—'}</span></div><div class="ring-label">${esc(it.name)}</div></div>`;
  }).join('');
}

/* ---------- 頂欄 / KPI ---------- */
export function renderHeader(a, ctx = {}) {
  const h = a.header;
  const d = a.decision;
  $('stock-name').textContent = h.name || '—';
  document.title = `${h.code} ${h.name} · 台股即時主力分析儀表板`;

  $('kpi-close-label').textContent = h.isLive ? `盤中價（${h.quoteTime || ''}）` : '今日收盤價';
  const closeEl = $('kpi-close');
  closeEl.textContent = fmt(h.close);
  closeEl.className = `k-value big ${signCls(h.change)}`;
  if (isNum(ctx.prevPrice) && isNum(h.close) && ctx.prevPrice !== h.close) {
    closeEl.classList.remove('flash-up', 'flash-down');
    void closeEl.offsetWidth;
    closeEl.classList.add(h.close > ctx.prevPrice ? 'flash-up' : 'flash-down');
  }
  setText('kpi-change', fmtSigned(h.change), signCls(h.change));
  setText('kpi-changepct', fmtPct(h.changePct), signCls(h.change));
  setText('kpi-volume', fmtInt(h.volume));
  $('kpi-volume').title = h.volumeLabel;
  setText('kpi-turnover', h.turnover == null ? (h.isLive ? '盤後公布' : '—') : fmtInt(h.turnover));
  setText('kpi-open', fmt(h.open));
  setText('kpi-high', fmt(h.high));
  setText('kpi-low', fmt(h.low));
  setText('kpi-date', h.date);
  setText('kpi-bars', `${h.bars} 日`);

  // 徽章
  const live = $('badge-live');
  live.classList.toggle('on', !!ctx.connected);
  live.querySelector('b').textContent = ctx.connected ? (ctx.phase === 'open' ? 'LIVE' : 'ACTIVE') : 'IDLE';
  $('badge-force').querySelector('b').textContent = d.mainForce;
  const vol = $('badge-vol');
  vol.querySelector('b').textContent = isNum(d.riskLevel) ? `第 ${d.riskLevel} 級 · 年化 ${fmt(d.annVol, 0)}%` : '—';
  vol.className = `badge ${d.riskLevel >= 4 ? 'danger' : d.riskLevel === 3 ? 'warn' : 'good'}`;
  renderIndexes(ctx.indexes || [], ctx.phase);

  const src = h.sources || {};
  $('sources').textContent = `資料來源：日K ${shortSrc(src.daily)} · 法人/融資券/當沖 FinMind · 即時報價 TWSE MIS`;
  $('range').textContent = `區間 ${h.rangeFrom} ～ ${h.rangeTo}，共 ${h.bars} 個交易日，法人資料 ${h.instDays} 日${h.isLive ? '（含今日盤中）' : ''}`;

  const errs = Object.entries(h.errors || {}).filter(([, v]) => v);
  const notice = $('notice');
  if (errs.length) {
    notice.hidden = false;
    notice.textContent = `部分資料暫時無法取得：${errs.map(([k, v]) => `${{ quote: '即時報價', institutional: '法人', margin: '融資券', dayTrading: '當沖', indexes: '大盤指數' }[k] || k}（${v}）`).join('；')}。相關面板會顯示「—」，不會以推估值取代。`;
  } else {
    notice.hidden = true;
  }
  $('engine-note').textContent = `分析引擎 v${a.engineVersion} · 計算時間 ${new Date(a.computedAt).toLocaleString('zh-TW', { hour12: false })}`;
}

function shortSrc(s) {
  if (!s) return '—';
  if (s.startsWith('TWSE')) return 'TWSE';
  if (s.startsWith('FinMind')) return 'TPEx（FinMind）';
  if (s.startsWith('TPEx')) return 'TPEx';
  return s;
}

export function renderIndexes(indexes, phase) {
  const el = $('badge-market');
  const tse = indexes.find((i) => i.market === 'tse');
  const label = PHASE_LABEL[phase] || '—';
  if (tse && isNum(tse.price)) {
    el.querySelector('b').textContent = `${label} · 加權 ${fmt(tse.price, 0)} (${fmtPct(tse.changePct, 2)})`;
    el.className = `badge ${tse.change > 0 ? 'up' : tse.change < 0 ? 'dn' : ''}`;
  } else {
    el.querySelector('b').textContent = label;
    el.className = 'badge';
  }
}

/* ---------- 面板 ---------- */
export function renderPanels(a) {
  const d = a.decision;
  const st = a.stats;

  // 02
  const wb = $('warn-banner');
  wb.textContent = { red: '⚠ 高風險警示', yellow: '◎ 觀望', green: '✓ 正常' }[d.light];
  wb.className = `warn-banner ${d.light}`;
  const trendCls = d.trendScore >= 4 ? 'pos' : d.trendScore <= 1 ? 'neg' : 'warn-c';
  $('decision-kv').innerHTML = kv([
    ['趨勢判斷', esc(d.trendLabel), trendCls],
    ['短線狀態', esc(d.shortState)],
    ['主力行為', esc(d.mainForce), d.r5 > 1 ? 'pos' : d.r5 < -1 ? 'neg' : ''],
    ['籌碼結構', esc(d.chipStructure)],
    ['隔日沖風險', isNum(d.nextDayRisk) ? `${Math.round(d.nextDayRisk)}%` : '—', d.nextDayRisk >= 60 ? 'pos' : ''],
    ['籌碼健康度', isNum(d.chipHealth) ? `${Math.round(d.chipHealth)} 分（${d.chipHealthLabel}）` : '—'],
    ['支撐區間', `${fmt(d.support.s1)} / ${fmt(d.support.s2)}`, 'blue-c'],
    ['壓力區間', `${fmt(d.resistance.r1)} / ${fmt(d.resistance.r2)}`, 'pos'],
    ['風險等級', isNum(d.riskLevel) ? `第 ${d.riskLevel} 級（1 低～5 高）` : '—', d.riskLevel >= 4 ? 'pos' : ''],
  ]);

  // 03
  $('radar-score').textContent = `綜合評分：${fmt(a.radar.total, 0)} / 100`;
  $('radar-foot').innerHTML = `<span>總評等級：<b class="blue-c">${a.radar.grade} 級</b></span><span>總分數：<b class="blue-c">${fmt(a.radar.total, 0)} / 100</b></span>`;

  // 04
  const hm = a.heatmap;
  const sw = (c) => `<i style="background:${c}"></i>`;
  $('heat-legend').innerHTML = hm.available ? [
    [sw('var(--up)'), '壓力區', hm.shares.resistance, '現價 +2% 以上'],
    [sw('var(--amber)'), '大量成交區', hm.shares.heavy, `POC ≈ ${fmt(hm.poc.price, 0)}`],
    [sw('var(--teal)'), '密集成交區', hm.shares.dense, '≥ POC 50% 的價位'],
    [sw('var(--purple)'), '價平區', hm.shares.near, '現價 ±2%'],
    [sw('var(--blue)'), '支撐區', hm.shares.support, '現價 −2% 以下'],
  ].map(([i, n, v, t]) => `<li title="${esc(t)}">${i}<span>${n}<b>${isNum(v) ? `${Math.round(v)}%` : '—'}</b></span></li>`).join('') : '<li>資料不足</li>';

  // 05
  const rr = a.riskRadar;
  $('risk-foot').innerHTML = `<span>主力風險指數：<b class="${rr.index >= 65 ? 'pos' : rr.index >= 50 ? 'warn-c' : 'neg'}">${rr.label}</b></span><span>主力風險指數：<b class="warn-c">${fmt(rr.index, 0)}%</b></span>`;

  // 06
  const f = a.forecast;
  $('forecast-foot').innerHTML = f.available
    ? `<span><span class="pos">■</span> 上漲機率 <b>${fmt(f.probUp, 0)}%</b>　<span class="warn-c">■</span> 震盪機率 <b>${fmt(f.probFlat, 0)}%</b>　<span class="neg">■</span> 下跌機率 <b>${fmt(f.probDown, 0)}%</b></span><span>主力方向機率：<b class="${f.probBull >= 50 ? 'pos' : 'neg'}">${f.probBull >= 50 ? '多頭' : '空頭'} ${fmt(f.probBull >= 50 ? f.probBull : 100 - f.probBull, 0)}%</b>　強弱指標：<b class="${f.drift >= 0 ? 'pos' : 'neg'}">${fmtPct(f.drift, 1)}（年化漂移）</b></span>`
    : '<span>報酬統計樣本不足（需至少 20 個交易日）</span>';

  // 07
  const cs = a.costStructure;
  $('cost-foot').innerHTML = cs.available
    ? `<span>主力平均成本：<b class="blue-c">${fmt(cs.mainCost)}</b>（20日VWAP）</span><span>強弱指標：<b class="${cs.strength >= 0 ? 'pos' : 'neg'}">${fmtPct(cs.strength, 1)}</b></span>`
    : '<span>資料不足</span>';

  // 08
  const t = a.institutional;
  if (t.available) {
    $('inst-table').innerHTML = `<thead><tr><th>日期</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th></tr></thead><tbody>${t.last3.map((r) => `<tr><td>${r.date.slice(5).replace('-', '/')}</td>${[r.foreign, r.trust, r.dealer, r.total].map((v) => `<td class="${signCls(v)}">${fmtSigned(v, 0)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('inst-note').textContent = `單位：張 · 近5日 外資 ${fmtSigned(t.foreign5, 0)} / 投信 ${fmtSigned(t.trust5, 0)} / 自營 ${fmtSigned(t.dealer5, 0)}`;
    $('inst-foot').innerHTML = `<span>累積買賣超：<b class="${t.net20 >= 0 ? 'pos' : 'neg'}">${t.label20}</b>（20日 ${fmtSigned(t.net20, 0)} 張）</span><span>近5日買賣超：<b class="${t.net5 >= 0 ? 'pos' : 'neg'}">${t.label5}</b>（${fmtSigned(t.net5, 0)} 張）</span>`;
  } else {
    $('inst-table').innerHTML = '';
    $('inst-note').textContent = '暫無法人資料';
    $('inst-foot').innerHTML = '';
  }

  // 09
  const nd = a.nextDay;
  $('nextday-bars').innerHTML = bars(nd.items);
  $('nextday-foot').innerHTML = `<span>隔日沖風險等級：<b class="${nd.level === '高' ? 'pos' : nd.level === '中' ? 'warn-c' : 'neg'}">${nd.level}</b></span><span>風險指數：<b class="warn-c">${fmt(nd.index, 0)}%</b></span>`;

  // 10
  const en = a.energy;
  $('energy-bars').innerHTML = bars([
    { name: '多方能量', score: en.bull, color: 'var(--up)', rawLabel: `紅K量 ${fmtInt(en.redVol)} 張` },
    { name: '空方能量', score: en.bear, color: 'var(--down)', rawLabel: `黑K量 ${fmtInt(en.blackVol)} 張` },
  ]);
  $('energy-foot').innerHTML = `<span>多空比：<b class="${en.ratio >= 1 ? 'pos' : 'neg'}">${isNum(en.ratio) ? `${fmt(en.ratio, 2)} 倍${en.ratio >= 1 ? '多' : '空'}` : '—'}</b></span><span class="muted tiny">（20日紅K量 / 黑K量）</span>`;

  // 11
  const hl = a.health;
  $('health-rings').innerHTML = rings(hl.items);
  $('health-foot').innerHTML = `<span>總評：<b class="${hl.overall >= 60 ? 'pos' : hl.overall >= 45 ? 'warn-c' : 'neg'}">${hl.label}</b>（平均 ${fmt(hl.overall, 0)} 分）</span>`;

  // 12
  const sg = a.signalLight;
  for (const lamp of $('traffic').querySelectorAll('.lamp')) lamp.classList.toggle('lit', lamp.classList.contains(sg.light));
  $('signal-kv').innerHTML = kv([
    ['趨勢', esc(sg.trend), sg.trend === '偏多' ? 'pos' : sg.trend === '偏空' ? 'neg' : ''],
    ['籌碼', esc(sg.chip)],
    ['動能', esc(sg.momentum), sg.momentum === '動能強' ? 'pos' : sg.momentum === '動能弱' ? 'neg' : ''],
    ['風險', esc(sg.risk), sg.risk.includes('高') ? 'pos' : ''],
    ['結論', esc(sg.text), sg.light === 'red' ? 'pos' : sg.light === 'green' ? 'neg' : 'warn-c'],
  ]);

  // 13
  const se = a.sentiment;
  $('sentiment-kv').innerHTML = kv([
    ['散戶情緒', isNum(se.retail) ? `${Math.round(se.retail)}%` : '—', se.retail >= 60 ? 'pos' : se.retail < 40 ? 'neg' : 'warn-c'],
    ['法人情緒', isNum(se.institutional) ? `${Math.round(se.institutional)}%` : '—', se.institutional >= 60 ? 'pos' : se.institutional < 40 ? 'neg' : 'warn-c'],
    ['主力情緒', isNum(se.mainForce) ? `${Math.round(se.mainForce)}%` : '—', se.mainForce >= 60 ? 'pos' : se.mainForce < 40 ? 'neg' : 'warn-c'],
  ]);

  // 14
  const cf = a.confidence;
  $('confidence-bars').innerHTML = bars([{ name: '綜合可信度', score: cf.confidence, note: '四項平均' }, ...cf.items], { color: 'var(--blue)', showNote: true });

  // 15
  const cp = a.chipSummary;
  $('chip-kv').innerHTML = cp.available ? kv([
    ['外資', `${fmtSigned(cp.foreign, 0)} 張`, signCls(cp.foreign)],
    ['投信', `${fmtSigned(cp.trust, 0)} 張`, signCls(cp.trust)],
    ['自營商', `${fmtSigned(cp.dealer, 0)} 張`, signCls(cp.dealer)],
    ['三大法人', `${fmtSigned(cp.total, 0)} 張`, signCls(cp.total)],
    ['資料日期', esc(cp.date), 'muted'],
  ]) : kv([['法人資料', '暫無']]);
  $('chip-foot').innerHTML = cp.available
    ? `<span>${esc(cp.shortTerm)}｜${esc(cp.chase)}</span><span>結論：<b class="${cp.conclusion === '偏多操作' ? 'pos' : cp.conclusion === '偏空觀望' ? 'neg' : 'warn-c'}">${esc(cp.conclusion)}</b></span>`
    : '';

  // 16
  const bp = a.buySellPower;
  $('bsp-rings').innerHTML = rings([
    { name: '大戶買盤', score: bp.bigBuy, color: 'var(--up)' },
    { name: '散戶買盤', score: bp.retailBuy, color: 'var(--amber)' },
    { name: '散戶賣壓', score: bp.retailSell, color: 'var(--down)' },
  ]);
  $('bsp-foot').innerHTML = `<span>資料時間：<b class="blue-c">${bp.date || '—'}</b></span><span class="muted">（法人買進 / 賣出佔成交量比例，近 ${bp.window || 20} 日平均）</span>`;

  // 17
  const sr = a.strength;
  $('strength-rings').innerHTML = rings([
    { name: '多方強度', score: sr.bull, color: 'var(--up)' },
    { name: '空方強度', score: sr.bear, color: 'var(--down)' },
    { name: '量能強度', score: sr.volume, color: 'var(--blue)' },
  ]);
  $('strength-foot').innerHTML = `<span>信號等級：<b class="blue-c">${sr.level != null ? `${sr.level} 級區` : '—'}</b></span><span class="muted">（1 級最強～5 級最弱，依綜合評分 ${fmt(a.radar.total, 0)}）</span>`;

  // 18
  const v = a.verdict;
  $('verdict-semantic').textContent = v.semantic;
  $('verdict-semantic').style.color = d.r5 > 1 ? 'var(--up)' : d.r5 < -1 ? 'var(--down)' : 'var(--amber)';
  $('verdict-tag').textContent = v.tag;
  $('verdict-text').textContent = `結論：${v.conclusion}`;
}

/* ---------- 分頁 ---------- */
export function renderTabs(a) {
  $('tab-report').innerHTML = `<div class="report">${a.report.sections.map((s) => `<h4>${esc(s.title)}</h4>${s.lines.map((l) => `<p>${esc(l)}</p>`).join('')}`).join('')}</div>`;
  $('tab-alerts').innerHTML = a.alerts.length
    ? `<ul class="alert-list">${a.alerts.map((al) => `<li class="alert-item"><span class="lvl ${al.level}">${al.level.toUpperCase()}</span><b>${esc(al.title)}</b><span class="muted">${esc(al.detail)}</span><span class="muted tiny" style="margin-left:auto">${al.date}</span></li>`).join('')}</ul>`
    : '<p class="muted">最新交易日沒有觸發任何技術警示。</p>';
  const cols = ['日期', '開盤', '最高', '最低', '收盤', '漲跌', '漲跌幅', '成交量(張)', '成交筆數', '外資', '投信', '自營商', '法人合計', '融資餘額', '融券餘額', '當沖(張)', '當沖比例'];
  $('tab-table').innerHTML = `<table class="data"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${a.table.map((r) => `<tr>
    <td>${r.date}${r.live ? ' <span class="pos tiny">盤中</span>' : ''}</td><td>${fmt(r.open)}</td><td>${fmt(r.high)}</td><td>${fmt(r.low)}</td><td><b>${fmt(r.close)}</b></td>
    <td class="${signCls(r.change)}">${fmtSigned(r.change)}</td><td class="${signCls(r.change)}">${fmtPct(r.changePct)}</td>
    <td>${fmtInt(r.volume)}</td><td>${fmtInt(r.turnover)}</td>
    <td class="${signCls(r.foreign)}">${fmtSigned(r.foreign, 0)}</td><td class="${signCls(r.trust)}">${fmtSigned(r.trust, 0)}</td><td class="${signCls(r.dealer)}">${fmtSigned(r.dealer, 0)}</td><td class="${signCls(r.total)}">${fmtSigned(r.total, 0)}</td>
    <td>${fmtInt(r.marginBalance)}</td><td>${fmtInt(r.shortBalance)}</td><td>${fmtInt(r.dayTradeVolume)}</td><td>${r.dayTradeRatio == null ? '—' : `${fmt(r.dayTradeRatio, 1)}%`}</td>
  </tr>`).join('')}</tbody></table>`;
}

export function tableToCsv(a) {
  const cols = ['date', 'open', 'high', 'low', 'close', 'change', 'changePct', 'volume', 'turnover', 'amount', 'foreign', 'trust', 'dealer', 'total', 'marginBalance', 'shortBalance', 'dayTradeVolume', 'dayTradeRatio'];
  const head = ['日期', '開盤', '最高', '最低', '收盤', '漲跌', '漲跌幅%', '成交量(張)', '成交筆數', '成交金額(元)', '外資(張)', '投信(張)', '自營商(張)', '法人合計(張)', '融資餘額(張)', '融券餘額(張)', '當沖(張)', '當沖比例%'];
  const lines = [head.join(',')];
  for (const r of a.table) lines.push(cols.map((c) => (r[c] == null ? '' : typeof r[c] === 'number' ? Math.round(r[c] * 1000) / 1000 : r[c])).join(','));
  return `﻿${lines.join('\r\n')}`;
}
