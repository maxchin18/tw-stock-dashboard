// 台股即時主力分析儀表板 — 零相依套件 Node.js 伺服器
// 靜態檔案 + REST API + SSE 即時推播
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadBundle, getQuote, resolveStock, searchSecurities, getMarketIndexes,
} from './src/sources/index.js';
import { analyze } from './src/analysis/engine.js';
import { marketPhase, taipeiNow } from './src/util/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SRC_DIR = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  sendJson(res, status, { error: err.message || String(err) });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  let base = PUBLIC_DIR;
  if (rel.startsWith('/src/analysis/') || rel.startsWith('/src/util/')) {
    base = SRC_DIR;
    rel = rel.slice('/src'.length);
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(base, rel));
  if (!filePath.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- SSE 即時推播 ---------- */

function intervalForPhase(phase) {
  if (phase === 'open') return 5000;
  if (phase === 'pre' || phase === 'after') return 10000;
  return 60000;
}

async function handleStream(req, res, url) {
  const code = url.searchParams.get('code');
  let stock;
  try {
    stock = await resolveStock(code);
  } catch (err) {
    return sendError(res, err);
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\n\n`);
  const send = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('hello', { code: stock.code, name: stock.name, market: stock.market, phase: marketPhase(), serverTime: taipeiNow().time });

  let closed = false;
  let lastKey = null;
  let indexTick = 0;
  const tick = async () => {
    if (closed) return;
    const phase = marketPhase();
    try {
      const q = await getQuote(stock.code, stock.market);
      const key = `${q.date}|${q.time}|${q.price}|${q.volume}|${q.asks?.[0]?.price}|${q.bids?.[0]?.price}`;
      if (key !== lastKey) {
        lastKey = key;
        send('quote', { quote: q, phase, serverTime: taipeiNow().time });
      } else {
        send('tick', { phase, serverTime: taipeiNow().time, at: q.fetchedAt });
      }
      if (indexTick++ % 6 === 0) {
        const { indexes } = await getMarketIndexes();
        send('indexes', { indexes });
      }
    } catch (err) {
      send('error', { message: err.message });
    }
    if (!closed) timer = setTimeout(tick, intervalForPhase(phase));
  };
  let timer = setTimeout(tick, 50);
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  req.on('close', () => { closed = true; clearTimeout(timer); clearInterval(ping); });
}

/* ---------- 路由 ---------- */

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/search') {
      return sendJson(res, 200, { results: await searchSecurities(url.searchParams.get('q') || '', 12) });
    }
    if (p === '/api/resolve') {
      return sendJson(res, 200, await resolveStock(url.searchParams.get('code')));
    }
    if (p === '/api/quote') {
      const stock = await resolveStock(url.searchParams.get('code'));
      const quote = await getQuote(stock.code, stock.market);
      return sendJson(res, 200, { stock, quote, phase: marketPhase() });
    }
    if (p === '/api/market') {
      const { indexes, fetchedAt } = await getMarketIndexes();
      return sendJson(res, 200, { indexes, fetchedAt, phase: marketPhase(), serverTime: taipeiNow().time });
    }
    if (p === '/api/bundle') {
      const bundle = await loadBundle(url.searchParams.get('code'));
      return sendJson(res, 200, { ...bundle, phase: marketPhase() });
    }
    if (p === '/api/analysis') {
      const bundle = await loadBundle(url.searchParams.get('code'));
      const analysis = analyze(bundle);
      return sendJson(res, 200, { meta: bundle.meta, phase: marketPhase(), analysis });
    }
    if (p === '/api/stream') {
      return handleStream(req, res, url);
    }
    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, time: taipeiNow().time, phase: marketPhase() });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendError(res, err);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`台股即時主力分析儀表板  →  http://${shown}:${PORT}`);
  console.log(`資料來源：TWSE MIS / TWSE STOCK_DAY / TPEx / FinMind${process.env.FINMIND_TOKEN ? '（已設定 FINMIND_TOKEN）' : ''}`);
});
