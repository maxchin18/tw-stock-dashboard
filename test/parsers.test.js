// 解析器測試：以 2026-09 實際抓到的交易所 / FinMind 回應片段為固定樣本，確認數值與單位換算正確
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStockDayRows, normalizeQuote } from '../src/sources/twse.js';
import { parseTradingStockRows } from '../src/sources/tpex.js';
import { normalizeInstitutional, normalizeMargin, normalizeDayTrading, normalizePrice } from '../src/sources/finmind.js';
import { num } from '../src/util/num.js';
import { rocToIso, compactToIso, monthStarts, monthsAgoIso, isoWeekKey } from '../src/util/date.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);

test('num：千分位 / 正負號 / 除權息記號 / 空值', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num('+205.00'), 205);
  assert.equal(num('-5.00'), -5);
  assert.equal(num('X0.00'), null);
  assert.equal(num('-'), null);
  assert.equal(num('--'), null);
  assert.equal(num(''), null);
  assert.equal(num(3), 3);
});

test('date utils', () => {
  assert.equal(rocToIso('115/09/18'), '2026-09-18');
  assert.equal(rocToIso('115/9/1'), '2026-09-01');
  assert.equal(compactToIso('20260921'), '2026-09-21');
  assert.deepEqual(monthStarts('2026-07-01', '2026-09-22'), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(monthsAgoIso('2026-03-15', 6), '2025-09-01');
  assert.equal(isoWeekKey('2026-09-21'), '2026-W39');
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
});

test('TWSE STOCK_DAY：2360 致茂 2026-09-18（對照交易所公布值）', () => {
  const rows = parseStockDayRows([
    ['115/09/17', '1,269,378', '2,679,239,835', '2,115.00', '2,160.00', '2,085.00', '2,085.00', '-5.00', '2,871', ''],
    ['115/09/18', '2,681,171', '6,012,557,180', '2,135.00', '2,290.00', '2,135.00', '2,290.00', '+205.00', '6,260', ''],
    ['115/09/19', '--', '--', '--', '--', '--', '--', 'X0.00', '0', ''],
  ]);
  assert.equal(rows.length, 2, '無成交日（--）應被略過');
  const r = rows[1];
  assert.equal(r.date, '2026-09-18');
  assert.equal(r.shares, 2681171);
  close(r.volume, 2681.171);
  assert.equal(r.amount, 6012557180);
  assert.equal(r.open, 2135);
  assert.equal(r.high, 2290);
  assert.equal(r.low, 2135);
  assert.equal(r.close, 2290);
  assert.equal(r.turnover, 6260);
});

test('TPEx tradingStock：成交張數 → 股、成交仟元 → 元', () => {
  const rows = parseTradingStockRows([
    ['115/09/21', '6,946', '6,510,995', '951.00', '954.00', '925.00', '931.00', '-13.00', '19,526'],
  ]);
  const r = rows[0];
  assert.equal(r.date, '2026-09-21');
  assert.equal(r.volume, 6946);
  assert.equal(r.shares, 6946000);
  assert.equal(r.amount, 6510995000);
  assert.deepEqual([r.open, r.high, r.low, r.close, r.turnover], [951, 954, 925, 931, 19526]);
});

test('FinMind 三大法人：2360 2026-09-18 與 TWSE T86 相符（外資 -166,234 / 投信 +88,874 / 自營 +82,438 / 合計 +5,078 股）', () => {
  const rows = normalizeInstitutional([
    { date: '2026-09-18', stock_id: '2360', buy: 0, name: 'Foreign_Dealer_Self', sell: 0 },
    { date: '2026-09-18', stock_id: '2360', buy: 45428, name: 'Dealer_self', sell: 11000 },
    { date: '2026-09-18', stock_id: '2360', buy: 95812, name: 'Dealer_Hedging', sell: 47802 },
    { date: '2026-09-18', stock_id: '2360', buy: 1376791, name: 'Foreign_Investor', sell: 1543025 },
    { date: '2026-09-18', stock_id: '2360', buy: 147874, name: 'Investment_Trust', sell: 59000 },
    { date: '2026-09-17', stock_id: '2360', buy: 689192, name: 'Foreign_Investor', sell: 618551 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-09-17', '應依日期由舊到新排序');
  const r = rows[1];
  close(r.foreign, -166.234);
  close(r.trust, 88.874);
  close(r.dealer, 82.438);
  close(r.total, 5.078);
  close(r.totalBuy, 1665.905);
  close(r.totalSell, 1660.827);
  assert.equal(Math.round(r.foreign), -166);
  assert.equal(Math.round(r.trust), 89);
  assert.equal(Math.round(r.dealer), 82);
  assert.equal(Math.round(r.total), 5);
});

test('FinMind 融資融券 / 當沖 / 日K 正規化', () => {
  const m = normalizeMargin([{ date: '2026-09-18', MarginPurchaseTodayBalance: 1423, MarginPurchaseYesterdayBalance: 1204, MarginPurchaseBuy: 341, MarginPurchaseSell: 121, MarginPurchaseCashRepayment: 1, MarginPurchaseLimit: 106311, ShortSaleTodayBalance: 23, ShortSaleYesterdayBalance: 12, ShortSaleSell: 11, ShortSaleBuy: 0, ShortSaleCashRepayment: 0, OffsetLoanAndShort: 4 }]);
  assert.equal(m[0].marginBalance, 1423);
  assert.equal(m[0].shortBalance, 23);
  assert.equal(m[0].offset, 4);
  const d = normalizeDayTrading([{ stock_id: '2360', date: '2026-09-18', Volume: 594000, BuyAmount: 1310990000, SellAmount: 1328215000 }]);
  assert.equal(d[0].dayTradeVolume, 594);
  const p = normalizePrice([{ date: '2026-09-18', stock_id: '2360', Trading_Volume: 2681171, Trading_money: 6012557180, open: 2135, max: 2290, min: 2135, close: 2290, spread: 205, Trading_turnover: 6260 }]);
  assert.equal(p[0].shares, 2681171);
  close(p[0].volume, 2681.171);
  assert.equal(p[0].high, 2290);
  assert.equal(p[0].turnover, 6260);
});

test('MIS 即時報價正規化：2360 2026-09-21 收盤後快照', () => {
  const q = normalizeQuote({
    '@': '2360.tw', tv: '224', ps: '223', pz: '2375.0000', y: '2290.0000', o: '2515.0000', h: '2515.0000', l: '2315.0000',
    a: '2380.0000_2385.0000_2390.0000_2395.0000_2400.0000_', b: '2375.0000_2370.0000_2365.0000_2360.0000_2355.0000_',
    f: '2_5_17_10_25_', g: '14_17_18_13_14_', c: '2360', d: '20260921', '%': '14:30:00', ch: '2360.tw', tlong: '1789972200000',
    u: '2515.0000', w: '2065.0000', ip: '0', n: '致茂', ex: 'tse', t: '13:30:00', v: '3666', z: '2375.0000', nf: '致茂電子股份有限公司',
  });
  assert.equal(q.key, 'tse_2360.tw');
  assert.equal(q.code, '2360');
  assert.equal(q.name, '致茂');
  assert.equal(q.market, 'tse');
  assert.equal(q.date, '2026-09-21');
  assert.equal(q.price, 2375);
  assert.equal(q.prevClose, 2290);
  assert.equal(q.change, 85);
  close(q.changePct, (85 / 2290) * 100);
  assert.equal(q.volume, 3666);
  assert.equal(q.limitUp, 2515);
  assert.equal(q.asks.length, 5);
  assert.deepEqual(q.bids[0], { price: 2375, volume: 14 });
  assert.equal(q.suspended, false);
});

test('MIS：z 為 "-" 時退回 pz，且缺少 ch 的空白回應會被略過', () => {
  const q = normalizeQuote({ z: '-', pz: '100.5000', y: '100.0000', c: '1234', ch: '1234.tw', ex: 'tse', d: '20260921', n: '測試' });
  assert.equal(q.price, 100.5);
  assert.equal(q.priceSource, 'pz');
  assert.equal(normalizeQuote({ z: '-', tv: '-', s: '-' }), null);
});
