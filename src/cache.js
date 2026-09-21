// 記憶體 + 磁碟快取（.cache/），支援 TTL 與「抓取失敗時回傳舊資料」
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE_DIR = path.resolve(process.env.CACHE_DIR || '.cache');
const mem = new Map();

function fileFor(key) {
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
  return path.join(CACHE_DIR, `${h}.json`);
}

function readDisk(key) {
  try {
    const raw = fs.readFileSync(fileFor(key), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.key === key) return obj;
  } catch { /* miss */ }
  return null;
}

function writeDisk(entry) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fileFor(entry.key), JSON.stringify(entry));
  } catch (e) {
    console.warn('[cache] write failed:', e.message);
  }
}

/**
 * 取得快取或重新抓取。
 * @param {string} key
 * @param {number} ttlMs 有效期間（毫秒）；Infinity 表示永久
 * @param {() => Promise<any>} fetcher
 * @returns {Promise<{value:any, cached:boolean, stale:boolean, at:number}>}
 */
export async function getOrFetch(key, ttlMs, fetcher) {
  const now = Date.now();
  let entry = mem.get(key) || readDisk(key);
  if (entry && (ttlMs === Infinity || now - entry.at < ttlMs)) {
    mem.set(key, entry);
    return { value: entry.value, cached: true, stale: false, at: entry.at };
  }
  try {
    const value = await fetcher();
    entry = { key, at: now, value };
    mem.set(key, entry);
    writeDisk(entry);
    return { value, cached: false, stale: false, at: now };
  } catch (err) {
    if (entry) {
      console.warn(`[cache] fetch failed for ${key}, serving stale (${err.message})`);
      return { value: entry.value, cached: true, stale: true, at: entry.at };
    }
    throw err;
  }
}

export function clearCache() {
  mem.clear();
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}
