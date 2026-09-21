// 資料整合層：決定市場別、組合各來源、快取
import * as twse from './twse.js';
import * as tpex from './tpex.js';
import * as finmind from './finmind.js';
import { getOrFetch } from '../cache.js';
import { taipeiNow, monthStarts, monthsAgoIso } from '../util/date.js';

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;

/** 預設抓取幾個月的歷史（約 7 個月 ≈ 140 個交易日，足夠 MA60 與 60 日統計） */
export const HISTORY_MONTHS = Number(process.env.HISTORY_MONTHS || 7);

/* ---------- 證券索引（代碼 → 名稱 / 市場） ---------- */

async function buildIndex() {
  const results = await Promise.allSettled([
    twse.fetchAllListed(),
    tpex.fetchAllListed(),
    twse.fetchCompanyList(),
    tpex.fetchCompanyList(),
  ]);
  const map = new Map();
  const add = (list) => {
    for (const r of list) {
      if (!r.code) continue;
      const prev = map.get(r.code);
      map.set(r.code, { ...(prev || {}), ...r, name: r.name || prev?.name || '' });
    }
  };
  // 先放公司基本資料（有全名/產業），再用每日行情表補齊 ETF 等
  if (results[2].status === 'fulfilled') add(results[2].value);
  if (results[3].status === 'fulfilled') add(results[3].value);
  if (results[0].status === 'fulfilled') add(results[0].value.map((r) => ({ ...r, ...(map.get(r.code) || {}), market: 'tse' })));
  if (results[1].status === 'fulfilled') add(results[1].value.map((r) => ({ ...r, ...(map.get(r.code) || {}), market: 'otc' })));
  if (map.size === 0) {
    const err = results.find((r) => r.status === 'rejected');
    throw new Error(`無法建立證券索引：${err?.reason?.message || 'unknown'}`);
  }
  return [...map.values()];
}

export async function getSecurityIndex() {
  const { value } = await getOrFetch('index:securities:v2', DAY, buildIndex);
  return value;
}

export async function searchSecurities(q, limit = 10) {
  const query = String(q || '').trim().toUpperCase();
  if (!query) return [];
  const list = await getSecurityIndex();
  const scored = [];
  for (const s of list) {
    const code = s.code.toUpperCase();
    const name = s.name || '';
    let score = 0;
    if (code === query) score = 100;
    else if (code.startsWith(query)) score = 80 - (code.length - query.length);
    else if (name === query) score = 70;
    else if (name.includes(query)) score = 50 - name.indexOf(query);
    else if ((s.fullName || '').includes(query)) score = 30;
    if (score > 0) scored.push({ score, s });
  }
  scored.sort((a, b) => b.score - a.score || a.s.code.localeCompare(b.s.code));
  return scored.slice(0, limit).map(({ s }) => ({ code: s.code, name: s.name, market: s.market, industry: s.industry || null }));
}

/** 解析代碼 → { code, name, market }。索引找不到時用即時報價 API 同時試上市/上櫃。 */
export async function resolveStock(codeRaw) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{4,7}$/.test(code)) throw Object.assign(new Error('股票代碼格式不正確'), { status: 400 });
  let list = [];
  try { list = await getSecurityIndex(); } catch (e) { console.warn('[index]', e.message); }
  const hit = list.find((s) => s.code.toUpperCase() === code);
  if (hit) return { code: hit.code, name: hit.name, market: hit.market, industry: hit.industry || null };
  const quotes = await twse.fetchQuotes([`tse_${code}.tw`, `otc_${code}.tw`]);
  const q = quotes.find((x) => x.code && x.code.toUpperCase() === code && x.name);
  if (q) return { code: q.code, name: q.name, market: q.market, industry: null };
  throw Object.assign(new Error(`找不到代碼 ${code}（僅支援上市 / 上櫃證券）`), { status: 404 });
}

/* ---------- 即時報價 ---------- */

export async function getQuote(code, market) {
  const ch = `${market}_${code}.tw`;
  const { value, at } = await getOrFetch(`quote:${ch}`, 3000, async () => {
    const quotes = await twse.fetchQuotes([ch]);
    const q = quotes.find((x) => x.key === ch);
    if (!q) throw new Error(`即時報價查無 ${ch}`);
    return q;
  });
  return { ...value, fetchedAt: at };
}

export async function getMarketIndexes() {
  const { value, at } = await getOrFetch('quote:indexes', 5000, async () => twse.fetchQuotes(['tse_t00.tw', 'otc_o00.tw']));
  return { indexes: value, fetchedAt: at };
}

/* ---------- 歷史日K ---------- */

function dedupeSort(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.date, r);
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function withChanges(rows) {
  let prev = null;
  for (const r of rows) {
    r.change = prev ? r.close - prev.close : null;
    r.changePct = prev && prev.close ? ((r.close - prev.close) / prev.close) * 100 : null;
    prev = r;
  }
  return rows;
}

/**
 * 日K：
 *  - 上市：TWSE「個股日成交資訊」逐月抓取（與 FinMind 完全一致）
 *  - 上櫃：FinMind TaiwanStockPrice（與 TPEx「每日收盤行情」成交股數定義一致，含盤後）；
 *          失敗時改用 TPEx「個股日成交資訊」（僅一般交易時段成交張數）
 */
export async function loadDaily(code, market, todayIso = taipeiNow().iso) {
  const fromIso = monthsAgoIso(todayIso, HISTORY_MONTHS - 1);
  const currentMonth = todayIso.slice(0, 7);
  let rows = [];
  let source = '';
  if (market === 'tse') {
    for (const monthIso of monthStarts(fromIso, todayIso)) {
      const isCurrent = monthIso.slice(0, 7) === currentMonth;
      const key = `twse:stockday:${code}:${monthIso.slice(0, 7)}`;
      const { value } = await getOrFetch(key, isCurrent ? 5 * MIN : 30 * DAY, () => twse.fetchStockDayMonth(code, monthIso));
      rows.push(...value);
    }
    source = 'TWSE 個股日成交資訊';
    if (rows.length === 0) {
      const { value } = await getOrFetch(`finmind:price:${code}:${fromIso}`, 5 * MIN, () => finmind.fetchPrice(code, fromIso));
      rows = value; source = 'FinMind TaiwanStockPrice';
    }
  } else {
    try {
      const { value } = await getOrFetch(`finmind:price:${code}:${fromIso}`, 5 * MIN, () => finmind.fetchPrice(code, fromIso));
      rows = value; source = 'FinMind TaiwanStockPrice（TPEx 每日收盤行情）';
    } catch (e) {
      console.warn('[daily] FinMind failed, fallback to TPEx:', e.message);
    }
    if (rows.length === 0) {
      for (const monthIso of monthStarts(fromIso, todayIso)) {
        const isCurrent = monthIso.slice(0, 7) === currentMonth;
        const key = `tpex:tradingstock:${code}:${monthIso.slice(0, 7)}`;
        const { value } = await getOrFetch(key, isCurrent ? 5 * MIN : 30 * DAY, () => tpex.fetchTradingStockMonth(code, monthIso));
        rows.push(...value);
      }
      source = 'TPEx 個股日成交資訊（一般交易時段）';
    }
  }
  return { rows: withChanges(dedupeSort(rows)), source, fromIso };
}

/* ---------- 法人 / 融資券 / 當沖 ---------- */

export async function loadInstitutional(code, fromIso) {
  const { value, stale } = await getOrFetch(`finmind:inst:${code}:${fromIso}`, 10 * MIN, () => finmind.fetchInstitutional(code, fromIso));
  return { rows: value, source: 'FinMind TaiwanStockInstitutionalInvestorsBuySell（TWSE/TPEx 三大法人）', stale };
}

export async function loadMargin(code, fromIso) {
  const { value, stale } = await getOrFetch(`finmind:margin:${code}:${fromIso}`, 10 * MIN, () => finmind.fetchMargin(code, fromIso));
  return { rows: value, source: 'FinMind TaiwanStockMarginPurchaseShortSale（融資融券）', stale };
}

export async function loadDayTrading(code, fromIso) {
  const { value, stale } = await getOrFetch(`finmind:daytrade:${code}:${fromIso}`, 10 * MIN, () => finmind.fetchDayTrading(code, fromIso));
  return { rows: value, source: 'FinMind TaiwanStockDayTrading（當日沖銷）', stale };
}

/* ---------- 整包 ---------- */

export async function loadBundle(codeRaw) {
  const stock = await resolveStock(codeRaw);
  const todayIso = taipeiNow().iso;
  const fromIso = monthsAgoIso(todayIso, HISTORY_MONTHS - 1);
  const [daily, quote, inst, margin, dayTrade, indexes] = await Promise.all([
    loadDaily(stock.code, stock.market, todayIso),
    getQuote(stock.code, stock.market).catch((e) => ({ error: e.message })),
    loadInstitutional(stock.code, fromIso).catch((e) => ({ rows: [], error: e.message })),
    loadMargin(stock.code, fromIso).catch((e) => ({ rows: [], error: e.message })),
    loadDayTrading(stock.code, fromIso).catch((e) => ({ rows: [], error: e.message })),
    getMarketIndexes().catch((e) => ({ indexes: [], error: e.message })),
  ]);
  if (!daily.rows.length) throw Object.assign(new Error(`查無 ${stock.code} 的日成交資料`), { status: 404 });
  return {
    meta: {
      code: stock.code,
      name: stock.name || quote.name || '',
      market: stock.market,
      industry: stock.industry,
      fetchedAt: Date.now(),
      todayIso,
      sources: {
        daily: daily.source,
        quote: 'TWSE MIS 即時報價（mis.twse.com.tw）',
        institutional: inst.source || null,
        margin: margin.source || null,
        dayTrading: dayTrade.source || null,
      },
      errors: {
        quote: quote.error || null,
        institutional: inst.error || null,
        margin: margin.error || null,
        dayTrading: dayTrade.error || null,
        indexes: indexes.error || null,
      },
    },
    quote: quote.error ? null : quote,
    indexes: indexes.indexes || [],
    daily: daily.rows,
    institutional: inst.rows,
    margin: margin.rows,
    dayTrading: dayTrade.rows,
  };
}
