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

/** Total square wa for a lot. Condo lots may be in square metres. */
function areaWa(u) {
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
export function representativeUnit(units) {
  if (!Array.isArray(units) || units.length === 0) return null;
  if (units.length === 1) return units[0];

  const sorted = [...units].sort((a, b) => {
    const area = areaWa(b) - areaWa(a); /* larger first */
    if (area !== 0) return area;

    const pa = a.startPrice ?? Number.POSITIVE_INFINITY;
    const pb = b.startPrice ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb; /* cheaper first */

    /* Natural-ish so 1-2 sorts before 1-10. Plain string compare would not,
       and the order_label is what the rest of the UI shows. */
    return naturalCompare(a.orderLabel ?? "", b.orderLabel ?? "");
  });
  return sorted[0];
}

function naturalCompare(a, b) {
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

/** Group lots by the parcel they sit on, so one entry can represent several. */
export function groupUnitsByParcel(lots) {
  const g = new Map();
  for (const l of lots) {
    const k = l.parcelId ?? `lot:${l.id}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(l);
  }
  return g;
}