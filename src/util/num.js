// 數值工具（瀏覽器 / Node 共用，不可 import Node 內建模組）

/** 將 "1,234.50" / "+205.00" / "-" / "X0.00" 轉成數字；無法解析回傳 null */
export function num(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s).replace(/,/g, '').trim();
  if (t === '' || t === '-' || t === '--' || t === 'X' || t === 'N/A') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function round(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return null;
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 百分比變化 (a - b) / b * 100 */
export function pctChange(a, b) {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / b) * 100;
}

export function sum(arr) {
  let s = 0;
  for (const v of arr) if (v != null && Number.isFinite(v)) s += v;
  return s;
}

export function mean(arr) {
  const xs = arr.filter((v) => v != null && Number.isFinite(v));
  return xs.length ? sum(xs) / xs.length : null;
}

/** 樣本標準差 */
export function std(arr) {
  const xs = arr.filter((v) => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

export function last(arr, n = 1) {
  return arr.slice(Math.max(0, arr.length - n));
}

/** 標準常態累積分佈函數 Φ(x)（Abramowitz–Stegun 近似，誤差 < 7.5e-8） */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** 千分位格式化 */
export function fmt(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtSigned(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = round(v, d); // 先四捨五入再決定正負，避免顯示 "-0"
  const s = fmt(Math.abs(r), d);
  return r > 0 ? `+${s}` : r < 0 ? `-${s}` : s;
}

export function fmtPct(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${fmtSigned(v, d)}%`;
}
