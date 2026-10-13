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
/**
 * Land area as "x ไร่ y งาน z ตร.วา", dropping empty units.
 *
 * Shares one rounding path with splitWah (which the table uses) rather than
 * doing its own `w % 100`: a separate modulo is how 9.400000000000006 survived
 * the table fix and reappeared in the detail panel.
 */
export function fmtRai(w: number): string {
    const [r, n, q] = splitWah(w);
    const p: string[] = [];
    if (r) p.push(r + ' ไร่');
    if (n) p.push(n + ' งาน');
    /* Whole ตร.วา print without a decimal: "5" reads better than "5.0", and the
       trailing .0 was never information. */
    if (q || !p.length) p.push(q + ' ตร.วา');
    return p.join(' ');
  }
export const fmtRaiFromM2 = (m2: number): string => fmtRai(Math.round(m2 / 4));
/* Rounded to 4dp, then trailing zeros dropped.
   w % 100 is exact in binary for the values we handle, but the value reaching
   here has usually been through a division (size in sqm converted, or a
   sum), which is where 9.400000000000006 comes from. toFixed(4) snaps it back to
   a number, and the strip removes a trailing '.0' so 5 shows as 5, not 5.0. */
export const splitWah = (w: number): [number, number, number] => {
  const total = Number(w.toFixed(4));
  let rai = Math.floor(total / 400);
  let rem = Number((total - rai * 400).toFixed(4));
  let ngan = Math.floor(rem / 100);
  /* ตร.ว. is snapped to 2dp and then carried, so 799.9999 does not render as
     "3 งาน 100 ตร.วา" — which is not a size, and is how a float artefact turns
     into a visibly wrong number. */
  let wa = Number((rem - ngan * 100).toFixed(2));
  if (wa >= 100) { ngan += 1; wa = 0; }
  if (ngan >= 4) { rai += 1; ngan = 0; }
  return [rai, ngan, wa];
};

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
