export type SizeMode = 'sets' | 'single';
export interface SizeValue { mode: SizeMode; rai: string; ngan: string; sq: string; single: string }

export const RAI = 400;
export const NGAN = 100;

export function parseShortNumber(v: string): number | null {
  const m = v.trim().toLowerCase().replace(/,/g, '').match(/^([\d.]+)([kmb])?\.?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2] === 'k') n *= 1_000;
  else if (m[2] === 'm') n *= 1_000_000;
  else if (m[2] === 'b') n *= 1_000_000_000;
  return Number.isFinite(n) ? n : null;
}

export function formatCommaInput(v: string): string {
  const stripped = v.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d*)?$/.test(stripped)) return v;
  const [int, dec] = stripped.split('.');
  return Number(int).toLocaleString('en-US') + (dec !== undefined ? '.' + dec : '');
}

/** Types "5k" -> "5,000"; strips the k/m/b suffix while typing. */
export function convertShortInput(v: string): string {
  const parsed = parseShortNumber(v);
  const tail = v.trim().slice(-1).toLowerCase();
  if (parsed != null && (tail === 'k' || tail === 'm' || tail === 'b')) return formatCommaInput(String(Math.round(parsed)));
  return formatCommaInput(v);
}

export function sizeSetsToWah(s: SizeValue): number | null {
  const r = Number(s.rai.replace(/,/g, '')) || 0, n = Number(s.ngan.replace(/,/g, '')) || 0, q = Number(s.sq.replace(/,/g, '')) || 0;
  const total = r * RAI + n * NGAN + q;
  return total > 0 ? total : null;
}

/** Any size value (either mode) as total ตร.วา. */
export function sizeToWah(s: SizeValue): number | null {
  return s.mode === 'single' ? parseShortNumber(s.single) : sizeSetsToWah(s);
}

export function emptySize(): SizeValue {
  return { mode: 'sets', rai: '', ngan: '', sq: '', single: '' };
}

/** Single-value (ตร.วา/ตร.ม.) form of a size value. */
export function sizeToSingle(s: SizeValue): SizeValue {
  const wah = sizeToWah(s);
  return { mode: 'single', rai: '', ngan: '', sq: '', single: wah != null ? formatCommaInput(String(Math.round(wah))) : '' };
}

/** 3-box form (ไร่/งาน/ตร.วา) of a size value. */
export function sizeToSets(s: SizeValue): SizeValue {
  if (s.mode === 'sets') return s;
  const wah = sizeToWah(s);
  if (wah == null) return { mode: 'sets', rai: '', ngan: '', sq: '', single: '' };
  const r = Math.floor(wah / RAI);
  const n = Math.floor((wah % RAI) / NGAN);
  const q = wah % RAI;
  return { mode: 'sets', rai: r ? String(r) : '', ngan: n ? String(n) : '', sq: q ? String(q) : '', single: '' };
}

/** Flip between single and 3-box mode, carrying the value across. */
export function toggleSizeMode(s: SizeValue): SizeValue {
  return s.mode === 'sets' ? sizeToSingle(s) : sizeToSets(s);
}

/** Initial editor state from a stored ตร.วา filter value. */
export function sizeFromWah(wah: number | null): SizeValue {
  if (wah == null) return emptySize();
  return { mode: 'single', rai: '', ngan: '', sq: '', single: formatCommaInput(String(Math.round(wah))) };
}

export function wahLabel(wah: number | null): string {
  return wah != null ? wah.toLocaleString('th-TH') + ' ตร.วา' : 'ไม่ระบุ';
}