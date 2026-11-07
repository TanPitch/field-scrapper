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
import { groupOf, mentionsGroup } from './group';
import { PARCEL_BY_ID } from '../data/liveData';

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

/**
 * A round that deepened the discount: the ingest's no-bid code 3, or LED's own
 * outcome label naming ไม่มีผู้สู้ราคา (0/10 means "no result yet" carries the
 * same label on the lists page — the label does the deciding).
 */
const isNoBidRound = (round: SellRound): boolean =>
  (round.statusCode != null ? Number(round.statusCode) : null) === NO_BID_CODE
  || round.status.includes('ไม่มีผู้สู้ราคา');

/**
 * Walk every round and derive its discount and price.
 *
 * `announced` is the current listing's publish boundary (the announce point
 * liveData anchors startPriceOf on). Rounds dated before it belong to earlier
 * sale orders LED printed in its history, and history never deepens the
 * ladder: ผบ.754/2562 carries FOUR งดขายไม่มีผู้สู้ราคา rows wedged before its
 * relist announcement, and counting them priced round 2 of the live listing at
 * -30% when LED had not even held round 1 twice. A relist re-sets the floor —
 * it does not add to it.
 *
 * History rows keep the ledger's own price; the ladder's arithmetic is about
 * the listing on sale now.
 */
export function priceLadder(rounds: SellRound[], startPrice: number | null, announced: number | null = null): LadderRound[] {
  let noBidCount = 0;
  return rounds.map((round, index) => {
    const inListing = announced == null || round.date == null || round.date >= announced;
    const discountPct = inListing ? Math.min(noBidCount * DISCOUNT_STEP_PCT, MAX_DISCOUNT_PCT) : 0;
    const price = !inListing || startPrice === null
      ? round.price ?? null
      : round2(startPrice * (1 - discountPct / 100));
    if (inListing && isNoBidRound(round)) noBidCount++;
    return { round, index, discountPct, price };
  });
}

/**
 * No-bid rounds a GROUP-SALE sibling contributes to this parcel's ladder.
 *
 * Lands sold together are one auction event: ผบ.754/2562 sold 24653 and
 * 161371 as one lot. LED prints the round's verdict on only SOME of the
 * siblings' tables — 24653 carries the code-3 งดขายไม่มีผู้สู้ราคา while
 * 161371's own row for the same date still shows the "-" placeholder (and
 * on other pairs, verified 2026-11-07 with lots 10503/10504, it prints the
 * verdict on every sibling). The merge counts a shared no-bid exactly once
 * per land, whichever sibling's table speaks it. Returns 0 for the 99% of
 * lots that are not group sales — the mention gate keeps the sibling scan
 * off every ordinary marker.
 */

/* A round our own table has no verdict for: LED's placeholder family — the
 * "-" behind ยังไม่มีการเปิดประมูล / รอประกาศ — with no held code and no
 * no-bid label. Report rows speak through the label, so a label naming
 * ไม่มีผู้สู้ราคา is a verdict whatever code it rides. */
const PLACEHOLDER_ROUND_STATUS = new Set(['', 'รอประกาศ', 'ยังไม่มีการเปิดประมูล']);
const isSilentRound = (round: SellRound): boolean =>
  !isNoBidRound(round)
  && (round.statusCode == null || Number(round.statusCode) === 0)
  && PLACEHOLDER_ROUND_STATUS.has(round.status.trim());

function siblingNoBidCount(p: Parcel, announced: number, beforeTs: number): number {
  if (!((p.groupCount ?? 1) > 1) && !mentionsGroup(p.remark)) return 0;
  /* Dates our own table has already answered with a VERDICT — any verdict.
   * A date both tables print the no-bid on is the SAME auction event
   * (ผบ.754/2562's 24653+161371 both held their code-3 round 1/6 — own 1 +
   * sibling 1 showed -20% where LED held exactly one no-bid round), and a
   * date our own row answers differently is our row's to answer. But a date
   * our own table covers with a SILENT row — 161371 printing "-" where
   * 24653 prints งดขายไม่มีผู้สู้ราคา — is exactly the share this merge
   * exists for: one event, spoken by the sibling, inherited here. Gifts are
   * keyed by DATE, so a group of three with two verbose siblings still
   * counts the round once. */
  const ownVerdictDates = new Set(p.rounds.filter((r) => r.date != null && !isSilentRound(r)).map((r) => r.date));
  const giftedDates = new Set<number>();
  for (const id of groupOf(p.id)) {
    if (id === p.id) continue;
    const q = PARCEL_BY_ID.get(id);
    if (!q) continue;
    for (const r of q.rounds) {
      if (r.date == null || r.date < announced || r.date >= beforeTs) continue;
      if (ownVerdictDates.has(r.date)) continue;
      if (isNoBidRound(r)) giftedDates.add(r.date);
    }
  }
  return giftedDates.size;
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

  /* The discount in force is built from no-bid rounds inside the CURRENT
     listing only — the announce boundary (priceLadder above); history's
     ไม่มีผู้สู้ราคา rows never re-deepen a relist. Undated rounds count as the
     current listing (see priceLadder), and any round before `upcoming` in
     order is already past. Group-sale siblings share the auction event, so
     their no-bid rounds in the same window deepen this price too. */
  const upcomingIdx = p.rounds.indexOf(upcoming);
  const ownCount = p.rounds.slice(0, upcomingIdx)
    .filter((r) => (r.date == null || r.date >= p.announce) && isNoBidRound(r)).length;
  const discountPct = Math.min(
    (ownCount + siblingNoBidCount(p, p.announce, upcoming.date)) * DISCOUNT_STEP_PCT,
    MAX_DISCOUNT_PCT,
  );
  const price = round2(startPrice * (1 - discountPct / 100));

  return { price, startPrice, discountPct, date: upcoming.date };
}

/**
 * Discount to render next to a next-round price, or null when there is no
 * discount. A 0% discount is not shown at all: "-0%" is noise, and the user
 * asked for it to be hidden.
 */
export const discountBadge = (pct: number): string | null =>
  pct > 0 ? `-${Math.round(pct)}%` : null;
