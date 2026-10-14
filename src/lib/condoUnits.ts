/**
 * A condominium building is one cadastral parcel sold as several units. The
 * map draws a single dot for it - the dot cannot show five things at once - so
 * one unit has to stand in for the building. This decides which.
 *
 * The cascade is size, then price, then order_label, applied in that priority:
 *
 *   1. size    - the largest unit is the one that tells you what the building
 *                is. A 40 วา unit and a 5 วา unit are not comparable, and
 *                picking the small one makes the marker misrepresent the asset.
 *   2. price   - among equal sizes, the cheaper one. Two units the same size are
 *                otherwise arbitrary, and the cheapest is the more useful thing
 *                to surface on a marker.
 *   3. order_label - the final tiebreak. LED assigns it and it is stable
 *                across runs, so the marker does not jump between units when
 *                prices move.
 *
 * Order matters and is not arbitrary: without the last step a price change
 * would reshuffle which unit owns the marker, which reads as the map being
 * wrong rather than the data changing.
 */

/** One saleable unit. Shape is deliberately loose - it is built from whatever
 *  the API returns for a lot, not from the Parcel type, because a unit is a lot
 *  and lots are not parcels once a building is split. */
export interface CondoUnit {
  id: number;
  /** LED's ลำดับการขาย, e.g. "1 - 3". The stable tiebreak. */
  orderLabel?: string | null;
  parcelId?: number | null;
  rai?: number | null;
  ngan?: number | null;
  wa?: number | null;
  /** "wa" for square wa, "sqm" for square metres (condominium units). */
  sizeUnit?: string | null;
  startPrice?: number | null;
}

/** Total square wa for a lot. Condo lots may be in square metres. */
function areaWa(u: CondoUnit): number {
  if (u.sizeUnit === "sqm") {
    /* 1 ตร.วา is 400 ตร.ม. Mixing units would make an sqm unit compare as if
       it were tiny, so convert rather than compare raw numbers. */
    return (u.wa ?? 0) / 400;
  }
  return (u.rai ?? 0) * 400 + (u.ngan ?? 0) * 100 + (u.wa ?? 0);
}

/**
 * @param units units sharing one parcel. Each needs rai/ngan/wa, sizeUnit,
 *               startPrice and orderLabel.
 * @returns the unit that represents the building, or null when there are none.
 */
export type CondoUnitOrder = "orderLabel" | "priceAsc" | "priceDesc" | "sizeAsc" | "sizeDesc";

/**
 * Which unit stands in for a condominium building on the map.
 *
 * One primary criterion, then LED's order_label as the tiebreak - always.
 *
 *   orderLabel   first by ลำดับการขาย
 *   priceAsc     cheapest first
 *   priceDesc    dearest first
 *   sizeAsc      smallest first
 *   sizeDesc     largest first
 *
 * Every option falls through to order_label rather than to the other size or
 * price axis. If size is what you asked to sort by, breaking a size tie on
 * price would quietly re-introduce the criterion you did not choose - two
 * equal-area units differing by a few thousand baht would pick whichever is
 * dearer, which is not what "smallest first" means. order_label is stable
 * across runs, so the marker also cannot jump when prices move.
 *
 * @param order which criterion leads. Defaults to largest-first.
 */
export function representativeUnit<T extends CondoUnit>(
  units: T[] | null | undefined,
  order: CondoUnitOrder = "sizeDesc",
): T | null {
  if (!Array.isArray(units) || units.length === 0) return null;
  if (units.length === 1) return units[0];

  const cmp: Record<CondoUnitOrder, (a: CondoUnit, b: CondoUnit) => number> = {
    sizeDesc: (a, b) => areaWa(b) - areaWa(a),
    sizeAsc: (a, b) => areaWa(a) - areaWa(b),
    priceAsc: (a, b) => byPrice(a, b, 1),
    priceDesc: (a, b) => byPrice(a, b, -1),
    orderLabel: () => 0,
  };

  const lead = cmp[order] ?? cmp.sizeDesc;
  const sorted = [...units].sort((a: CondoUnit, b: CondoUnit) => {
    const d = lead(a, b);
    if (d !== 0) return d;
    return naturalCompare(a.orderLabel ?? "", b.orderLabel ?? "");
  });
  return sorted[0];
}

/**
 * Compare on published price, with an unpriced lot always last.
 *
 * `dir` is +1 for cheapest-first and -1 for dearest-first. Handling the null
 * case explicitly rather than substituting ±Infinity is what keeps "no price
 * published" out of both ends: Infinity would make an unpriced unit look the
 * cheapest under one direction and the dearest under the other, so the marker
 * would flip between them depending only on which sort the user picked. A lot
 * LED has not priced is not an extreme, it is simply unknown.
 */
function byPrice(a: CondoUnit, b: CondoUnit, dir: 1 | -1): number {
  const pa = a.startPrice;
  const pb = b.startPrice;
  if (pa == null && pb == null) return 0;
  if (pa == null) return 1;
  if (pb == null) return -1;
  return (pa - pb) * dir;
}

function naturalCompare(a: string, b: string): number {
  const ax = a.match(/(\d+)|(\D+)/g) ?? [];
  const bx = b.match(/(\d+)|(\D+)/g) ?? [];
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const x = ax[i], y = bx[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The rows the map should draw as dots.
 *
 * The collection holds one entry per lot, so a condominium building arrives as
 * N rows on the same coordinate. Drawing them all would stack N identical dots
 * on one point — visually a single dot anyway, but N features fighting over the
 * same pixel, N labels, and N click targets for what is one place on the map.
 *
 * So the map draws one row per parcel, using the representative unit chosen by
 * the user's criterion, and carries `units` so the label and popup can say how
 * many assets stand behind the dot. The table keeps every row; only the marker
 * collapses.
 *
 * `lotCount` is trusted when present because the API computed it with the same
 * join that produced these rows. It falls back to the group size, which is what
 * happens with fixture data that never went through the API.
 */
export function markerRows<T extends CondoUnit & { id: number }>(
  lots: T[],
  order: CondoUnitOrder = "sizeDesc",
): { id: number; parcelKey: number | string; unit: T; units: T[] }[] {
  const out: { id: number; parcelKey: number | string; unit: T; units: T[] }[] = [];
  for (const units of groupUnitsByParcel(lots).values()) {
    if (units.length === 1) {
      const u = units[0];
      out.push({ id: u.id, parcelKey: u.parcelId ?? `lot:${u.id}`, unit: u, units });
    } else {
      const rep = representativeUnit(units, order);
      if (!rep) continue;
      out.push({ id: rep.id, parcelKey: rep.parcelId ?? `lot:${rep.id}`, unit: rep, units });
    }
  }
  return out;
}
/** Group lots by the parcel they sit on, so one entry can represent several. */
export function groupUnitsByParcel<T extends CondoUnit>(
  lots: T[],
): Map<number | string, T[]> {
  const g = new Map<number | string, T[]>();
  for (const l of lots) {
    const k: number | string = l.parcelId ?? `lot:${l.id}`;
    if (!g.has(k)) g.set(k, []);
    /* get() after set() is never undefined, but the type checker cannot see
       that, and an optional chain here would hide a real miss later. */
    g.get(k)?.push(l);
  }
  return g;
}