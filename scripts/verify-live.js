#!/usr/bin/env node
// 線上交叉驗證：用交易所官方 API 與 FinMind 互相比對，確保儀表板不會顯示錯誤數據。
//   node scripts/verify-live.js [代碼 ...]   預設 2360 2330 6488
import { fetchJson } from '../src/sources/http.js';
import * as twse from '../src/sources/twse.js';
import * as finmind from '../src/sources/finmind.js';
import { loadBundle } from '../src/sources/index.js';
import { analyze } from '../src/analysis/engine.js';
import { num } from '../src/util/num.js';
import { rocToIso, isoToCompact, taipeiNow, monthsAgoIso } from '../src/util/date.js';

const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['2360', '2330', '6488'];
let failures = 0;
let checks = 0;
const ok = (cond, msg) => { checks++; if (cond) console.log(`  ✅ ${msg}`); else { failures++; console.log(`  ❌ ${msg}`); } };
const eq = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol;

async function verifyTse(code) {
  console.log(`\n[${code}] 上市：TWSE STOCK_DAY vs FinMind TaiwanStockPrice`);
  const today = taipeiNow().iso;
  const month = `${today.slice(0, 7)}-01`;
  const [twseRows, fmRows] = await Promise.all([
    twse.fetchStockDayMonth(code, month),
    finmind.fetchPrice(code, month, today),
  ]);
  ok(twseRows.length > 0, `TWSE 本月有 ${twseRows.length} 筆日成交`);
  let compared = 0;
  for (const t of twseRows) {
    const f = fmRows.find((r) => r.date === t.date);
    if (!f) continue;
    compared++;
    const same = eq(t.open, f.open) && eq(t.high, f.high) && eq(t.low, f.low) && eq(t.close, f.close) && eq(t.shares, f.shares) && eq(t.amount, f.amount) && eq(t.turnover, f.turnover);
    if (!same) ok(false, `${t.date} 不一致 TWSE=${JSON.stringify([t.open, t.high, t.low, t.close, t.shares, t.turnover])} FinMind=${JSON.stringify([f.open, f.high, f.low, f.close, f.shares, f.turnover])}`);
  }
  ok(compared > 0, `逐日比對 ${compared} 個交易日（開高低收 / 成交股數 / 成交金額 / 筆數）全部一致`);
  return twseRows[twseRows.length - 1];
}

async function verifyT86(code, dateIso) {
  console.log(`\n[${code}] 三大法人：TWSE T86 vs FinMind（${dateIso}）`);
  const j = await fetchJson(`https://www.twse.com.tw/fund/T86?response=json&date=${isoToCompact(dateIso)}&selectType=ALLBUT0999`, { minGapMs: 400 });
  if (j.stat !== 'OK') { ok(false, `T86 ${dateIso}: ${j.stat}`); return; }
  const row = (j.data || []).find((r) => r[0].trim() === code);
  if (!row) { console.log(`  （T86 當日無 ${code} 資料）`); return; }
  const f = (await finmind.fetchInstitutional(code, dateIso, dateIso))[0];
  ok(!!f, 'FinMind 當日有法人資料');
  if (!f) return;
  const foreign = num(row[4]) + num(row[7]);
  const trust = num(row[10]);
  const dealer = num(row[11]);
  const total = num(row[18]);
  ok(eq(foreign, f.foreign * 1000, 0.5), `外資（含外資自營）${foreign} 股 = FinMind ${Math.round(f.foreign * 1000)}`);
  ok(eq(trust, f.trust * 1000, 0.5), `投信 ${trust} 股 = FinMind ${Math.round(f.trust * 1000)}`);
  ok(eq(dealer, f.dealer * 1000, 0.5), `自營商 ${dealer} 股 = FinMind ${Math.round(f.dealer * 1000)}`);
  ok(eq(total, f.total * 1000, 0.5), `三大法人合計 ${total} 股 = FinMind ${Math.round(f.total * 1000)}`);
}

async function verifyMargin(code, dateIso) {
  console.log(`\n[${code}] 融資融券：TWSE MI_MARGN vs FinMind（${dateIso}）`);
  const j = await fetchJson(`https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${isoToCompact(dateIso)}&selectType=ALL`, { minGapMs: 400 });
  const table = (j.tables || []).find((t) => /融資融券彙總/.test(t.title || ''));
  const row = table && (table.data || []).find((r) => r[0].trim() === code);
  if (!row) { console.log('  （MI_MARGN 當日無此代碼）'); return; }
  const f = (await finmind.fetchMargin(code, dateIso, dateIso))[0];
  ok(!!f, 'FinMind 當日有融資券資料');
  if (!f) return;
  // 欄位：代號,名稱,[融資]買進,賣出,現金償還,前日餘額,今日餘額,限額,[融券]買進,賣出,現券償還,前日餘額,今日餘額,限額,資券互抵,註記
  const balIdx = table.fields.map((f2, i) => (f2.trim() === '今日餘額' ? i : -1)).filter((i) => i >= 0);
  const [marginIdx, shortIdx] = balIdx.length >= 2 ? balIdx : [6, 12];
  ok(eq(num(row[marginIdx]), f.marginBalance), `融資今日餘額 ${num(row[marginIdx])} 張 = FinMind ${f.marginBalance}`);
  ok(eq(num(row[shortIdx]), f.shortBalance), `融券今日餘額 ${num(row[shortIdx])} 張 = FinMind ${f.shortBalance}`);
}

async function verifyOtc(code) {
  console.log(`\n[${code}] 上櫃：TPEx 每日收盤行情 vs FinMind TaiwanStockPrice（最新交易日）`);
  const all = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', { timeoutMs: 30000 });
  const row = all.find((r) => r.SecuritiesCompanyCode === code);
  if (!row) { ok(false, `TPEx 行情表無 ${code}`); return; }
  const dateIso = rocToIso(`${Number(row.Date.slice(0, 3))}/${row.Date.slice(3, 5)}/${row.Date.slice(5, 7)}`);
  const f = (await finmind.fetchPrice(code, dateIso, dateIso))[0];
  ok(!!f, `FinMind ${dateIso} 有資料`);
  if (!f) return;
  ok(eq(num(row.Open), f.open) && eq(num(row.High), f.high) && eq(num(row.Low), f.low) && eq(num(row.Close), f.close), `開高低收 ${row.Open}/${row.High}/${row.Low}/${row.Close} 一致`);
  ok(eq(num(row.TradingShares), f.shares), `成交股數 ${row.TradingShares} = FinMind ${f.shares}`);
  ok(eq(num(row.TransactionNumber), f.turnover), `成交筆數 ${row.TransactionNumber} = FinMind ${f.turnover}`);
}

async function verifyQuoteVsDaily(code) {
  console.log(`\n[${code}] 即時報價 vs 官方日成交`);
  const b = await loadBundle(code);
  const a = analyze(b);
  const lastBar = b.daily[b.daily.length - 1];
  const q = b.quote;
  ok(!!q, `MIS 即時報價可取得（${q ? `${q.date} ${q.time} 價 ${q.price}` : '無'}）`);
  if (q && q.date === lastBar.date) {
    ok(eq(q.price, lastBar.close), `收盤價 MIS ${q.price} = 官方 ${lastBar.close}`);
    ok(eq(q.open, lastBar.open) && eq(q.high, lastBar.high) && eq(q.low, lastBar.low), `開高低 MIS = 官方（${lastBar.open}/${lastBar.high}/${lastBar.low}）`);
    console.log(`  ℹ️  成交量：MIS 盤中累積 ${q.volume} 張 vs 官方全日 ${Math.round(lastBar.volume)} 張（官方含盤後定價/零股，儀表板收盤後採官方值）`);
  }
  ok(a.header.close === lastBar.close || a.header.isLive, `儀表板 header 收盤 ${a.header.close} 對應 ${a.header.isLive ? '盤中報價' : `官方日K ${lastBar.close}`}`);
  ok(!/NaN|Infinity/.test(JSON.stringify(a)), '分析輸出不含 NaN / Infinity');
}

(async () => {
  console.log(`線上資料交叉驗證  ${taipeiNow().iso} ${taipeiNow().time}（台北）`);
  for (const code of codes) {
    try {
      const b = await loadBundle(code);
      if (b.meta.market === 'tse') {
        const lastBar = await verifyTse(code);
        if (lastBar) {
          await verifyT86(code, lastBar.date);
          await verifyMargin(code, lastBar.date);
        }
      } else {
        await verifyOtc(code);
      }
      await verifyQuoteVsDaily(code);
    } catch (err) {
      ok(false, `${code} 驗證過程發生錯誤：${err.message}`);
    }
  }
  console.log(`\n結果：${checks - failures}/${checks} 項通過${failures ? `，${failures} 項失敗` : ''}`);
  process.exit(failures ? 1 : 0);
})();
