// 臺灣證券交易所（TWSE）資料來源
//  - 即時報價：mis.twse.com.tw getStockInfo.jsp（上市/上櫃皆可查，需 Referer）
//  - 個股日成交資訊：www.twse.com.tw/exchangeReport/STOCK_DAY（每月一次呼叫）
//  - 上市公司基本資料 / 每日全部行情：openapi.twse.com.tw
import { fetchJson } from './http.js';
import { num } from '../util/num.js';
import { rocToIso, compactToIso, isoToCompact } from '../util/date.js';

const MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const TWSE_URL = 'https://www.twse.com.tw';
const OPENAPI_URL = 'https://openapi.twse.com.tw/v1';

const MIS_HEADERS = { Referer: 'https://mis.twse.com.tw/stock/index.jsp' };

/** 解析五檔 "2480.0000_2485.0000_..." 與量 "896_1588_..." */
function parseLevels(prices, vols) {
  if (!prices) return [];
  const ps = String(prices).split('_').filter(Boolean);
  const vs = String(vols || '').split('_').filter(Boolean);
  return ps.map((p, i) => ({ price: num(p), volume: num(vs[i]) })).filter((l) => l.price != null);
}

/**
 * 將 MIS 單筆 msgArray 元素正規化。
 * 欄位：z 最近成交價、y 昨收、o 開、h 高、l 低、v 累積成交量(張)、tv 最近一筆量、
 *       a/f 賣價/量、b/g 買價/量、u/w 漲停/跌停、d 日期、t 最近成交時間、% 資料時間、n 簡稱
 */
export function normalizeQuote(m) {
  if (!m || !m.ch) return null;
  const isIndex = m.it === 't' || /^(t00|o00)\./.test(m.ch);
  const zRaw = m.z;
  let price = num(zRaw);
  let priceSource = 'z';
  if (price == null && m.trade && num(m.trade.z) != null) { price = num(m.trade.z); priceSource = 'trade'; }
  if (price == null && num(m.pz) != null) { price = num(m.pz); priceSource = 'pz'; }
  const prevClose = num(m.y);
  const change = price != null && prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  return {
    ch: m.ch,
    key: `${m.ex}_${m.ch}`,
    code: m.c,
    name: m.n || '',
    fullName: m.nf || m.n || '',
    market: m.ex, // tse | otc
    isIndex,
    date: compactToIso(m.d),
    time: m.t || null,          // 最近成交時間
    dataTime: m['%'] || null,   // 資料時間
    ts: num(m.tlong),
    price,
    priceSource,                // z = 即時成交 / trade / pz = 最近已知成交價
    prevClose,
    open: num(m.o),
    high: num(m.h),
    low: num(m.l),
    volume: isIndex ? null : num(m.v),      // 張（盤中累積，不含盤後定價）
    lastVolume: isIndex ? null : num(m.tv),
    amountWan: isIndex ? num(m.m) : null,   // 指數的成交金額（萬）
    limitUp: num(m.u),
    limitDown: num(m.w),
    asks: parseLevels(m.a, m.f),
    bids: parseLevels(m.b, m.g),
    change,
    changePct,
    suspended: m.ip != null && m.ip !== '0',
  };
}

/** 抓多檔即時報價；chList 例：['tse_2330.tw', 'otc_6488.tw', 'tse_t00.tw'] */
export async function fetchQuotes(chList) {
  const url = `${MIS_URL}?ex_ch=${chList.join('|')}&json=1&delay=0&_=${Date.now()}`;
  const j = await fetchJson(url, { headers: MIS_HEADERS, minGapMs: 250, retries: 1, timeoutMs: 12000 });
  if (!j || !Array.isArray(j.msgArray)) throw new Error('MIS: unexpected response');
  return j.msgArray.map(normalizeQuote).filter(Boolean);
}

/**
 * 個股某月日成交資訊（TWSE 官方「個股日成交資訊」表）。
 * 回傳陣列（無資料時為 []），欄位單位：shares 股、amount 元、volume 張。
 */
export async function fetchStockDayMonth(code, monthIso) {
  const date = isoToCompact(monthIso);
  const url = `${TWSE_URL}/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(code)}&_=${Date.now()}`;
  const j = await fetchJson(url, { minGapMs: 400, timeoutMs: 20000 });
  if (!j || j.stat !== 'OK') {
    if (j && /沒有符合條件|查詢日期大於今日/.test(j.stat || '')) return [];
    throw new Error(`TWSE STOCK_DAY ${code} ${date}: ${j?.stat || 'unexpected'}`);
  }
  return parseStockDayRows(j.data || []);
}

/** 解析 STOCK_DAY 的 data 列（可供測試使用） */
export function parseStockDayRows(rows) {
  const out = [];
  for (const r of rows) {
    const date = rocToIso(r[0]);
    const close = num(r[6]);
    if (!date || close == null) continue; // "--" 表示當日無成交
    const shares = num(r[1]);
    out.push({
      date,
      shares,
      volume: shares != null ? shares / 1000 : null,
      amount: num(r[2]),
      open: num(r[3]),
      high: num(r[4]),
      low: num(r[5]),
      close,
      turnover: num(r[8]),
      note: (r[9] || '').trim() || null,
    });
  }
  return out;
}

/** 上市公司基本資料（不含 ETF） */
export async function fetchCompanyList() {
  const j = await fetchJson(`${OPENAPI_URL}/opendata/t187ap03_L`, { timeoutMs: 30000 });
  if (!Array.isArray(j)) throw new Error('TWSE t187ap03_L: unexpected');
  return j.map((r) => ({
    code: String(r['公司代號'] || '').trim(),
    name: String(r['公司簡稱'] || '').trim(),
    fullName: String(r['公司名稱'] || '').trim(),
    industry: String(r['產業別'] || '').trim(),
    market: 'tse',
  })).filter((r) => r.code);
}

/** 上市全部證券（含 ETF）最近交易日行情，用於代碼/名稱索引 */
export async function fetchAllListed() {
  const j = await fetchJson(`${OPENAPI_URL}/exchangeReport/STOCK_DAY_ALL`, { timeoutMs: 30000 });
  if (!Array.isArray(j)) throw new Error('TWSE STOCK_DAY_ALL: unexpected');
  return j.map((r) => ({
    code: String(r.Code || '').trim(),
    name: String(r.Name || '').trim(),
    market: 'tse',
  })).filter((r) => r.code);
}
