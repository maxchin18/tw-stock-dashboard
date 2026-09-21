// 分析引擎：把日K / 法人 / 融資券 / 當沖 / 即時報價 轉成 18 個面板所需的指標。
// 純函式、瀏覽器與 Node 共用；所有數值皆由公開資料以固定公式計算（公式見 README「指標定義」）。
import {
  sma, rsi, macd, kd, atr, rollingMax, rollingMin, rollingVwap, logReturns,
} from './indicators.js';
import {
  round, clamp, mean, std, sum, last, normCdf, pctChange, fmt, fmtInt, fmtSigned, fmtPct,
} from '../util/num.js';
import { isoWeekKey } from '../util/date.js';

export const ENGINE_VERSION = '1.0.0';

const isNum = (v) => v != null && Number.isFinite(v);
const nz = (v, d = 0) => (isNum(v) ? v : d);
const pick = (arr, i) => (i >= 0 && i < arr.length ? arr[i] : null);

/** 把即時報價合併成「今日進行中的K棒」（僅當報價日期晚於最後一根官方日K） */
export function mergeLiveBar(daily, quote) {
  const bars = daily.map((b) => ({ ...b }));
  if (!bars.length) return { bars, live: null };
  const lastBar = bars[bars.length - 1];
  if (!quote || !quote.date || !isNum(quote.price) || !isNum(quote.open) || quote.date <= lastBar.date) {
    return { bars, live: null };
  }
  const high = isNum(quote.high) ? quote.high : quote.price;
  const low = isNum(quote.low) ? quote.low : quote.price;
  const volume = nz(quote.volume);
  const shares = volume * 1000;
  const typical = (high + low + quote.price) / 3;
  const prevClose = isNum(quote.prevClose) ? quote.prevClose : lastBar.close;
  const live = {
    date: quote.date,
    open: quote.open,
    high,
    low,
    close: quote.price,
    volume,
    shares,
    amount: typical * shares,
    amountEstimated: true,
    turnover: null,
    note: null,
    change: quote.price - prevClose,
    changePct: prevClose ? ((quote.price - prevClose) / prevClose) * 100 : null,
    live: true,
  };
  bars.push(live);
  return { bars, live };
}

function trendScoreAt(i, closes, ma5, ma10, ma20, ma60) {
  const c = closes[i];
  const checks = [
    [c, ma5[i]], [ma5[i], ma10[i]], [ma10[i], ma20[i]], [ma20[i], ma60[i]], [c, ma60[i]],
  ];
  let score = 0;
  let valid = 0;
  for (const [a, b] of checks) {
    if (isNum(a) && isNum(b)) { valid++; if (a > b) score++; }
  }
  return valid ? Math.round((score / valid) * 5) : null;
}

const TREND_LABELS = ['弱勢空頭', '偏空', '中性偏空', '中性偏多', '偏多', '強勢多頭'];

function gradeOf(score) {
  if (!isNum(score)) return '—';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'E';
}

/**
 * 主分析函式
 * @param {object} bundle  由 /api/bundle 取得（daily, institutional, margin, dayTrading, quote, meta）
 * @param {{displayBars?:number}} opts
 */
export function analyze(bundle, opts = {}) {
  const displayBars = opts.displayBars || 120;
  const daily = bundle.daily || [];
  const institutional = bundle.institutional || [];
  const marginRows = bundle.margin || [];
  const dayTrading = bundle.dayTrading || [];
  const quote = bundle.quote || null;
  const meta = bundle.meta || {};

  const { bars, live } = mergeLiveBar(daily, quote);
  if (bars.length < 5) throw new Error('日K資料不足（少於 5 筆）');

  /* ---------- 序列 ---------- */
  const N = bars.length - 1;
  const dates = bars.map((b) => b.date);
  const closes = bars.map((b) => b.close);
  const opens = bars.map((b) => b.open);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => nz(b.volume));
  const shares = bars.map((b) => nz(b.shares));
  const amounts = bars.map((b) => nz(b.amount));
  const turnovers = bars.map((b) => b.turnover);

  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const rsi14 = rsi(closes, 14);
  const { k: kArr, d: dArr } = kd(highs, lows, closes, 9);
  const { dif, dea, hist } = macd(closes);
  const atr14 = atr(highs, lows, closes, 14);
  const vwap20 = rollingVwap(amounts, shares, 20);
  const hi20 = rollingMax(highs, 20);
  const lo20 = rollingMin(lows, 20);
  const hi60 = rollingMax(highs, 60);
  const lo60 = rollingMin(lows, 60);
  const rets = logReturns(closes);

  const lastBar = bars[N];
  const prevBar = bars[N - 1];
  const close = closes[N];
  const prevClose = live && isNum(quote.prevClose) ? quote.prevClose : prevBar.close;
  const change = isNum(lastBar.change) ? lastBar.change : close - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : null;

  const avgVol5 = mean(last(vols, 5));
  const avgVol20 = mean(last(vols, 20));
  const avgVol60 = mean(last(vols, 60));
  const avgAmount20 = mean(last(amounts, 20));
  const ret60 = last(rets.filter(isNum), 60);
  const mu = ret60.length >= 20 ? mean(ret60) : null;
  const sigma = ret60.length >= 20 ? std(ret60) : null;
  const annVol = isNum(sigma) ? sigma * Math.sqrt(252) * 100 : null;
  const roc10 = N >= 10 ? pctChange(close, closes[N - 10]) : null;
  const rsiNow = rsi14[N];
  const vwapNow = vwap20[N];
  const vwapDiffPct = isNum(vwapNow) ? pctChange(close, vwapNow) : null;
  const volRatio = isNum(avgVol20) && avgVol20 > 0 ? vols[N] / avgVol20 : null;
  const volRatio5 = isNum(avgVol20) && avgVol20 > 0 && isNum(avgVol5) ? avgVol5 / avgVol20 : null;

  /* ---------- 法人 / 融資券 / 當沖 對齊 ---------- */
  const barByDate = new Map(bars.map((b) => [b.date, b]));
  const instRows = institutional.filter((r) => r.date <= lastBar.date);
  const inst5 = last(instRows, 5);
  const inst20 = last(instRows, 20);
  const net5 = inst5.length ? sum(inst5.map((r) => r.total)) : null;
  const net20 = inst20.length ? sum(inst20.map((r) => r.total)) : null;
  const volFor = (rows) => sum(rows.map((r) => nz(barByDate.get(r.date)?.volume)));
  const vol5sum = inst5.length ? volFor(inst5) : null;
  const vol20sum = inst20.length ? volFor(inst20) : null;
  const r5 = isNum(net5) && vol5sum > 0 ? (net5 / vol5sum) * 100 : null;   // 近5日法人買賣超佔成交量 %
  const r20 = isNum(net20) && vol20sum > 0 ? (net20 / vol20sum) * 100 : null;
  const instLast = instRows[instRows.length - 1] || null;

  const mRows = marginRows.filter((r) => r.date <= lastBar.date);
  const mLast = mRows[mRows.length - 1] || null;
  const m5 = mRows.length >= 6 ? mRows[mRows.length - 6] : null;
  const marginChange5Pct = mLast && m5 && m5.marginBalance > 0 ? pctChange(mLast.marginBalance, m5.marginBalance) : null;
  const shortChange5Pct = mLast && m5 && m5.shortBalance > 0 ? pctChange(mLast.shortBalance, m5.shortBalance) : null;

  const dtRows = dayTrading.filter((r) => r.date <= lastBar.date);
  const dtLast = dtRows[dtRows.length - 1] || null;
  const dtBar = dtLast ? barByDate.get(dtLast.date) : null;
  const dayTradeRatio = dtLast && dtBar && dtBar.volume > 0 && isNum(dtLast.dayTradeVolume)
    ? (dtLast.dayTradeVolume / dtBar.volume) * 100 : null;

  /* ---------- 01 主K線 + 支撐壓力 ---------- */
  const trendScore = trendScoreAt(N, closes, ma5, ma10, ma20, ma60);
  const support = { s1: lo20[N], s2: lo60[N] ?? Math.min(...lows.filter(isNum)) };
  const resistance = { r1: hi20[N], r2: hi60[N] ?? Math.max(...highs.filter(isNum)) };

  /* ---------- 02 決策核心 ---------- */
  const pos20 = isNum(hi20[N]) && isNum(lo20[N]) && hi20[N] !== lo20[N] ? (close - lo20[N]) / (hi20[N] - lo20[N]) : null;
  let shortState = '資料不足';
  if (isNum(pos20)) {
    if (close >= hi20[N] * 0.999 && isNum(volRatio) && volRatio >= 1.5) shortState = '強勢突破';
    else if (close <= lo20[N] * 1.001) shortState = '破底走弱';
    else if (pos20 >= 0.7) shortState = '高檔震盪';
    else if (pos20 <= 0.3) shortState = '低檔整理';
    else shortState = '區間震盪';
  }
  let mainForce = '無法人資料';
  if (isNum(r5)) {
    if (r5 >= 5) mainForce = '積極布局';
    else if (r5 >= 1) mainForce = '小幅加碼';
    else if (r5 > -1) mainForce = '觀望調節';
    else if (r5 > -5) mainForce = '調節減碼';
    else mainForce = '大量出貨';
  }
  let chipStructure = '無法人資料';
  if (isNum(r20)) chipStructure = r20 > 3 ? '集中' : r20 < -3 ? '分散' : '中性';

  // 隔日沖風險：爆量、漲幅、振幅、當沖比例 之加權（0–100）
  const volSpike = isNum(volRatio) ? clamp(volRatio, 0, 3) / 3 : null;
  const gainFactor = isNum(changePct) ? clamp(changePct, 0, 10) / 10 : null;
  const rangePct = isNum(prevClose) && prevClose > 0 ? ((lastBar.high - lastBar.low) / prevClose) * 100 : null;
  const rangeFactor = isNum(rangePct) ? clamp(rangePct, 0, 10) / 10 : null;
  const dtFactor = isNum(dayTradeRatio) ? clamp(dayTradeRatio, 0, 60) / 60 : null;
  const nextDayParts = [[volSpike, 0.3], [gainFactor, 0.25], [rangeFactor, 0.2], [dtFactor, 0.25]].filter(([v]) => isNum(v));
  const nextDayRisk = nextDayParts.length
    ? (nextDayParts.reduce((a, [v, w]) => a + v * w, 0) / nextDayParts.reduce((a, [, w]) => a + w, 0)) * 100
    : null;

  // 籌碼健康度 0–100
  const healthParts = [];
  if (isNum(net20)) healthParts.push({ name: '20日法人買賣超', score: net20 > 0 ? 15 : net20 < 0 ? -15 : 0 });
  if (isNum(net5)) healthParts.push({ name: '5日法人買賣超', score: net5 > 0 ? 10 : net5 < 0 ? -10 : 0 });
  if (isNum(marginChange5Pct)) healthParts.push({ name: '融資餘額5日變化', score: marginChange5Pct < 0 ? 10 : marginChange5Pct > 0 ? -10 : 0 });
  if (isNum(vwapDiffPct)) healthParts.push({ name: '收盤 vs 20日VWAP', score: vwapDiffPct > 0 ? 15 : -15 });
  if (isNum(volRatio)) healthParts.push({ name: '量能是否異常', score: volRatio >= 0.5 && volRatio <= 2 ? 10 : -10 });
  const chipHealth = healthParts.length ? clamp(50 + healthParts.reduce((a, p) => a + p.score, 0), 0, 100) : null;
  const chipHealthLabel = !isNum(chipHealth) ? '—' : chipHealth >= 80 ? '優' : chipHealth >= 65 ? '良' : chipHealth >= 50 ? '普通' : chipHealth >= 35 ? '偏弱' : '差';

  let riskLevel = null;
  if (isNum(annVol)) {
    riskLevel = annVol < 25 ? 1 : annVol < 40 ? 2 : annVol < 60 ? 3 : annVol < 80 ? 4 : 5;
    if (isNum(nextDayRisk) && nextDayRisk >= 60) riskLevel = Math.min(5, riskLevel + 1);
  }

  /* ---------- 03 多維度判讀 ---------- */
  const sInst = isNum(r20) ? clamp(50 + r20 * 5, 0, 100) : null;
  const sMom = isNum(rsiNow) && isNum(roc10) ? (rsiNow + clamp(50 + roc10 * 2.5, 0, 100)) / 2 : (isNum(rsiNow) ? rsiNow : null);
  const sTrend = isNum(trendScore) ? (trendScore / 5) * 100 : null;
  const sChip = chipHealth;
  const sLiq = isNum(avgAmount20) && avgAmount20 > 0 ? clamp((100 * Math.log10(avgAmount20 / 1e6)) / 3.5, 0, 100) : null;
  const sVol = isNum(annVol) ? 100 - clamp(annVol, 0, 100) : null;
  const radarAxes = [
    { name: '法人', score: sInst, weight: 0.2 },
    { name: '動能', score: sMom, weight: 0.2 },
    { name: '趨勢', score: sTrend, weight: 0.2 },
    { name: '籌碼', score: sChip, weight: 0.2 },
    { name: '流動性', score: sLiq, weight: 0.1 },
    { name: '波動', score: sVol, weight: 0.1 },
  ];
  const validAxes = radarAxes.filter((a) => isNum(a.score));
  const totalScore = validAxes.length
    ? validAxes.reduce((a, x) => a + x.score * x.weight, 0) / validAxes.reduce((a, x) => a + x.weight, 0) : null;
  const grade = gradeOf(totalScore);

  /* ---------- 04 籌碼熱區圖（價量分布，近 60 日） ---------- */
  const heatmap = buildHeatmap(bars.slice(Math.max(0, N - 59)), close);

  /* ---------- 05 風險雷達 ---------- */
  const rLiq = isNum(sLiq) ? 100 - sLiq : null;
  const rVol = isNum(annVol) ? clamp(annVol, 0, 100) : null;
  const rTrend = isNum(sTrend) ? 100 - sTrend : null;
  const rInst = isNum(r5) ? clamp(50 - r5 * 5, 0, 100) : null;
  const rChip = isNum(marginChange5Pct) || isNum(volRatio)
    ? clamp(50 + nz(marginChange5Pct) * 5 + (nz(volRatio, 1) - 1) * 20, 0, 100) : null;
  const riskAxes = [
    { name: '流動性風險', score: rLiq },
    { name: '波動風險', score: rVol },
    { name: '趨勢風險', score: rTrend },
    { name: '法人風險', score: rInst },
    { name: '籌碼風險', score: rChip },
  ];
  const riskIndex = mean(riskAxes.map((a) => a.score));
  const riskIndexLabel = !isNum(riskIndex) ? '—' : riskIndex < 35 ? '低' : riskIndex < 50 ? '中' : riskIndex < 65 ? '中高' : '高';

  /* ---------- 06 統計推估路徑（近 60 日對數報酬） ---------- */
  const forecast = buildForecast(close, mu, sigma);

  /* ---------- 07 成本結構分布 ---------- */
  const costStructure = buildCostStructure(bars, closes, vwap20, N);

  /* ---------- 08 法人行為計量 ---------- */
  const instSeries = last(instRows, 60);
  let cum = 0;
  const instCumulative = instSeries.map((r) => { cum += r.total; return cum; });
  const institutionalPanel = {
    available: instRows.length > 0,
    dates: instSeries.map((r) => r.date),
    foreign: instSeries.map((r) => r.foreign),
    trust: instSeries.map((r) => r.trust),
    dealer: instSeries.map((r) => r.dealer),
    total: instSeries.map((r) => r.total),
    cumulative: instCumulative,
    last3: last(instRows, 3).reverse(),
    net5, net20, r5, r20,
    label20: isNum(net20) ? (net20 >= 0 ? '多頭' : '空頭') : '—',
    label5: isNum(net5) ? (net5 >= 0 ? '偏多' : '偏空') : '—',
    foreign5: inst5.length ? sum(inst5.map((r) => r.foreign)) : null,
    trust5: inst5.length ? sum(inst5.map((r) => r.trust)) : null,
    dealer5: inst5.length ? sum(inst5.map((r) => r.dealer)) : null,
  };

  /* ---------- 09 隔日沖風險分析 ---------- */
  const avgInstSell20 = inst20.length ? mean(inst20.map((r) => r.totalSell)) : null;
  const instSellAnomaly = instLast && isNum(avgInstSell20) && avgInstSell20 > 0 ? (clamp(instLast.totalSell / avgInstSell20, 0, 3) / 3) * 100 : null;
  const nextDayPanel = {
    items: [
      { name: '主力賣出異常', score: instSellAnomaly, raw: instLast ? instLast.totalSell : null, rawLabel: instLast ? `法人賣出 ${fmtInt(instLast.totalSell)} 張 / 20日均 ${fmtInt(avgInstSell20)} 張` : '無資料' },
      { name: '量能換手率', score: isNum(volSpike) ? volSpike * 100 : null, raw: volRatio, rawLabel: isNum(volRatio) ? `今量 / 20日均量 = ${fmt(volRatio, 2)} 倍` : '無資料' },
      { name: '沖銷比例', score: isNum(dayTradeRatio) ? clamp(dayTradeRatio, 0, 100) : null, raw: dayTradeRatio, rawLabel: dtLast ? `${dtLast.date} 當沖 ${fmtInt(dtLast.dayTradeVolume)} 張 / 成交 ${fmtInt(dtBar?.volume)} 張` : '無資料' },
      { name: '隔日回檔風險', score: nextDayRisk, raw: nextDayRisk, rawLabel: '爆量×0.3 + 漲幅×0.25 + 振幅×0.2 + 當沖×0.25' },
      { name: '日內波動率', score: isNum(rangeFactor) ? rangeFactor * 100 : null, raw: rangePct, rawLabel: isNum(rangePct) ? `振幅 ${fmt(rangePct, 2)}%（(高−低)/昨收）` : '無資料' },
    ],
    index: nextDayRisk,
    level: !isNum(nextDayRisk) ? '—' : nextDayRisk < 35 ? '低' : nextDayRisk < 60 ? '中' : '高',
  };

  /* ---------- 10 多空能量條（近 20 日紅K量 / 黑K量） ---------- */
  let redVol = 0;
  let blackVol = 0;
  for (let i = Math.max(0, N - 19); i <= N; i++) {
    if (closes[i] > opens[i]) redVol += vols[i];
    else if (closes[i] < opens[i]) blackVol += vols[i];
  }
  const energy = {
    bull: redVol + blackVol > 0 ? (redVol / (redVol + blackVol)) * 100 : null,
    bear: redVol + blackVol > 0 ? (blackVol / (redVol + blackVol)) * 100 : null,
    ratio: blackVol > 0 ? redVol / blackVol : null,
    redVol, blackVol,
  };

  /* ---------- 11 健康度綜合評估 ---------- */
  const sTech = isNum(sTrend) && isNum(sMom) ? (sTrend + sMom) / 2 : null;
  const sFund = isNum(volRatio5) ? clamp(50 * volRatio5, 0, 100) : null;
  const healthItems = [
    { name: '籌碼健康度', score: chipHealth, invert: false },
    { name: '技術結構度', score: sTech, invert: false },
    { name: '資金動能度', score: sFund, invert: false },
    { name: '波動風險度', score: rVol, invert: true },
    { name: '法人支撐度', score: sInst, invert: false },
  ];
  const healthOverall = mean(healthItems.map((h) => (isNum(h.score) ? (h.invert ? 100 - h.score : h.score) : null)));
  const healthLabel = !isNum(healthOverall) ? '—' : healthOverall >= 75 ? '優' : healthOverall >= 60 ? '良' : healthOverall >= 45 ? '普通' : '偏弱';

  /* ---------- 12 主力動態信號燈 ---------- */
  const trendSig = !isNum(trendScore) ? '—' : trendScore >= 4 ? '偏多' : trendScore <= 1 ? '偏空' : '中性';
  const chipSig = chipStructure === '集中' ? '籌碼集中' : chipStructure === '分散' ? '籌碼分散' : chipStructure === '中性' ? '籌碼中性' : '無法人資料';
  const momSig = !isNum(rsiNow) ? '—' : rsiNow >= 60 && nz(roc10) > 0 ? '動能強' : rsiNow <= 40 ? '動能弱' : '動能中性';
  const riskSig = !isNum(riskLevel) ? '—' : riskLevel >= 4 ? '波動風險高' : riskLevel === 3 ? '波動風險偏高' : '波動風險低';
  let light = 'yellow';
  if (isNum(riskLevel) && (riskLevel >= 4 || nz(trendScore, 3) <= 1)) light = 'red';
  else if (nz(trendScore) >= 4 && nz(riskLevel, 3) <= 2 && nz(r5) >= 0) light = 'green';
  const lightText = { red: '紅燈（高風險）', yellow: '黃燈（觀望）', green: '綠燈（偏多）' }[light];

  /* ---------- 13 市場情緒 ---------- */
  const retailSent = isNum(marginChange5Pct) ? clamp(50 + marginChange5Pct * 5, 0, 100) : null;
  const instSent = isNum(r5) ? clamp(50 + r5 * 5, 0, 100) : null;
  const mainSent = isNum(vwapDiffPct) ? clamp(50 + vwapDiffPct * 5 + (nz(volRatio5, 1) - 1) * 20, 0, 100) : null;
  const overallSent = mean([retailSent, instSent, mainSent]);
  const sentimentLabel = !isNum(overallSent) ? '—' : overallSent < 40 ? '悲觀' : overallSent > 60 ? '樂觀' : '中性';

  /* ---------- 14 信心維度（含真實回測） ---------- */
  const backtest = runBacktest(closes, ma5, ma10, ma20, ma60, N);
  const flips = countFlips(closes, ma5, ma10, ma20, ma60, N);
  const datasetsPresent = [true, bars.length >= 60, instRows.length > 0, mRows.length > 0, dtRows.length > 0, !!quote].filter(Boolean).length;
  const completeness = (datasetsPresent / 6) * 100 * Math.min(1, bars.length / 120);
  const stability = isNum(flips) ? (1 - flips / 19) * 100 : null;
  const applicability = isNum(annVol) ? clamp(100 - Math.max(0, annVol - 45) * 2 - Math.max(0, 20 - annVol) * 3, 0, 100) : null;
  const confidenceItems = [
    { name: '模型準確度', score: backtest.accuracy, note: backtest.n ? `近 ${backtest.n} 次 5 日方向回測命中 ${backtest.hits} 次` : '樣本不足' },
    { name: '資料完整度', score: completeness, note: `${datasetsPresent}/6 資料集、${bars.length} 根日K` },
    { name: '訊號穩定度', score: stability, note: isNum(flips) ? `近 20 日趨勢訊號翻轉 ${flips} 次` : '資料不足' },
    { name: '策略適用度', score: applicability, note: isNum(annVol) ? `年化波動 ${fmt(annVol, 1)}%` : '資料不足' },
  ];
  const aiConfidence = mean(confidenceItems.map((c) => c.score));

  /* ---------- 15 籌碼異動摘要 ---------- */
  const chipSummary = {
    available: !!instLast,
    date: instLast?.date || null,
    foreign: instLast?.foreign ?? null,
    trust: instLast?.trust ?? null,
    dealer: instLast?.dealer ?? null,
    total: instLast?.total ?? null,
    sparkDates: last(instRows, 20).map((r) => r.date),
    spark: (() => { let c = 0; return last(instRows, 20).map((r) => { c += r.total; return c; }); })(),
    shortTerm: isNum(net5) ? (net5 >= 0 ? '短線偏多' : '短線偏空') : '—',
    chase: isNum(nextDayRisk) ? (nextDayRisk < 50 ? '追價風險可控' : '追價風險偏高') : '—',
    conclusion: !isNum(net5) || !isNum(trendScore) ? '—'
      : net5 >= 0 && trendScore >= 3 ? '偏多操作' : net5 < 0 && trendScore <= 2 ? '偏空觀望' : '中性觀望',
  };

  /* ---------- 16 買賣力分布（法人買進/賣出佔成交量比例，近 20 日） ---------- */
  const instBuy20 = inst20.length ? sum(inst20.map((r) => r.totalBuy)) : null;
  const instSell20 = inst20.length ? sum(inst20.map((r) => r.totalSell)) : null;
  const bigBuy = isNum(instBuy20) && vol20sum > 0 ? clamp((instBuy20 / vol20sum) * 100, 0, 100) : null;
  const bigSell = isNum(instSell20) && vol20sum > 0 ? clamp((instSell20 / vol20sum) * 100, 0, 100) : null;
  const buySellPower = {
    bigBuy,
    retailBuy: isNum(bigBuy) ? 100 - bigBuy : null,
    retailSell: isNum(bigSell) ? 100 - bigSell : null,
    bigSell,
    window: inst20.length,
    date: instLast?.date || null,
  };

  /* ---------- 17 多空強度 ---------- */
  const bullStrength = mean([sTrend, sMom, sInst]);
  const strength = {
    bull: bullStrength,
    bear: isNum(bullStrength) ? 100 - bullStrength : null,
    volume: sFund,
    level: !isNum(totalScore) ? null : totalScore >= 80 ? 1 : totalScore >= 65 ? 2 : totalScore >= 50 ? 3 : totalScore >= 35 ? 4 : 5,
  };

  /* ---------- 18 總評判 ---------- */
  const verdict = buildVerdict({ mainForce, trendScore, net5, vwapDiffPct, rsiNow, shortState, light, nextDayRisk, changePct });

  /* ---------- 警示 ---------- */
  const alerts = buildAlerts({
    bars, closes, highs, lows, vols, N, ma20, ma60, hi20, lo20, rsi14, kArr, dArr, hist, avgVol20, instRows, mLast, m5, marginChange5Pct, quote, changePct, live,
  });

  /* ---------- 輸出 ---------- */
  const from = Math.max(0, bars.length - displayBars);
  const slice = (arr) => arr.slice(from);
  const result = {
    engineVersion: ENGINE_VERSION,
    computedAt: Date.now(),
    header: {
      code: meta.code, name: meta.name, market: meta.market, industry: meta.industry || null,
      date: lastBar.date, isLive: !!live, quoteTime: quote?.time || null, quoteDataTime: quote?.dataTime || null, quoteDate: quote?.date || null,
      close, change, changePct, open: lastBar.open, high: lastBar.high, low: lastBar.low,
      volume: lastBar.volume, turnover: lastBar.turnover, amount: lastBar.amount, amountEstimated: !!lastBar.amountEstimated,
      prevClose,
      limitUp: quote && quote.date === lastBar.date ? quote.limitUp : null,
      limitDown: quote && quote.date === lastBar.date ? quote.limitDown : null,
      asks: quote && quote.date === lastBar.date ? quote.asks : [],
      bids: quote && quote.date === lastBar.date ? quote.bids : [],
      bars: bars.length, rangeFrom: bars[0].date, rangeTo: lastBar.date,
      instDays: instRows.length,
      volumeLabel: live ? '盤中累積（不含盤後）' : '官方日成交量',
      sources: meta.sources || {},
      errors: meta.errors || {},
    },
    series: {
      dates: slice(dates), opens: slice(opens), highs: slice(highs), lows: slice(lows), closes: slice(closes), volumes: slice(vols),
      turnovers: slice(turnovers), amounts: slice(amounts), live: !!live,
      ma5: slice(ma5), ma10: slice(ma10), ma20: slice(ma20), ma60: slice(ma60), vwap20: slice(vwap20),
      rsi14: slice(rsi14), k: slice(kArr), d: slice(dArr), dif: slice(dif), dea: slice(dea), hist: slice(hist), atr14: slice(atr14),
    },
    kline: { support, resistance, mainCost: vwapNow, close },
    decision: {
      trendScore, trendLabel: isNum(trendScore) ? TREND_LABELS[trendScore] : '—',
      shortState, mainForce, chipStructure,
      nextDayRisk, chipHealth, chipHealthLabel, healthParts,
      support, resistance, riskLevel, annVol, r5, r20, pos20,
      warning: light === 'red' ? 'AI WARNING' : light === 'yellow' ? 'AI WATCH' : 'AI NORMAL',
      light,
    },
    radar: { axes: radarAxes, total: totalScore, grade },
    heatmap,
    riskRadar: { axes: riskAxes, index: riskIndex, label: riskIndexLabel },
    forecast,
    costStructure,
    institutional: institutionalPanel,
    nextDay: nextDayPanel,
    energy,
    health: { items: healthItems, overall: healthOverall, label: healthLabel },
    signalLight: { trend: trendSig, chip: chipSig, momentum: momSig, risk: riskSig, light, text: lightText },
    sentiment: { retail: retailSent, institutional: instSent, mainForce: mainSent, overall: overallSent, label: sentimentLabel },
    confidence: { items: confidenceItems, confidence: aiConfidence, backtest },
    chipSummary,
    buySellPower,
    strength,
    verdict,
    alerts,
    stats: {
      avgVol5, avgVol20, avgVol60, avgAmount20, mu, sigma, annVol, roc10, rsiNow, vwapNow, vwapDiffPct, volRatio, volRatio5,
      net5, net20, r5, r20, marginChange5Pct, shortChange5Pct, dayTradeRatio, rangePct,
      marginBalance: mLast?.marginBalance ?? null, shortBalance: mLast?.shortBalance ?? null, marginDate: mLast?.date ?? null,
      kNow: kArr[N], dNow: dArr[N], difNow: dif[N], deaNow: dea[N], histNow: hist[N], atrNow: atr14[N],
      ma5: ma5[N], ma10: ma10[N], ma20: ma20[N], ma60: ma60[N],
    },
    table: buildTable(bars, instRows, mRows, dtRows),
  };
  result.report = buildReport(result);
  return result;
}

/* ================= 子函式 ================= */

function buildHeatmap(bars, close) {
  if (bars.length < 5) return { available: false };
  const lo = Math.min(...bars.map((b) => b.low).filter(isNum));
  const hi = Math.max(...bars.map((b) => b.high).filter(isNum));
  const BINS = 20;
  const width = hi > lo ? (hi - lo) / BINS : 1;
  const binIndex = (p) => clamp(Math.floor((p - lo) / width), 0, BINS - 1);
  const columnsMap = new Map();
  const profile = new Array(BINS).fill(0);
  for (const b of bars) {
    const key = isoWeekKey(b.date);
    if (!columnsMap.has(key)) columnsMap.set(key, { key, start: b.date, end: b.date, bins: new Array(BINS).fill(0) });
    const col = columnsMap.get(key);
    col.end = b.date;
    const v = nz(b.volume);
    if (!v) continue;
    if (!isNum(b.low) || !isNum(b.high) || b.high === b.low) {
      const idx = binIndex(b.close);
      col.bins[idx] += v; profile[idx] += v; continue;
    }
    const iLo = binIndex(b.low);
    const iHi = binIndex(b.high);
    for (let i = iLo; i <= iHi; i++) {
      const bLo = lo + i * width;
      const bHi = bLo + width;
      const overlap = Math.max(0, Math.min(bHi, b.high) - Math.max(bLo, b.low));
      const share = overlap / (b.high - b.low);
      col.bins[i] += v * share;
      profile[i] += v * share;
    }
  }
  const total = sum(profile);
  const binMid = (i) => lo + (i + 0.5) * width;
  const poc = profile.indexOf(Math.max(...profile));
  let above = 0;
  let near = 0;
  let below = 0;
  let dense = 0;
  for (let i = 0; i < BINS; i++) {
    const m = binMid(i);
    if (m > close * 1.02) above += profile[i];
    else if (m < close * 0.98) below += profile[i];
    else near += profile[i];
    if (profile[i] >= profile[poc] * 0.5) dense += profile[i];
  }
  const pctOf = (v) => (total > 0 ? (v / total) * 100 : null);
  return {
    available: total > 0,
    priceMin: lo, priceMax: hi, bins: BINS, binWidth: width,
    binLabels: Array.from({ length: BINS }, (_, i) => round(binMid(i), 2)),
    columns: [...columnsMap.values()].map((c) => ({ key: c.key, start: c.start, end: c.end, bins: c.bins.map((v) => round(total > 0 ? (v / total) * 100 : 0, 3)) })),
    profile: profile.map((v) => round(pctOf(v), 3)),
    poc: { index: poc, price: round(binMid(poc), 2), share: pctOf(profile[poc]) },
    shares: { resistance: pctOf(above), heavy: pctOf(profile[poc]), dense: pctOf(dense), near: pctOf(near), support: pctOf(below) },
    days: bars.length,
  };
}

function buildForecast(close, mu, sigma) {
  if (!isNum(mu) || !isNum(sigma) || sigma <= 0) return { available: false };
  const horizons = [];
  for (let h = 1; h <= 10; h++) {
    const s = sigma * Math.sqrt(h);
    horizons.push({
      h,
      median: close * Math.exp(mu * h),
      up1: close * Math.exp(mu * h + s),
      dn1: close * Math.exp(mu * h - s),
      up2: close * Math.exp(mu * h + 2 * s),
      dn2: close * Math.exp(mu * h - 2 * s),
    });
  }
  const s10 = sigma * Math.sqrt(10);
  const probUp = 1 - normCdf((Math.log(1.02) - mu * 10) / s10);
  const probDown = normCdf((Math.log(0.98) - mu * 10) / s10);
  const probFlat = Math.max(0, 1 - probUp - probDown);
  const probBull = 1 - normCdf((0 - mu * 10) / s10);
  return {
    available: true,
    horizons,
    probUp: probUp * 100, probFlat: probFlat * 100, probDown: probDown * 100, probBull: probBull * 100,
    drift: mu * 252 * 100,
    dailyVol: sigma * 100,
    window: 60,
  };
}

function buildCostStructure(bars, closes, vwap20, N) {
  const start = Math.max(19, N - 59);
  if (N < 19) return { available: false };
  const dates = [];
  const bands = { deepTrapped: [], trapped: [], cost: [], profit: [], deepProfit: [] };
  for (let t = start; t <= N; t++) {
    const ref = closes[t];
    let tot = 0;
    const acc = { deepTrapped: 0, trapped: 0, cost: 0, profit: 0, deepProfit: 0 };
    for (let i = t - 19; i <= t; i++) {
      const b = bars[i];
      const typ = (nz(b.high, b.close) + nz(b.low, b.close) + b.close) / 3;
      const v = nz(b.volume);
      const diff = ((typ - ref) / ref) * 100;
      tot += v;
      if (diff > 5) acc.deepTrapped += v;
      else if (diff > 2) acc.trapped += v;
      else if (diff >= -2) acc.cost += v;
      else if (diff >= -5) acc.profit += v;
      else acc.deepProfit += v;
    }
    dates.push(bars[t].date);
    for (const key of Object.keys(bands)) bands[key].push(tot > 0 ? round((acc[key] / tot) * 100, 2) : null);
  }
  const vwapNow = vwap20[N];
  return {
    available: true,
    dates,
    bands,
    labels: { deepTrapped: '深度套牢區(>+5%)', trapped: '套牢區(+2~+5%)', cost: '成本區(±2%)', profit: '獲利區(−2~−5%)', deepProfit: '大幅獲利區(<−5%)' },
    mainCost: vwapNow,
    strength: isNum(vwapNow) ? pctChange(closes[N], vwapNow) : null,
    latest: Object.fromEntries(Object.entries(bands).map(([k, arr]) => [k, arr[arr.length - 1]])),
  };
}

function runBacktest(closes, ma5, ma10, ma20, ma60, N) {
  const H = 5;
  let hits = 0;
  let n = 0;
  for (let t = Math.max(59, N - 65); t <= N - H; t++) {
    const ts = trendScoreAt(t, closes, ma5, ma10, ma20, ma60);
    if (!isNum(ts) || !isNum(closes[t + H])) continue;
    const bullish = ts >= 3;
    const up = closes[t + H] > closes[t];
    n++;
    if (bullish === up) hits++;
  }
  return { n, hits, accuracy: n >= 10 ? (hits / n) * 100 : null, horizon: H };
}

function countFlips(closes, ma5, ma10, ma20, ma60, N) {
  if (N < 20) return null;
  let flips = 0;
  let prev = null;
  for (let t = N - 19; t <= N; t++) {
    const ts = trendScoreAt(t, closes, ma5, ma10, ma20, ma60);
    if (!isNum(ts)) return null;
    const b = ts >= 3;
    if (prev != null && b !== prev) flips++;
    prev = b;
  }
  return flips;
}

function buildVerdict(x) {
  const { mainForce, trendScore, net5, vwapDiffPct, rsiNow, shortState, light, nextDayRisk, changePct } = x;
  const parts = [];
  if (isNum(net5)) parts.push(`法人近 5 日合計 ${fmtSigned(net5, 0)} 張`);
  if (isNum(vwapDiffPct)) parts.push(`收盤相對 20 日 VWAP ${fmtPct(vwapDiffPct, 1)}`);
  if (isNum(rsiNow)) parts.push(`RSI ${fmt(rsiNow, 0)}`);
  const advice = {
    積極布局: '法人明顯加碼，籌碼面偏多，可沿 5 日線順勢操作，跌破 20 日 VWAP 再檢討。',
    小幅加碼: '法人小幅加碼，短線偏多，宜分批布局、控制追價幅度。',
    觀望調節: '法人買賣力道相當，屬觀望調節，短線宜區間操作、等待方向。',
    調節減碼: '法人小幅調節，短線宜區間操作，留意支撐區是否守穩。',
    大量出貨: '法人大量賣出，籌碼鬆動，短線宜保守、避免追高。',
    無法人資料: '暫無法人資料，僅依技術面與量價判讀。',
  }[mainForce] || '';
  let extra = '';
  if (light === 'red') extra = `目前為紅燈（高風險），隔日沖風險 ${fmt(nextDayRisk, 0)}%，宜降低部位。`;
  else if (light === 'green') extra = '趨勢與籌碼同步偏多，可持股續抱。';
  else extra = `趨勢${isNum(trendScore) ? TREND_LABELS[trendScore] : '不明'}、${shortState}，建議等待訊號明朗。`;
  const tag = mainForce === '無法人資料' ? '技術面' : '法人動作';
  return {
    semantic: mainForce,
    tag,
    conclusion: `經 5 日主力行為綜合研判（${parts.join('、') || '資料有限'}），${advice}${extra}`,
    todayMove: isNum(changePct) ? fmtPct(changePct, 2) : '—',
  };
}

function buildAlerts(x) {
  const {
    bars, closes, highs, vols, N, ma20, ma60, hi20, lo20, rsi14, kArr, dArr, hist, avgVol20, instRows, mLast, m5, marginChange5Pct, quote, changePct, live,
  } = x;
  const alerts = [];
  const date = bars[N].date;
  const push = (level, title, detail) => alerts.push({ level, title, detail, date });
  const c = closes[N];
  const pc = closes[N - 1];
  if (isNum(ma20[N]) && isNum(ma20[N - 1])) {
    if (pc <= ma20[N - 1] && c > ma20[N]) push('info', '站上 20 日均線', `收盤 ${fmt(c)} > MA20 ${fmt(ma20[N])}`);
    if (pc >= ma20[N - 1] && c < ma20[N]) push('warn', '跌破 20 日均線', `收盤 ${fmt(c)} < MA20 ${fmt(ma20[N])}`);
  }
  if (isNum(ma60[N]) && isNum(ma60[N - 1])) {
    if (pc <= ma60[N - 1] && c > ma60[N]) push('info', '站上 60 日均線（季線）', `收盤 ${fmt(c)} > MA60 ${fmt(ma60[N])}`);
    if (pc >= ma60[N - 1] && c < ma60[N]) push('danger', '跌破 60 日均線（季線）', `收盤 ${fmt(c)} < MA60 ${fmt(ma60[N])}`);
  }
  if (isNum(hi20[N - 1]) && c > hi20[N - 1]) push('info', '突破 20 日新高', `收盤 ${fmt(c)} 高於前 20 日最高 ${fmt(hi20[N - 1])}`);
  if (isNum(lo20[N - 1]) && c < lo20[N - 1]) push('danger', '跌破 20 日新低', `收盤 ${fmt(c)} 低於前 20 日最低 ${fmt(lo20[N - 1])}`);
  if (isNum(rsi14[N])) {
    if (rsi14[N] >= 70) push('warn', 'RSI 超買', `RSI(14) = ${fmt(rsi14[N], 1)} ≥ 70`);
    if (rsi14[N] <= 30) push('warn', 'RSI 超賣', `RSI(14) = ${fmt(rsi14[N], 1)} ≤ 30`);
  }
  if (isNum(avgVol20) && avgVol20 > 0) {
    const r = vols[N] / avgVol20;
    if (r >= 2) push('warn', '成交量爆量', `今量 ${fmtInt(vols[N])} 張為 20 日均量 ${fmtInt(avgVol20)} 張的 ${fmt(r, 1)} 倍`);
    if (r <= 0.5 && !live) push('info', '成交量萎縮', `今量 ${fmtInt(vols[N])} 張僅 20 日均量的 ${fmt(r * 100, 0)}%`);
  }
  if (isNum(kArr[N]) && isNum(dArr[N]) && isNum(kArr[N - 1]) && isNum(dArr[N - 1])) {
    if (kArr[N - 1] <= dArr[N - 1] && kArr[N] > dArr[N]) push('info', 'KD 黃金交叉', `K ${fmt(kArr[N], 1)} 上穿 D ${fmt(dArr[N], 1)}`);
    if (kArr[N - 1] >= dArr[N - 1] && kArr[N] < dArr[N]) push('warn', 'KD 死亡交叉', `K ${fmt(kArr[N], 1)} 下穿 D ${fmt(dArr[N], 1)}`);
    if (kArr[N] >= 80) push('info', 'KD 高檔區', `K ${fmt(kArr[N], 1)} ≥ 80`);
    if (kArr[N] <= 20) push('info', 'KD 低檔區', `K ${fmt(kArr[N], 1)} ≤ 20`);
  }
  if (isNum(hist[N]) && isNum(hist[N - 1])) {
    if (hist[N - 1] <= 0 && hist[N] > 0) push('info', 'MACD 柱翻正', `柱狀 ${fmt(hist[N], 2)}`);
    if (hist[N - 1] >= 0 && hist[N] < 0) push('warn', 'MACD 柱翻負', `柱狀 ${fmt(hist[N], 2)}`);
  }
  // 法人連續買/賣超
  let streak = 0;
  let dir = 0;
  for (let i = instRows.length - 1; i >= 0; i--) {
    const s = Math.sign(instRows[i].total);
    if (s === 0) break;
    if (dir === 0) dir = s;
    if (s !== dir) break;
    streak++;
  }
  if (streak >= 3) push(dir > 0 ? 'info' : 'warn', `三大法人連續 ${streak} 日${dir > 0 ? '買超' : '賣超'}`, `最近一日 ${fmtSigned(instRows[instRows.length - 1].total, 0)} 張`);
  if (isNum(marginChange5Pct) && Math.abs(marginChange5Pct) >= 10) {
    push(marginChange5Pct > 0 ? 'warn' : 'info', `融資餘額 5 日${marginChange5Pct > 0 ? '大增' : '大減'}`, `${fmtInt(m5.marginBalance)} → ${fmtInt(mLast.marginBalance)} 張（${fmtPct(marginChange5Pct, 1)}）`);
  }
  if (quote && quote.date === date && isNum(quote.limitUp) && isNum(quote.limitDown)) {
    if (c >= quote.limitUp) push('danger', '漲停', `收盤 ${fmt(c)} = 漲停價 ${fmt(quote.limitUp)}`);
    if (c <= quote.limitDown) push('danger', '跌停', `收盤 ${fmt(c)} = 跌停價 ${fmt(quote.limitDown)}`);
  }
  if (isNum(changePct) && Math.abs(changePct) >= 5) push('warn', '單日大幅波動', `漲跌幅 ${fmtPct(changePct, 2)}`);
  const upper = highs[N] - Math.max(bars[N].open, c);
  const body = Math.abs(c - bars[N].open);
  if (isNum(upper) && body > 0 && upper / body >= 2 && changePct > 0) push('warn', '長上影線', `上影線為實體 ${fmt(upper / body, 1)} 倍，留意高檔賣壓`);
  return alerts;
}

function buildTable(bars, instRows, mRows, dtRows) {
  const inst = new Map(instRows.map((r) => [r.date, r]));
  const mg = new Map(mRows.map((r) => [r.date, r]));
  const dt = new Map(dtRows.map((r) => [r.date, r]));
  return bars.slice(-120).reverse().map((b) => {
    const i = inst.get(b.date);
    const m = mg.get(b.date);
    const d = dt.get(b.date);
    return {
      date: b.date, live: !!b.live,
      open: b.open, high: b.high, low: b.low, close: b.close, change: b.change, changePct: b.changePct,
      volume: b.volume, turnover: b.turnover, amount: b.amount,
      foreign: i?.foreign ?? null, trust: i?.trust ?? null, dealer: i?.dealer ?? null, total: i?.total ?? null,
      marginBalance: m?.marginBalance ?? null, shortBalance: m?.shortBalance ?? null,
      dayTradeVolume: d?.dayTradeVolume ?? null,
      dayTradeRatio: d && isNum(d.dayTradeVolume) && b.volume > 0 ? (d.dayTradeVolume / b.volume) * 100 : null,
    };
  });
}

function buildReport(r) {
  const h = r.header;
  const s = r.stats;
  const d = r.decision;
  const sections = [];
  sections.push({
    title: '一、價格與趨勢',
    lines: [
      `${h.name}（${h.code}）${h.date} ${h.isLive ? '盤中' : '收盤'} ${fmt(h.close)} 元，漲跌 ${fmtSigned(h.change)}（${fmtPct(h.changePct)}），成交量 ${fmtInt(h.volume)} 張${isNum(h.turnover) ? `、${fmtInt(h.turnover)} 筆` : ''}。`,
      `均線：MA5 ${fmt(s.ma5)}、MA10 ${fmt(s.ma10)}、MA20 ${fmt(s.ma20)}、MA60 ${fmt(s.ma60)}；趨勢評分 ${d.trendScore ?? '—'}/5（${d.trendLabel}），短線狀態「${d.shortState}」。`,
      `支撐區 ${fmt(d.support.s1)} / ${fmt(d.support.s2)}（20 日 / 60 日最低），壓力區 ${fmt(d.resistance.r1)} / ${fmt(d.resistance.r2)}（20 日 / 60 日最高）。`,
      `RSI(14) ${fmt(s.rsiNow, 1)}、K ${fmt(s.kNow, 1)} / D ${fmt(s.dNow, 1)}、MACD 柱 ${fmt(s.histNow, 2)}、ATR(14) ${fmt(s.atrNow, 2)}、年化波動 ${fmt(s.annVol, 1)}%。`,
    ],
  });
  sections.push({
    title: '二、法人與籌碼',
    lines: [
      r.institutional.available
        ? `三大法人近 5 日合計 ${fmtSigned(s.net5, 0)} 張（外資 ${fmtSigned(r.institutional.foreign5, 0)}、投信 ${fmtSigned(r.institutional.trust5, 0)}、自營 ${fmtSigned(r.institutional.dealer5, 0)}），近 20 日 ${fmtSigned(s.net20, 0)} 張，佔成交量 ${fmtPct(s.r20, 1)} → 籌碼結構「${d.chipStructure}」，主力行為「${d.mainForce}」。`
        : '三大法人資料暫無法取得。',
      isNum(s.marginBalance)
        ? `融資餘額 ${fmtInt(s.marginBalance)} 張（5 日 ${fmtPct(s.marginChange5Pct, 1)}），融券餘額 ${fmtInt(s.shortBalance)} 張（${s.marginDate}）。`
        : '融資融券資料暫無法取得。',
      isNum(s.dayTradeRatio) ? `最近一日當沖比例 ${fmt(s.dayTradeRatio, 1)}%。` : '當沖資料暫無法取得。',
      `20 日 VWAP（主力平均成本）${fmt(s.vwapNow)}，收盤相對 VWAP ${fmtPct(s.vwapDiffPct, 2)}；籌碼健康度 ${fmt(d.chipHealth, 0)} 分（${d.chipHealthLabel}）。`,
    ],
  });
  sections.push({
    title: '三、風險評估',
    lines: [
      `風險等級第 ${d.riskLevel ?? '—'} 級（1 低～5 高），隔日沖風險指數 ${fmt(r.nextDay.index, 0)}%（${r.nextDay.level}），主力風險指數 ${fmt(r.riskRadar.index, 0)}%（${r.riskRadar.label}）。`,
      `多維度綜合評分 ${fmt(r.radar.total, 0)} / 100（${r.radar.grade} 級）；信號燈：${r.signalLight.text}。`,
      r.forecast.available
        ? `依近 60 日報酬統計推估：10 日內上漲(>+2%) 機率 ${fmt(r.forecast.probUp, 0)}%、震盪 ${fmt(r.forecast.probFlat, 0)}%、下跌(<−2%) ${fmt(r.forecast.probDown, 0)}%（統計推估，非預測保證）。`
        : '報酬統計樣本不足，未提供推估路徑。',
    ],
  });
  sections.push({
    title: '四、操作建議（規則式，非投資建議）',
    lines: [r.verdict.conclusion],
  });
  if (r.alerts.length) {
    sections.push({ title: '五、技術警示', lines: r.alerts.map((a) => `[${a.level.toUpperCase()}] ${a.title}：${a.detail}`) });
  }
  return { sections, generatedAt: new Date().toISOString() };
}
