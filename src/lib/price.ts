import type { Parcel, SellRound } from '../types';

/**
 * Change between the latest price and the one before it (the previous round's
 * opening price). Returns null when there is not enough history to compare.
 */
export interface PriceDelta { pct: number; up: boolean }

export function lastDelta(p: Parcel): PriceDelta | null {
  const h = p.hist;
  if (h.length < 2) return null;
  const prev = h[h.length - 2].v;
  const cur = h[h.length - 1].v;
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  /* Drop anything that would display as "+0%" / "-0%" — callers hide the whole
     bottom strip in that case, so an empty delta must never reach them. */
  const rounded = Math.round(pct);
  if (rounded === 0) return null;
  return { pct: rounded, up: pct > 0 };
}

/** "-5%" / "+3%" — always signed, no decimals. */
export const deltaText = (d: PriceDelta): string => `${d.up ? '+' : ''}${d.pct}%`;

/* ------------------------------------------------------------------ ladder */

/**
 * Per-round discount ladder. This is a deliberate mirror of test/pricing.js —
 * that file is the authority, because it is what wrote the numbers in the
 * database. If the two ever disagree, pricing.js wins and this file is wrong.
 *
 *   discount = min(noBidRoundsBefore * 10, 30)
 *   price    = startPrice * (1 - discount/100)
 *
 * Two details that are easy to get wrong and are the reason this is written out
 * rather than inlined:
 *
 *  - A round deepens when LED says nobody bid: the ingest's code 3, or LED's
 *    own outcome label naming ไม่มีผู้สู้ราคา. The label matters because the
 *    report sheet's history rows (ledReport.js) carry the verdict only as the
 *    label, stamped code 10 — the non-deepening งดขาย family — so had the
 *    label not been read, ผบ.2545/2562's relist would never show its -10%.
 *    Every other งดขาย variant (คู่ความขอ, ในนัดที่เหลือ…) neither deepens nor
 *    resets the discount.
 *  - A no-bid round is itself held at the *undiscounted* price, so the count is
 *    incremented after that round's price is computed, never before.
 */
export const DISCOUNT_STEP_PCT = 10;
export const MAX_DISCOUNT_PCT = 30;

/** LED status code for a round held with no bidders. */
const NO_BID_CODE = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LadderRound {
  round: SellRound;
  index: number;
  discountPct: number;
  price: number | null;
}

/** Walk every round and derive its discount and price. */
export function priceLadder(rounds: SellRound[], startPrice: number | null): LadderRound[] {
  let noBidCount = 0;
  return rounds.map((round, index) => {
    const code = round.statusCode == null ? null : Number(round.statusCode);
    const discountPct = Math.min(noBidCount * DISCOUNT_STEP_PCT, MAX_DISCOUNT_PCT);
    const price = startPrice === null ? null : round2(startPrice * (1 - discountPct / 100));
    if (code === NO_BID_CODE || round.status.includes('ไม่มีผู้สู้ราคา')) noBidCount++;
    return { round, index, discountPct, price };
  });
}

/** The opening price a lot started from. */
export const startPriceOf = (p: Parcel): number =>
  /* The announce point, not simply hist[0]. A case LED suspended and re-listed
   * carries its older report rounds ahead of the current cycle, so the oldest
   * point is history's figure, not the listing that is on sale now — the
   * announcement's own point is the one at the publish date. What that point
   * is *anchored to* is decided in liveData (its startPrice export): LED's
   * committee figure when it has one — the scraped start_price column is the
   * biddata page's number and ผบ.2545/2562 proved it can be the wrong source
   * (จปฐ appraisal 80,177,600 instead of committee 98,329,928). */
  p.hist.find((pt) => pt.d === p.announce)?.v ?? p.price;

/**
 * What the next round will fetch, and what it dropped from.
 *
 * `now` defaults to Date.now() and is injectable so the result is testable.
 * Returns null when the lot is no longer buyable — sold, or withdrawn from the
 * listing after running every round without a buyer. Showing a "next round"
 * price for either would be a lie.
 *
 * The next round is the first *dated* round still in the future. Undated rounds
 * are not scheduled yet, so they cannot have a price today; a round that has
 * already passed is history, not a next round.
 */
export function nextRoundPrice(p: Parcel, now: number = Date.now()): {
  price: number;
  startPrice: number;
  discountPct: number;
  date: number;
} | null {
  if (p.status !== 'sale') return null;

  const startPrice = startPriceOf(p);
  if (!startPrice) return null;

  const upcoming = p.rounds.find((r) => r.date != null && r.date >= now);
  if (upcoming?.date == null) return null;

  /* The ladder counts no-bid rounds from the start of the lot, including the
     ones already past, because that count is what set the discount in force. */
  const ladder = priceLadder(p.rounds, startPrice);
  const target = ladder.find((l) => l.round === upcoming);
  const discountPct = target?.discountPct ?? 0;
  const price = target?.price ?? startPrice;

  return { price, startPrice, discountPct, date: upcoming.date };
}

/**
 * Discount to render next to a next-round price, or null when there is no
 * discount. A 0% discount is not shown at all: "-0%" is noise, and the user
 * asked for it to be hidden.
 */
export const discountBadge = (pct: number): string | null =>
  pct > 0 ? `-${Math.round(pct)}%` : null;
