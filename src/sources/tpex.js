// 證券櫃檯買賣中心（TPEx）資料來源
//  - 個股日成交資訊：www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock（每月一次呼叫）
//  - 上櫃公司基本資料 / 每日收盤行情：www.tpex.org.tw/openapi/v1
import { fetchJson } from './http.js';
import { num } from '../util/num.js';
import { rocToIso } from '../util/date.js';

const TPEX_URL = 'https://www.tpex.org.tw';

/**
 * 上櫃個股某月日成交資訊。
 * 原始欄位：日期、成交張數、成交仟元、開盤、最高、最低、收盤、漲跌、筆數
 * 正規化單位：shares 股、amount 元、volume 張（與 TWSE 一致）
 */
export async function fetchTradingStockMonth(code, monthIso) {
  const [y, m] = monthIso.split('-');
  const url = `${TPEX_URL}/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${y}/${m}/01&response=json&_=${Date.now()}`;
  const j = await fetchJson(url, { minGapMs: 400, timeoutMs: 20000 });
  const table = j && Array.isArray(j.tables) ? j.tables[0] : null;
  if (!table) throw new Error(`TPEx tradingStock ${code} ${monthIso}: unexpected response`);
  return parseTradingStockRows(table.data || []);
}

export function parseTradingStockRows(rows) {
  const out = [];
  for (const r of rows) {
    const date = rocToIso(r[0]);
    const close = num(r[6]);
    if (!date || close == null) continue;
    const lots = num(r[1]);
    const thousands = num(r[2]);
    out.push({
      date,
      shares: lots != null ? lots * 1000 : null,
      volume: lots,
      amount: thousands != null ? thousands * 1000 : null,
      open: num(r[3]),
      high: num(r[4]),
      low: num(r[5]),
      close,
      turnover: num(r[8]),
      note: null,
    });
  }
  return out;
}

/** 上櫃公司基本資料（不含 ETF） */
export async function fetchCompanyList() {
  const j = await fetchJson(`${TPEX_URL}/openapi/v1/mopsfin_t187ap03_O`, { timeoutMs: 30000 });
  if (!Array.isArray(j)) throw new Error('TPEx mopsfin_t187ap03_O: unexpected');
  return j.map((r) => ({
    code: String(r.SecuritiesCompanyCode || '').trim(),
    name: String(r.CompanyAbbreviation || '').trim(),
    fullName: String(r.CompanyName || '').trim(),
    industry: String(r.SecuritiesIndustryCode || '').trim(),
    market: 'otc',
  })).filter((r) => r.code);
}

/** 上櫃全部證券（含 ETF）最近交易日行情，用於代碼/名稱索引 */
export async function fetchAllListed() {
  const j = await fetchJson(`${TPEX_URL}/openapi/v1/tpex_mainboard_daily_close_quotes`, { timeoutMs: 30000 });
  if (!Array.isArray(j)) throw new Error('TPEx daily_close_quotes: unexpected');
  return j.map((r) => ({
    code: String(r.SecuritiesCompanyCode || '').trim(),
    name: String(r.CompanyName || '').trim(),
    market: 'otc',
  })).filter((r) => r.code);
}
