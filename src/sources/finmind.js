// FinMind 開放資料（三大法人買賣超、融資融券、當日沖銷、日K 備援）
// 無 token 亦可使用，但有流量上限；可設定環境變數 FINMIND_TOKEN 提高額度。
import { fetchJson } from './http.js';
import { num } from '../util/num.js';

const BASE = 'https://api.finmindtrade.com/api/v4/data';

export async function fetchDataset(dataset, code, startIso, endIso) {
  const u = new URL(BASE);
  u.searchParams.set('dataset', dataset);
  u.searchParams.set('data_id', code);
  u.searchParams.set('start_date', startIso);
  if (endIso) u.searchParams.set('end_date', endIso);
  const headers = {};
  if (process.env.FINMIND_TOKEN) headers.Authorization = `Bearer ${process.env.FINMIND_TOKEN}`;
  const j = await fetchJson(u.toString(), { headers, minGapMs: 250, timeoutMs: 30000 });
  if (!j || j.status !== 200 || !Array.isArray(j.data)) {
    throw new Error(`FinMind ${dataset} ${code}: ${j?.msg || 'unexpected response'}`);
  }
  return j.data;
}

/**
 * 三大法人買賣超 → 依日期彙整，單位「張」（原始為股，÷1000，保留小數）。
 * 外資 = 外陸資(不含外資自營商) + 外資自營商；自營商 = 自行買賣 + 避險；合計 = 三者相加。
 */
export function normalizeInstitutional(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = r.date;
    if (!map.has(d)) {
      map.set(d, {
        date: d,
        foreignBuy: 0, foreignSell: 0,
        trustBuy: 0, trustSell: 0,
        dealerSelfBuy: 0, dealerSelfSell: 0,
        dealerHedgeBuy: 0, dealerHedgeSell: 0,
      });
    }
    const g = map.get(d);
    const buy = (num(r.buy) || 0) / 1000;
    const sell = (num(r.sell) || 0) / 1000;
    switch (r.name) {
      case 'Foreign_Investor':
      case 'Foreign_Dealer_Self':
        g.foreignBuy += buy; g.foreignSell += sell; break;
      case 'Investment_Trust':
        g.trustBuy += buy; g.trustSell += sell; break;
      case 'Dealer_self':
        g.dealerSelfBuy += buy; g.dealerSelfSell += sell; break;
      case 'Dealer_Hedging':
        g.dealerHedgeBuy += buy; g.dealerHedgeSell += sell; break;
      default:
        break;
    }
  }
  return [...map.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((g) => {
      const dealerBuy = g.dealerSelfBuy + g.dealerHedgeBuy;
      const dealerSell = g.dealerSelfSell + g.dealerHedgeSell;
      const foreign = g.foreignBuy - g.foreignSell;
      const trust = g.trustBuy - g.trustSell;
      const dealer = dealerBuy - dealerSell;
      return {
        ...g,
        dealerBuy,
        dealerSell,
        foreign,
        trust,
        dealer,
        total: foreign + trust + dealer,
        totalBuy: g.foreignBuy + g.trustBuy + dealerBuy,
        totalSell: g.foreignSell + g.trustSell + dealerSell,
      };
    });
}

export async function fetchInstitutional(code, startIso, endIso) {
  return normalizeInstitutional(await fetchDataset('TaiwanStockInstitutionalInvestorsBuySell', code, startIso, endIso));
}

/** 融資融券（單位：張） */
export function normalizeMargin(rows) {
  return rows
    .map((r) => ({
      date: r.date,
      marginBalance: num(r.MarginPurchaseTodayBalance),
      marginPrev: num(r.MarginPurchaseYesterdayBalance),
      marginBuy: num(r.MarginPurchaseBuy),
      marginSell: num(r.MarginPurchaseSell),
      marginRepay: num(r.MarginPurchaseCashRepayment),
      marginLimit: num(r.MarginPurchaseLimit),
      shortBalance: num(r.ShortSaleTodayBalance),
      shortPrev: num(r.ShortSaleYesterdayBalance),
      shortSell: num(r.ShortSaleSell),
      shortBuy: num(r.ShortSaleBuy),
      shortRepay: num(r.ShortSaleCashRepayment),
      offset: num(r.OffsetLoanAndShort),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchMargin(code, startIso, endIso) {
  return normalizeMargin(await fetchDataset('TaiwanStockMarginPurchaseShortSale', code, startIso, endIso));
}

/** 當日沖銷（Volume 為股 → 張） */
export function normalizeDayTrading(rows) {
  return rows
    .map((r) => ({
      date: r.date,
      dayTradeVolume: num(r.Volume) != null ? num(r.Volume) / 1000 : null,
      buyAmount: num(r.BuyAmount),
      sellAmount: num(r.SellAmount),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchDayTrading(code, startIso, endIso) {
  return normalizeDayTrading(await fetchDataset('TaiwanStockDayTrading', code, startIso, endIso));
}

/** 日K 備援（單位與 TWSE 正規化一致） */
export function normalizePrice(rows) {
  return rows
    .map((r) => {
      const shares = num(r.Trading_Volume);
      return {
        date: r.date,
        shares,
        volume: shares != null ? shares / 1000 : null,
        amount: num(r.Trading_money),
        open: num(r.open),
        high: num(r.max),
        low: num(r.min),
        close: num(r.close),
        turnover: num(r.Trading_turnover),
        note: null,
      };
    })
    .filter((r) => r.close != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchPrice(code, startIso, endIso) {
  return normalizePrice(await fetchDataset('TaiwanStockPrice', code, startIso, endIso));
}
