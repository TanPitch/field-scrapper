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
  'วันที่ประกาศ',
  'วันที่ขายออก',
  'ติดจำนอง',
  'ความสูงจากระดับน้ำทะเล',
  'ตำแหน่งบนแผนที่',
  'เปิดใน Google',
] as const;

export type DetailRowKey = (typeof DETAIL_ROWS)[number];

/**
 * Apply the user's hidden set and saved order to the rows the panel built.
 *
 * `order` is a partial list — it only contains rows the user has moved, or all
 * of them if they touched every switch. Anything absent keeps its built-in
 * position rather than being pushed to the top, which is what a naive
 * `sort by indexOf` would do (indexOf returns -1, sorting those rows first).
 */
export function orderRows(
  rows: [string, ReactNode][],
  order: string[],
  hidden: string[],
): [string, ReactNode][] {
  const off = new Set(hidden);
  const kept = rows.filter(([k]) => !off.has(k));
  if (!order.length) return kept;
  const rank = new Map(order.map((k, i) => [k, i]));
  /* Stable: Array#sort is stable in modern engines, so equal ranks — the
     unranked rows — keep the order the panel produced. */
  return kept
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = rank.get(a.r[0]);
      const rb = rank.get(b.r[0]);
      if (ra == null && rb == null) return a.i - b.i;
      if (ra == null) return 1; /* unranked trails the ranked ones */
      if (rb == null) return -1;
      return ra - rb || a.i - b.i;
    })
    .map(x => x.r);
}