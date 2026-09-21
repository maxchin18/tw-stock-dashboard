// 共用 HTTP 抓取：逾時、重試、每個主機的最小請求間隔（避免被交易所限流）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const hostQueues = new Map(); // host -> Promise chain（序列化同主機請求）
const hostLast = new Map();   // host -> 上次請求時間

function schedule(host, minGapMs, task) {
  const prev = hostQueues.get(host) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const wait = minGapMs - (Date.now() - (hostLast.get(host) || 0));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      hostLast.set(host, Date.now());
      return task();
    });
  hostQueues.set(host, next);
  return next;
}

/**
 * 抓取 JSON。
 * @param {string} url
 * @param {{headers?:object, timeoutMs?:number, retries?:number, minGapMs?:number}} opts
 */
export async function fetchJson(url, opts = {}) {
  const { headers = {}, timeoutMs = 20000, retries = 2, minGapMs = 0 } = opts;
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await schedule(host, minGapMs, async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
            signal: ctrl.signal,
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
          try {
            return JSON.parse(text);
          } catch {
            throw new Error(`Non-JSON response from ${host} (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
          }
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}
