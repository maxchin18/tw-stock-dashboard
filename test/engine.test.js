import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, mergeLiveBar } from '../src/analysis/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isNum = (v) => v != null && Number.isFinite(v);
const inRange = (v, lo = 0, hi = 100) => v == null || (isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9);
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);

/** 可重現的隨機漫步樣本 */
function synthBundle({ bars = 140, seed = 7, withInst = true } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const daily = [];
  const institutional = [];
  const margin = [];
  const dayTrading = [];
  let price = 100;
  const d0 = new Date('2026-03-02T00:00:00Z');
  let day = 0;
  while (daily.length < bars) {
    const dt = new Date(d0.getTime() + day * 86400000);
    day++;
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    const date = dt.toISOString().slice(0, 10);
    const open = price * (1 + (rnd() - 0.5) * 0.02);
    const c = open * (1 + (rnd() - 0.48) * 0.04);
    const high = Math.max(open, c) * (1 + rnd() * 0.01);
    const low = Math.min(open, c) * (1 - rnd() * 0.01);
    const shares = Math.round(1e6 + rnd() * 3e6);
    daily.push({ date, open, high, low, close: c, shares, volume: shares / 1000, amount: shares * (open + c) / 2, turnover: Math.round(shares / 400) });
    price = c;
    if (withInst) {
      const fb = rnd() * 800; const fsl = rnd() * 800; const tb = rnd() * 100; const tsl = rnd() * 100; const db = rnd() * 100; const dsl = rnd() * 100;
      institutional.push({ date, foreignBuy: fb, foreignSell: fsl, trustBuy: tb, trustSell: tsl, dealerBuy: db, dealerSell: dsl, foreign: fb - fsl, trust: tb - tsl, dealer: db - dsl, total: fb - fsl + tb - tsl + db - dsl, totalBuy: fb + tb + db, totalSell: fsl + tsl + dsl });
      margin.push({ date, marginBalance: 5000 + Math.round(rnd() * 500), shortBalance: 100 + Math.round(rnd() * 50) });
      dayTrading.push({ date, dayTradeVolume: shares / 1000 * rnd() * 0.5 });
    }
  }
  let prev = null;
  for (const b of daily) { b.change = prev ? b.close - prev.close : null; b.changePct = prev ? ((b.close - prev.close) / prev.close) * 100 : null; prev = b; }
  return { meta: { code: 'TEST', name: '測試', market: 'tse', sources: {}, errors: {} }, quote: null, daily, institutional, margin, dayTrading };
}

test('analyze：合成資料所有評分皆在 0–100 且無 NaN', () => {
  const a = analyze(synthBundle());
  assert.equal(a.header.bars, 140);
  for (const ax of a.radar.axes) assert.ok(inRange(ax.score), `${ax.name} ${ax.score}`);
  assert.ok(inRange(a.radar.total));
  for (const ax of a.riskRadar.axes) assert.ok(inRange(ax.score), `${ax.name} ${ax.score}`);
  for (const it of a.nextDay.items) assert.ok(inRange(it.score), `${it.name} ${it.score}`);
  for (const it of a.health.items) assert.ok(inRange(it.score), `${it.name} ${it.score}`);
  for (const it of a.confidence.items) assert.ok(inRange(it.score), `${it.name} ${it.score}`);
  assert.ok(inRange(a.decision.chipHealth));
  assert.ok(inRange(a.decision.nextDayRisk));
  assert.ok(inRange(a.sentiment.overall));
  assert.ok(inRange(a.energy.bull));
  close(a.energy.bull + a.energy.bear, 100);
  assert.ok(inRange(a.buySellPower.bigBuy));
  close(a.buySellPower.bigBuy + a.buySellPower.retailBuy, 100);
  assert.ok([1, 2, 3, 4, 5].includes(a.decision.riskLevel));
  assert.ok(['A', 'B', 'C', 'D', 'E'].includes(a.radar.grade));
  assert.ok(['red', 'yellow', 'green'].includes(a.signalLight.light));
  const json = JSON.stringify(a);
  assert.ok(!/NaN|Infinity/.test(json), '輸出不應含 NaN / Infinity');
});

test('analyze：熱區圖占比合計 100%、成本結構每日合計 100%、推估機率合計 100%', () => {
  const a = analyze(synthBundle());
  const h = a.heatmap;
  assert.ok(h.available);
  close(h.shares.resistance + h.shares.near + h.shares.support, 100, 1e-6);
  close(h.profile.reduce((x, y) => x + y, 0), 100, 0.05);
  const c = a.costStructure;
  for (let i = 0; i < c.dates.length; i++) {
    const tot = Object.values(c.bands).reduce((x, arr) => x + arr[i], 0);
    close(tot, 100, 0.05);
  }
  close(a.forecast.probUp + a.forecast.probFlat + a.forecast.probDown, 100, 1e-6);
  assert.equal(a.forecast.horizons.length, 10);
  assert.ok(a.forecast.horizons[9].up2 > a.forecast.horizons[9].up1 && a.forecast.horizons[9].up1 > a.forecast.horizons[9].dn1);
});

test('analyze：支撐 / 壓力 = 20 日與 60 日最低 / 最高', () => {
  const b = synthBundle();
  const a = analyze(b);
  const lows = b.daily.map((x) => x.low);
  const highs = b.daily.map((x) => x.high);
  close(a.decision.support.s1, Math.min(...lows.slice(-20)));
  close(a.decision.support.s2, Math.min(...lows.slice(-60)));
  close(a.decision.resistance.r1, Math.max(...highs.slice(-20)));
  close(a.decision.resistance.r2, Math.max(...highs.slice(-60)));
});

test('analyze：沒有法人 / 融資券 / 當沖資料時不會拋錯，並標示不可用', () => {
  const a = analyze(synthBundle({ withInst: false }));
  assert.equal(a.institutional.available, false);
  assert.equal(a.chipSummary.available, false);
  assert.equal(a.decision.mainForce, '無法人資料');
  assert.equal(a.buySellPower.bigBuy, null);
  assert.equal(a.stats.dayTradeRatio, null);
});

test('analyze：資料太少時拋出明確錯誤', () => {
  assert.throws(() => analyze(synthBundle({ bars: 3 })), /日K資料不足/);
});

test('mergeLiveBar：報價日期較新才加入盤中K棒；同日或較舊則忽略', () => {
  const b = synthBundle({ bars: 30 });
  const last = b.daily[b.daily.length - 1];
  const q = { date: '2099-01-01', price: last.close * 1.03, open: last.close, high: last.close * 1.04, low: last.close * 0.99, volume: 1234, prevClose: last.close };
  const { bars, live } = mergeLiveBar(b.daily, q);
  assert.ok(live);
  assert.equal(bars.length, 31);
  close(live.close, last.close * 1.03);
  close(live.change, last.close * 0.03);
  assert.equal(live.volume, 1234);
  assert.equal(live.shares, 1234000);
  assert.equal(live.amountEstimated, true);
  assert.equal(mergeLiveBar(b.daily, { ...q, date: last.date }).live, null);
  assert.equal(mergeLiveBar(b.daily, { ...q, date: '2000-01-01' }).live, null);
  assert.equal(mergeLiveBar(b.daily, { ...q, price: null }).live, null);
});

test('analyze：盤中報價會成為 header（isLive、盤中價、以昨收計算漲跌）', () => {
  const b = synthBundle({ bars: 80 });
  const last = b.daily[b.daily.length - 1];
  b.quote = { date: '2099-01-01', price: 123.45, open: 120, high: 125, low: 119, volume: 500, prevClose: last.close, time: '10:00:00', limitUp: 130, limitDown: 110, asks: [], bids: [] };
  const a = analyze(b);
  assert.equal(a.header.isLive, true);
  assert.equal(a.header.close, 123.45);
  close(a.header.change, 123.45 - last.close);
  assert.equal(a.header.volume, 500);
  assert.equal(a.header.turnover, null);
  assert.equal(a.header.bars, 81);
  assert.equal(a.table[0].live, true);
});

test('analyze：真實樣本 2360 致茂（2026-09-21）header 與交易所公布值一致', () => {
  const file = path.join(__dirname, 'fixtures', 'bundle-2360.json');
  if (!fs.existsSync(file)) { console.log('（略過：缺少 fixtures/bundle-2360.json）'); return; }
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.quote = null; // 只驗證官方日成交
  const a = analyze(b);
  const bar0921 = b.daily.find((r) => r.date === '2026-09-21');
  const bar0918 = b.daily.find((r) => r.date === '2026-09-18');
  if (bar0918) {
    assert.equal(bar0918.close, 2290);
    assert.equal(bar0918.open, 2135);
    assert.equal(bar0918.high, 2290);
    assert.equal(bar0918.low, 2135);
    assert.equal(bar0918.shares, 2681171);
    assert.equal(bar0918.turnover, 6260);
    close(bar0918.change, 205);
    close(bar0918.changePct, (205 / 2085) * 100);
  }
  if (bar0921) {
    assert.equal(bar0921.close, 2375);
    assert.equal(bar0921.shares, 3796584);
    assert.equal(bar0921.turnover, 7741);
    close(bar0921.change, 85);
  }
  const inst0918 = b.institutional.find((r) => r.date === '2026-09-18');
  if (inst0918) {
    close(inst0918.foreign, -166.234);
    close(inst0918.trust, 88.874);
    close(inst0918.dealer, 82.438);
    close(inst0918.total, 5.078);
  }
  const row0918 = a.table.find((r) => r.date === '2026-09-18');
  if (row0918) {
    assert.equal(row0918.close, 2290);
    assert.equal(Math.round(row0918.volume), 2681);
    assert.equal(Math.round(row0918.total), 5);
    assert.equal(row0918.marginBalance, 1423);
    assert.equal(row0918.dayTradeVolume, 594);
  }
  assert.equal(a.header.code, '2360');
  assert.equal(a.header.name, '致茂');
});
