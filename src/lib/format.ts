/** Escape text for safe interpolation into HTML strings (used for MapLibre popups). */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const shortNum = (v: number): string =>
  v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));

const dfmt = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
export const dfmtShort = new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' });
export const fdate = (ts: number): string => dfmt.format(new Date(ts));
export const numDate = (ts: number | null | undefined): string => {
  if (ts == null) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
};

/** ตร.วา → "x ไร่ y งาน z ตร.วา" */
export function fmtRai(w: number): string {
  const r = Math.floor(w / 400), n = Math.floor((w % 400) / 100), q = w % 100, p: string[] = [];
  if (r) p.push(r + ' ไร่');
  if (n) p.push(n + ' งาน');
  if (q || !p.length) p.push(q + ' ตร.วา');
  return p.join(' ');
}
export const fmtRaiFromM2 = (m2: number): string => fmtRai(Math.round(m2 / 4));
export const splitWah = (w: number): [number, number, number] => [Math.floor(w / 400), Math.floor((w % 400) / 100), w % 100];

export const fmtDist = (m: number): string =>
  m < 1000 ? Math.round(m) + ' ม.'
    : m < 10000 ? Math.round(m).toLocaleString('en-US') + ' ม.'
      : (m / 1000).toFixed(2).replace(/\.?0+$/, '') + ' กม.';

export interface MoneyOpts { bath: boolean; space: boolean }
export function formatMoney(v: number, { bath, space }: MoneyOpts): string {
  let s = Math.round(v).toLocaleString('th-TH');
  if (space) s = s.replace(/,/g, ', ');
  return (bath ? '฿' : '') + s;
}
export const formatShortMoney = (v: number, bath: boolean): string => (bath ? '฿' : '') + shortNum(v);
