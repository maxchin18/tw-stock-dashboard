// 日期工具（瀏覽器 / Node 共用）

/** 民國日期 "115/09/18" -> "2026-09-18" */
export function rocToIso(s) {
  const m = String(s).trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** "20260918" -> "2026-09-18" */
export function compactToIso(s) {
  const m = String(s).trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "2026-09-18" -> "20260918" */
export function isoToCompact(iso) {
  return String(iso).replace(/-/g, '');
}

/** 取得台北時區目前時間的各欄位 */
export function taipeiNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    iso,
    hour,
    minute,
    second: Number(get('second')),
    weekday: weekdayMap[get('weekday')],
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, '0')}:${get('minute')}:${get('second')}`,
  };
}

/**
 * 台股盤勢階段（僅依星期與時間判斷，未考慮國定假日）
 * pre: 平日 08:30–09:00 / open: 09:00–13:30 / after: 13:30–14:30 盤後 / closed: 其他
 */
export function marketPhase(date = new Date()) {
  const t = taipeiNow(date);
  if (t.weekday === 0 || t.weekday === 6) return 'closed';
  if (t.minutes >= 8 * 60 + 30 && t.minutes < 9 * 60) return 'pre';
  if (t.minutes >= 9 * 60 && t.minutes < 13 * 60 + 30) return 'open';
  if (t.minutes >= 13 * 60 + 30 && t.minutes < 14 * 60 + 30) return 'after';
  return 'closed';
}

export const PHASE_LABEL = { pre: '盤前', open: '盤中', after: '盤後', closed: '收盤' };

/** 由 fromIso 起到 toIso 所在月份，每月 1 日的 ISO 清單 */
export function monthStarts(fromIso, toIso) {
  const out = [];
  let [y, m] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** ISO 日期往前推 n 個月（回傳該月 1 日） */
export function monthsAgoIso(iso, n) {
  let [y, m] = iso.split('-').map(Number);
  m -= n;
  while (m <= 0) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** ISO 週序號（用於熱區圖週聚合） */
export function isoWeekKey(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function shortDate(iso) {
  return iso ? iso.slice(5).replace('-', '/') : '';
}
