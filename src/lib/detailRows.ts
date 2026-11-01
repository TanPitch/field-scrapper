import type { ReactNode } from 'react';

/**
 * Every row the detail panel can show, in the order it ships in.
 *
 * The panel builds its rows from the parcel, so a given lot only produces the
 * subset that applies to it (no ระวาง without a กรมธนารักย์ match, no
 * วันที่ขายออก until it sells). This list is the full superset: it is what the
 * settings pane shows switches for, and what the saved order is measured
 * against. A label missing from here simply keeps its built-in position —
 * see orderRows below.
 *
 * Labels are the keys. They double as the setting's stored values, so changing
 * one silently discards a saved order that referenced the old text.
 */
export const DETAIL_ROWS = [
  'ที่ตั้ง',
  'ประเภททรัพย์',
  'หมายเลขคดี',
  'เลขที่โฉนด',
  'ขนาดที่ดิน',
  'ราคาประเมิน (กรมธนารักย์)',
  'ระวาง',
  'หลักประกัน',
  'คู่สมรส หลักประกัน',
  'ราคา ผู้เชี่ยวชาญ',
  'ราคาที่กำหนดโดยคณะกรรมการกำหนดราคาทรัพย์',
  'ราคา เจ้าพนักงานบังคับคดี',
  'ราคา เจ้าพนักงานประเมินราคา',
  'ราคาที่ขายได้',
  'ข้อมูลจาก LED ณ',
  'วันที่ประกาศ',
  'วันที่ขายออก',
  'ติดจำนอง',
  'ความสูงจากระดับน้ำทะเล',
  'ตำแหน่งบนแผนที่',
  'เปิดใน Google',
] as const;

export type DetailRowKey = (typeof DETAIL_ROWS)[number];

/**
 * ขนาดห้อง and ขนาดที่ดิน are one setting, not two.
 *
 * The size row's built-in label changes with the lot (ขนาดที่ดิน for land,
 * ขนาดห้อง for a ห้องชุด) but it would be nonsense to store two hides for
 * what the user sees as one switch, so the alias resolves to the canonical
 * ขนาดที่ดิน for both hiding and ordering. First-match across aliases,
 * falling through to the row's own key.
 */
const ROW_ALIASES: Record<string, readonly string[]> = {
  'ขนาดที่ดิน': ['ขนาดห้อง'],
};

const canonKey = (k: string): string => {
  for (const [c, aliases] of Object.entries(ROW_ALIASES)) {
    if (aliases.includes(k)) return c;
  }
  return k;
};

/**
 * Apply the user's hidden set and saved order to the rows the panel built.
 *
 * `order` is a partial list — it only contains rows the user has moved, or all
 * of them if they touched every switch. Anything absent keeps its built-in
 * position rather than being pushed to the top, which is what a naive
 * `sort by indexOf` would do (indexOf returns -1, sorting those rows first).
 * The hidden test and the rank lookup both go through canonKey, so a saved
 * order written when the row was called ขนาดที่ดิน still orders a ขนาดห้อง.
 */
export function orderRows(
  rows: [string, ReactNode][],
  order: string[],
  hidden: string[],
): [string, ReactNode][] {
  const off = new Set(hidden);
  const rank = new Map(order.map((k, i) => [k, i]));
  const rankOf = (k: string): number | undefined => rank.get(canonKey(k));
  const kept = rows.filter(([k]) => !off.has(canonKey(k)));
  if (!order.length) return kept;
  /* Stable: Array#sort is stable in modern engines, so equal ranks — the
     unranked rows — keep the order the panel produced. */
  return kept
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = rankOf(a.r[0]);
      const rb = rankOf(b.r[0]);
      if (ra == null && rb == null) return a.i - b.i;
      if (ra == null) return 1; /* unranked trails the ranked ones */
      if (rb == null) return -1;
      return ra - rb || a.i - b.i;
    })
    .map(x => x.r);
}