import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, kd, atr, rollingMax, rollingMin, rollingVwap, logReturns } from '../src/analysis/indicators.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);

test('sma：前 n-1 筆為 null，之後為視窗平均', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([10, 20], 3), [null, null]);
});

test('ema：以前 n 筆 SMA 為種子', () => {
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('rsi：StockCharts 經典範例第 14 期 ≈ 70.46', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = rsi(closes, 14);
  assert.equal(r[13], null);
  close(r[14], 70.46, 0.05);
});

test('rsi：連續上漲為 100，連續下跌為 0', () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  const dn = Array.from({ length: 20 }, (_, i) => 100 - i);
  assert.equal(rsi(up, 14)[19], 100);
  assert.equal(rsi(dn, 14)[19], 0);
});

test('macd：長度一致、前段為 null、線性序列 DIF 為正', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { dif, dea, hist } = macd(closes);
  assert.equal(dif.length, 60);
  assert.equal(dif[24], null);
  assert.ok(dif[59] > 0 && dea[59] > 0);
  assert.equal(hist.filter((v) => v != null).length > 0, true);
});

test('kd：價格不動時 RSV=50，K/D 維持 50', () => {
  const n = 15;
  const h = Array(n).fill(10);
  const l = Array(n).fill(10);
  const c = Array(n).fill(10);
  const { k, d } = kd(h, l, c, 9);
  close(k[n - 1], 50);
  close(d[n - 1], 50);
});

test('kd：收在區間最高時 RSV=100，K 向 100 收斂', () => {
  const n = 40;
  const h = Array.from({ length: n }, (_, i) => 10 + i);
  const l = Array.from({ length: n }, (_, i) => 9 + i);
  const c = Array.from({ length: n }, (_, i) => 10 + i);
  const { k, d } = kd(h, l, c, 9);
  assert.ok(k[n - 1] > 99 && d[n - 1] > 98);
});

test('atr：固定振幅時 ATR 等於振幅', () => {
  const n = 30;
  const h = Array(n).fill(12);
  const l = Array(n).fill(10);
  const c = Array(n).fill(11);
  const a = atr(h, l, c, 14);
  assert.equal(a[13], null);
  close(a[14], 2);
  close(a[29], 2);
});

test('rollingMax / rollingMin', () => {
  assert.deepEqual(rollingMax([1, 3, 2, 5, 4], 3), [null, null, 3, 5, 5]);
  assert.deepEqual(rollingMin([1, 3, 2, 5, 4], 3), [null, null, 1, 2, 2]);
});

test('rollingVwap = Σ金額 / Σ股數', () => {
  assert.deepEqual(rollingVwap([100, 200, 300], [10, 10, 10], 2), [null, 15, 25]);
});

test('logReturns', () => {
  const r = logReturns([100, 110, 99]);
  assert.equal(r[0], null);
  close(r[1], Math.log(1.1));
  close(r[2], Math.log(0.9));
});
