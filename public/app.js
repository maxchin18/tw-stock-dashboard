// 前端主程式：載入資料、即時更新（SSE）、主題、下載
import { analyze } from '/src/analysis/engine.js';
import { marketPhase } from '/src/util/date.js';
import * as charts from '/charts.js';
import * as panels from '/panels.js';

const $ = (id) => document.getElementById(id);
const state = {
  code: null, bundle: null, analysis: null, es: null, connected: false, phase: marketPhase(), indexes: [],
  prevPrice: null, refreshTimer: null, activeTab: 'report', lastRecompute: 0, pendingRecompute: null,
};

/* ---------- 小工具 ---------- */
let toastTimer = null;
function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(path) {
  const res = await fetch(path, { cache: 'no-store' });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

function download(filename, blobOrUrl) {
  const a = document.createElement('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const stamp = () => `${state.code}-${state.analysis?.header.date || ''}`;

/* ---------- 主題 ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('twsd-theme', theme); } catch { /* ignore */ }
  $('theme-toggle').textContent = theme === 'dark' ? '☀' : '◐';
  if (state.analysis) { charts.disposeAll(); renderAll(); }
}
function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem('twsd-theme'); } catch { /* ignore */ }
  if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(theme);
}

/* ---------- 渲染 ---------- */
function renderAll() {
  const a = state.analysis;
  if (!a) return;
  panels.renderHeader(a, { prevPrice: state.prevPrice, connected: state.connected, phase: state.phase, indexes: state.indexes });
  charts.renderMain(a);
  panels.renderPanels(a);
  panels.renderTabs(a);
  if (state.activeTab === 'kdma' || state.activeTab === 'macd') charts.renderTabChart(state.activeTab, a);
  state.prevPrice = a.header.close;
}

function recompute() {
  try {
    state.analysis = analyze(state.bundle);
    renderAll();
  } catch (err) {
    console.error(err);
    toast(`分析失敗：${err.message}`, 'err');
  }
}

function recomputeThrottled() {
  const now = Date.now();
  const gap = 1200 - (now - state.lastRecompute);
  clearTimeout(state.pendingRecompute);
  if (gap <= 0) { state.lastRecompute = now; recompute(); return; }
  state.pendingRecompute = setTimeout(() => { state.lastRecompute = Date.now(); recompute(); }, gap);
}

/* ---------- 載入 ---------- */
async function loadStock(codeRaw, { silent = false } = {}) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return;
  document.body.classList.add('loading');
  if (!silent) toast(`載入 ${code} 資料中…`);
  try {
    const bundle = await api(`/api/bundle?code=${encodeURIComponent(code)}`);
    const changed = state.code !== bundle.meta.code;
    state.code = bundle.meta.code;
    state.bundle = bundle;
    state.phase = bundle.phase || marketPhase();
    if (bundle.indexes?.length) state.indexes = bundle.indexes;
    if (changed) state.prevPrice = null;
    $('code-input').value = state.code;
    try { localStorage.setItem('twsd-code', state.code); } catch { /* ignore */ }
    const url = new URL(location.href);
    url.searchParams.set('code', state.code);
    history.replaceState(null, '', url);
    recompute();
    if ((changed || !state.es) && !state.noStream) openStream(state.code);
    scheduleRefresh();
    if (!silent) toast(`${state.code} ${bundle.meta.name} 已更新`, 'ok');
  } catch (err) {
    console.error(err);
    toast(err.message || '載入失敗', 'err');
  } finally {
    document.body.classList.remove('loading');
  }
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  const ph = marketPhase();
  const ms = ph === 'closed' ? 30 * 60 * 1000 : 5 * 60 * 1000;
  state.refreshTimer = setTimeout(() => loadStock(state.code, { silent: true }), ms);
}

/* ---------- SSE 即時 ---------- */
function openStream(code) {
  if (state.es) { state.es.close(); state.es = null; }
  if (typeof EventSource === 'undefined') return;
  const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
  state.es = es;
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    state.connected = true;
    state.phase = d.phase;
    if (state.analysis) panels.renderHeader(state.analysis, { prevPrice: state.prevPrice, connected: true, phase: state.phase, indexes: state.indexes });
  });
  es.addEventListener('quote', (e) => {
    const d = JSON.parse(e.data);
    if (!state.bundle || d.quote.code !== state.code) return;
    state.bundle.quote = d.quote;
    state.phase = d.phase;
    state.connected = true;
    recomputeThrottled();
  });
  es.addEventListener('tick', (e) => {
    const d = JSON.parse(e.data);
    if (d.phase !== state.phase) { state.phase = d.phase; panels.renderIndexes(state.indexes, state.phase); }
  });
  es.addEventListener('indexes', (e) => {
    const d = JSON.parse(e.data);
    state.indexes = d.indexes || [];
    panels.renderIndexes(state.indexes, state.phase);
  });
  es.addEventListener('error', (e) => {
    if (e.data) { try { console.warn('[stream]', JSON.parse(e.data).message); } catch { /* ignore */ } }
  });
  es.onerror = () => {
    state.connected = false;
    $('badge-live').classList.remove('on');
    $('badge-live').querySelector('b').textContent = 'RECONNECT';
  };
}

/* ---------- 搜尋建議 ---------- */
let suggestTimer = null;
let suggestItems = [];
async function updateSuggest(q) {
  const box = $('suggest');
  if (!q) { box.hidden = true; return; }
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    suggestItems = results;
    if (!results.length) { box.hidden = true; return; }
    box.innerHTML = results.map((r) => `<li data-code="${r.code}"><span class="s-code">${r.code}</span><span class="s-name">${r.name}</span><span class="s-mkt">${r.market === 'otc' ? '上櫃' : '上市'}</span></li>`).join('');
    box.hidden = false;
  } catch { box.hidden = true; }
}

/* ---------- 下載 ---------- */
async function capture(el, filename) {
  if (typeof window.html2canvas === 'undefined') { toast('截圖函式庫尚未載入（需要網路）', 'err'); return; }
  document.body.classList.add('capturing');
  try {
    const p = charts.palette();
    const canvas = await window.html2canvas(el, { backgroundColor: p.bg, scale: 2, useCORS: true, logging: false });
    download(filename, canvas.toDataURL('image/png'));
  } catch (err) {
    toast(`截圖失敗：${err.message}`, 'err');
  } finally {
    document.body.classList.remove('capturing');
  }
}

async function downloadAllCharts() {
  const urls = charts.dataUrls();
  if (!urls.length) { toast('沒有可下載的圖表', 'err'); return; }
  for (const { id, url } of urls) {
    download(`${id}-${stamp()}.png`, url);
    await new Promise((r) => setTimeout(r, 350));
  }
  toast(`已下載 ${urls.length} 張圖表`, 'ok');
}

async function downloadOfflineHtml() {
  const a = state.analysis;
  if (!a) return;
  const root = $('capture-root').cloneNode(true);
  const urls = new Map(charts.dataUrls().map((x) => [x.id, x.url]));
  for (const el of root.querySelectorAll('.chart')) {
    const url = urls.get(el.id);
    el.innerHTML = url ? `<img src="${url}" style="width:100%;height:100%;object-fit:contain" alt="${el.id}">` : '<div class="muted tiny">（此圖表需開啟分頁後才會產生）</div>';
    el.removeAttribute('_echarts_instance_');
  }
  for (const el of root.querySelectorAll('.actions, .search, .theme-toggle, .panel-head .dl, .suggest')) el.remove();
  for (const pane of root.querySelectorAll('.tab-pane')) pane.classList.add('active');
  for (const tab of root.querySelectorAll('.tab')) tab.remove();
  let css = '';
  try { css = await (await fetch('/styles.css')).text(); } catch { /* ignore */ }
  const html = `<!DOCTYPE html><html lang="zh-Hant" data-theme="${document.documentElement.dataset.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${a.header.code} ${a.header.name} 離線報告 ${a.header.date}</title><style>${css}\n.tab-pane{display:block!important;page-break-before:auto}.chart img{display:block}</style></head><body class="capturing">${root.outerHTML}<p class="foot-note">離線報告產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}　（靜態快照，不含即時更新）</p></body></html>`;
  download(`report-${stamp()}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
}

/* ---------- 事件 ---------- */
function bindEvents() {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('code-input').value.trim();
    $('suggest').hidden = true;
    if (!raw) return;
    const isCode = /^[0-9A-Za-z]{4,7}$/.test(raw);
    if (!isCode && suggestItems.length) loadStock(suggestItems[0].code);
    else loadStock(raw);
  });
  $('code-input').addEventListener('input', (e) => {
    clearTimeout(suggestTimer);
    const q = e.target.value.trim();
    suggestTimer = setTimeout(() => updateSuggest(q), 220);
  });
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('suggest').hidden = true; });
  $('suggest').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-code]');
    if (!li) return;
    e.preventDefault();
    $('suggest').hidden = true;
    $('code-input').value = li.dataset.code;
    loadStock(li.dataset.code);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('suggest').hidden = true; });

  $('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const name = btn.dataset.tab;
    state.activeTab = name;
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    if ((name === 'kdma' || name === 'macd') && state.analysis) { charts.renderTabChart(name, state.analysis); charts.resizeAll(); }
  }));

  $('dashboard').addEventListener('click', (e) => {
    const btn = e.target.closest('button.dl');
    if (!btn) return;
    const panel = $(btn.dataset.dl);
    if (panel) capture(panel, `${btn.dataset.dl}-${stamp()}.png`);
  });
  $('dl-dashboard').addEventListener('click', () => capture($('capture-root'), `dashboard-${stamp()}.png`));
  $('dl-charts').addEventListener('click', downloadAllCharts);
  $('dl-csv').addEventListener('click', () => {
    if (!state.analysis) return;
    download(`data-${stamp()}.csv`, new Blob([panels.tableToCsv(state.analysis)], { type: 'text/csv;charset=utf-8' }));
  });
  $('dl-html').addEventListener('click', downloadOfflineHtml);
  $('print-btn').addEventListener('click', () => window.print());

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => charts.resizeAll(), 120); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.code) loadStock(state.code, { silent: true }); });
}

/* ---------- 啟動 ---------- */
function boot() {
  initTheme();
  bindEvents();
  if (!charts.hasEcharts()) {
    const n = $('notice');
    n.hidden = false;
    n.textContent = '圖表函式庫（ECharts）載入失敗，請確認可連線至 cdn.jsdelivr.net 後重新整理。數值面板仍可正常顯示。';
  }
  const params = new URLSearchParams(location.search);
  state.noStream = params.has('nostream'); // 靜態截圖 / 測試用：不開啟 SSE
  let code = params.get('code');
  if (!code) { try { code = localStorage.getItem('twsd-code'); } catch { /* ignore */ } }
  loadStock(code || '2330');
}

boot();
