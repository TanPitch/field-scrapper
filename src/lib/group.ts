/* group.ts — LED group sale ("ขายรวม") sibling resolution.
 *
 * Lives in lib (not store/actions) so price.ts can use it: actions.ts drags
 * the MapLibre modules along, and price.ts is imported by bun tests that have
 * no DOM. They are also the same logic the map rings need.
 */
import { ALL_PARCELS, PARCEL_BY_ID } from '../data/liveData';

export const mentionsGroup = (remark?: string | null): boolean =>
  !!remark && /ขายรวม|รวม\s*\d+\s*แปลง|ขายต่อเนื่อง|พร้อมกัน/.test(remark);

/**
 * Parcels that sell as one lot with `id`.
 *
 * LED ships the group in two shapes, and ผบ.754/2562 (deeds 24653 ↔ 161371) is
 * why both must count: both lots have group_lot_count NULL and the same
 * case/year/order, and the ONLY evidence is the remark text — "ขายรวมกับที่ดินโฉนดเลขที่
 * 161371, ราคาประเมินรวม …". So a parcel is group-eligible when the plating
 * count says so OR its remark says ขายรวม; structured siblings come from the
 * case+year+order key, and any deed number named in an eligible remark joins
 * by deed number even if its own key or count disagrees. An order-key sibling
 * with neither signal stays out — same order, different land.
 */
export function groupOf(id: number): number[] {
  const p = PARCEL_BY_ID.get(id);
  if (!p) return [id];
  if (!p.caseNoRaw && !mentionsGroup(p.remark)) return [id];
  const key = (q: typeof p) => [q.province, q.caseNoRaw ?? '', q.caseYear ?? '', q.order ?? ''].join('|');
  const pool = ALL_PARCELS.filter((q) =>
    (q.groupCount ?? 1) > 1 || mentionsGroup(q.remark)
      ? q.caseNoRaw && key(q) === key(p)
      : false);
  if (!pool.length) return [id];
  const sibs = new Set<number>([id]);
  for (const q of pool) sibs.add(q.id);
  /* Deed-number references are exact: the remark names the sibling's โฉนด, so
     take them regardless of key or count. Scanning ALL_PARCELS once per select
     is a few ms over ~6k parcels — cheaper than maintaining an index for a
     lookup that happens one click at a time. */
  const byDeed = new Map(ALL_PARCELS.map((q) => [q.deedNo, q]));
  for (const q of [p, ...pool]) {
    if (!q || !mentionsGroup(q.remark)) continue;
    for (const m of q.remark!.matchAll(/โฉนด[^ ]*\s*เลขที่\s*([0-9,\s]{4,})/g)) {
      for (const d of m[1].split(/[,\s]+/).filter(Boolean)) {
        const other = byDeed.get(d);
        if (other && other.id !== id) sibs.add(other.id);
      }
    }
  }
  return sibs.size > 1 ? [...sibs] : [id];
}
