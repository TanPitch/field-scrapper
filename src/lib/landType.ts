/* landType.ts — the land-type icon and label, derived from p.propertyType.
 *
 * The parcel already carries an official ประเภททรัพย์ from LED (ที่ดินพร้อมสิ่งปลูกสร้าง,
 * บ้าน, อาคารพาณิชย์ …). Showing "ติดจำนอง" or a made-up kind instead was less
 * useful than showing what the agency actually says, so this maps that string
 * onto a glyph and a short label.
 *
 * Matching is substring-based on purpose: LED is inconsistent about wording
 * ("ที่ดินพร้อมสิ่งปลูกสร้าง" vs "ที่ดินเกษตรกรรม" vs "ที่ดินว่าง"), so an exact
 * lookup would miss most of them and fall through to a generic dot.
 */
export interface LandType {
  /**
   * Name of the Lucide icon to render, e.g. 'House'. Emoji were used first and
   * read inconsistently — they inherit colour, break under font substitution,
   * and render as tofu boxes on systems without the emoji font. Icon names let
   * the caller pick a size and stroke weight like every other icon in the app.
   */
  icon: 'House' | 'Building2' | 'Factory' | 'Wheat' | 'SquareDashed' | 'LandPlot';
  /** Thai label, or null when the text is not something worth repeating. */
  label: string | null;
  /** Coarse grouping, used for the map's land-kind tint. */
  group: 'building' | 'agricultural' | 'empty' | 'other';
}

/* Order matters: the first match wins, so the more specific building/agri terms
   come before the general "ที่ดิน" catch-all at the end. */
const RULES: Array<[RegExp, LandType['icon'], LandType['group']]> = [
  /* Factory before the general building rule: /โรง/ would otherwise swallow
     โรงงาน and a factory would get a block icon. */
  [/โรงงาน|factory|warehouse|คลังสินค้า/i, 'Factory', 'building'],
  [/บ้าน|ที่อาศัย|เรือน|house/i,            'House', 'building'],
  [/อาคาร|ตึก|สำนัก|โรง|แฟลต|apartment|office|shop|ห้าง/i, 'Building2', 'building'],
  [/โถน|ปั๊ม|ที่ดินธรรมชาติ|ป่า|นา|ไร่|สวน|ฟาร์ม|orchard|crop|เกษตร|ชลประทาน/i, 'Wheat', 'agricultural'],
  [/ที่ดินว่าง|ว่างเปล่า|vacant|barren/i,    'SquareDashed', 'empty'],
  [/ที่ดิน|land|แปลง/i,                       'LandPlot', 'other'],
];

const LABEL_HINTS: Array<[RegExp, string]> = [
  [/บ้าน|ที่อาศัย|เรือน/i,        'ที่อาศัย'],
  [/อาคาร|ตึก|ห้าง|แฟลต|สำนัก|shop|office/i, 'อาคารพาณิชย์'],
  [/โรงงาน|factory|warehouse/i,    'อุตสาหกรรม'],
  [/นา|ไร่|สวน|ฟาร์ม|orchard|crop|เกษตร/i, 'เกษตรกรรม'],
  [/ป่า|โถน|ปั๊ม|ที่ดินธรรมชาติ/i,  'ที่ดินธรรมชาติ'],
  [/ที่ดินว่าง|vacant/i,          'ที่ดินว่าง'],
  [/ที่ดิน|แปลง|land/i,           'ที่ดิน'],
];

/** Resolve LED's ประเภททรัพย์ to an icon, a short label and a tint group. */
export function landTypeOf(propertyType: string | null | undefined): LandType {
  const raw = (propertyType ?? '').trim();
  if (!raw) return { icon: 'LandPlot', label: null, group: 'other' };

  const rule = RULES.find(([re]) => re.test(raw));
  const group = rule?.[2] ?? 'other';
  const icon = rule?.[1] ?? 'LandPlot';
  const label = LABEL_HINTS.find(([re]) => re.test(raw))?.[1] ?? null;
  return { icon, label, group };
}

/** Compact form for the popup's cramped price line. */
export const shortPrice = (v: number | null): string => {
  if (v == null) return '-';
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    /* One decimal, but never a bare .0 — "5.0 ล้าน" is noise, "5 ล้าน" is not. */
    const s = (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return `${s}ล้าน`;
  }
  if (v >= 1_000) return `${Math.round(v / 1_000)}พัน`;
  return String(Math.round(v));
};