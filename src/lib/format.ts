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
/**
 * Which unit a size figure is in, and what the row is called.
 *
 * LED writes a ห้องชุด floor area into the same rai/ngan/wa triple it uses for
 * land, so the number alone says nothing. The tempting test is "over 100 วา,
 * therefore square metres" - a condo has no reason to respect the 100-วา ngan
 * and so spills past it. Measured, that is wrong in both directions: 290 condo
 * units come in under 100 วา and 3,150 land lots sit over it. It would mislabel
 * 3,440 lots.
 *
 * LED names the type directly instead - ห้องชุด against ที่ดิน - so that is what
 * is asked. It is exact, and it needs no threshold to defend.
 */
export const isSqm = (unit: string | null | undefined): boolean => unit === 'sqm';

/**
 * The same size in ตร.วา.
 *
 * 1 ไร่ = 400 ตร.วา = 1,600 ตร.ม., so one square metre is a quarter of a square wa.
 * The bottom table's size column is headed ไร่ / งาน / ตร.วา, so a ห้องชุด has to
 * be converted to sit in it truthfully - otherwise the column prints square
 * metres under a heading that says square wa. Everywhere else the figure is left
 * alone: the popup and the detail panel show what LED published, which is the
 * unit they name.
 *
 * Filtering goes through this too. A size filter is stated in ตร.วา and applies
 * to the column it filters, so comparing raw p.wah would exclude a 188.02 ตร.ม.
 * unit from a "40 ตร.ว. and over" search while the table displays it as 47.
 */
export const toSqWa = (w: number | null, unit: string | null | undefined): number | null =>
  w == null ? null : (isSqm(unit) ? w / 4 : w);
export const sizeUnitLabel = (unit: string | null | undefined): string =>
  isSqm(unit) ? 'ตร.ม.' : 'ตร.วา';
/** The row is about the room, not the plot, when the land is a ห้องชุด. */
export const sizeRowLabel = (unit: string | null | undefined): string =>
  isSqm(unit) ? 'ขนาดห้อง' : 'ขนาดที่ดิน';

export function fmtRai(w: number | null, unit: string | null | undefined = null): string {
  /* No land area. "—" says the figure is absent; "0 วา" says the plot is nothing. */
  if (w == null) return '—';
  /* A ห้องชุด figure is floor area in square metres. Splitting 188.02 into
     "1 งาน 88.02" invents a rai-and-ngan reading that carries no meaning for a
     floor, so it is printed whole and the unit named instead. */
  if (isSqm(unit)) return `${w} ${sizeUnitLabel(unit)}`;
  const [r, n, q] = splitWah(w);
    const p: string[] = [];
    if (r) p.push(r + ' ไร่');
    if (n) p.push(n + ' งาน');
    /* Whole ตร.วา print without a decimal: "5" reads better than "5.0", and the
       trailing .0 was never information. */
    if (q || !p.length) p.push(q + ' ' + sizeUnitLabel(unit));
    return p.join(' ');
  }
export const fmtRaiFromM2 = (m2: number): string => fmtRai(Math.round(m2 / 4));
/* Rounded to 4dp, then trailing zeros dropped.
   w % 100 is exact in binary for the values we handle, but the value reaching
   here has usually been through a division (size in sqm converted, or a
   sum), which is where 9.400000000000006 comes from. toFixed(4) snaps it back to
   a number, and the strip removes a trailing '.0' so 5 shows as 5, not 5.0. */
export const splitWah = (w: number | null): [number, number, number] => {
  if (w == null) return [0, 0, 0];
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
