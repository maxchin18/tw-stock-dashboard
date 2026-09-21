// 技術指標（純函式，瀏覽器 / Node 共用）。輸入為由舊到新的數值陣列，輸出與輸入等長，不足期數處為 null。

const isNum = (v) => v != null && Number.isFinite(v);

/** 簡單移動平均 */
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  let bad = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) s += v; else bad++;
    if (i >= n) {
      const o = values[i - n];
      if (isNum(o)) s -= o; else bad--;
    }
    if (i >= n - 1 && bad === 0) out[i] = s / n;
  }
  return out;
}

/** 指數移動平均（以前 n 筆 SMA 為起始值） */
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) { out[i] = prev; continue; }
    if (prev == null) {
      seedSum += v; seedCount++;
      if (seedCount === n) { prev = seedSum / n; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI（Wilder 平滑） */
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    if (!isNum(closes[i]) || !isNum(closes[i - 1])) continue;
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    if (i <= n) {
      avgGain += gain / n;
      avgLoss += loss / n;
      if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n;
      avgLoss = (avgLoss * (n - 1) + loss) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/** MACD：DIF = EMA12 − EMA26，DEA(MACD) = EMA9(DIF)，柱 = DIF − DEA */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const dif = closes.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null));
  const firstIdx = dif.findIndex(isNum);
  const dea = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const sub = ema(dif.slice(firstIdx), signal);
    for (let i = 0; i < sub.length; i++) dea[firstIdx + i] = sub[i];
  }
  const hist = dif.map((v, i) => (isNum(v) && isNum(dea[i]) ? v - dea[i] : null));
  return { dif, dea, hist };
}

/** KD（台股慣用：RSV 9 日，K = 2/3 K' + 1/3 RSV，D = 2/3 D' + 1/3 K，初始 50） */
export function kd(highs, lows, closes, n = 9) {
  const k = new Array(closes.length).fill(null);
  const d = new Array(closes.length).fill(null);
  let pk = 50;
  let pd = 50;
  for (let i = n - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (!isNum(highs[j]) || !isNum(lows[j])) { ok = false; break; }
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    if (!ok || !isNum(closes[i])) continue;
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    pk = (2 / 3) * pk + (1 / 3) * rsv;
    pd = (2 / 3) * pd + (1 / 3) * pk;
    k[i] = pk;
    d[i] = pd;
  }
  return { k, d };
}

/** ATR（Wilder） */
export function atr(highs, lows, closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let prev = null;
  let seed = 0;
  let cnt = 0;
  for (let i = 1; i < closes.length; i++) {
    if (!isNum(highs[i]) || !isNum(lows[i]) || !isNum(closes[i - 1])) continue;
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    if (prev == null) {
      seed += tr; cnt++;
      if (cnt === n) { prev = seed / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function rollingMax(values, n) {
  return values.map((_, i) => {
    if (i < n - 1) return null;
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (!isNum(values[j])) return null; if (values[j] > m) m = values[j]; }
    return m;
  });
}

export function rollingMin(values, n) {
  return values.map((_, i) => {
    if (i < n - 1) return null;
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (!isNum(values[j])) return null; if (values[j] < m) m = values[j]; }
    return m;
  });
}

/** 滾動 VWAP = Σ成交金額 / Σ成交股數 */
export function rollingVwap(amounts, shares, n) {
  const out = new Array(amounts.length).fill(null);
  for (let i = n - 1; i < amounts.length; i++) {
    let a = 0;
    let s = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (!isNum(amounts[j]) || !isNum(shares[j])) { ok = false; break; }
      a += amounts[j]; s += shares[j];
    }
    out[i] = ok && s > 0 ? a / s : null;
  }
  return out;
}

export function logReturns(closes) {
  return closes.map((c, i) => (i > 0 && isNum(c) && isNum(closes[i - 1]) && closes[i - 1] > 0 ? Math.log(c / closes[i - 1]) : null));
}

/** 布林通道 */
export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    if (!isNum(mid[i])) continue;
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) ss += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(ss / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}
