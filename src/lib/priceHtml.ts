/* priceHtml.ts — price markup for the map popups.
 *
 * Popups are built as raw HTML strings (MapLibre takes a string, not a React
 * tree), so they cannot use the React PriceHeadline in components/panel. That
 * would leave two places computing "what will the next round fetch", which is
 * exactly the drift this project already guards against for the panel.
 *
 * So the rule itself stays in lib/price.ts and only the *markup* is duplicated
 * here, driven by the same helpers. If the ladder changes, all three surfaces
 * change together.
 */
import { fmtMoneyNow } from '../hooks/useMoney';
import { discountBadge, nextRoundPrice, startPriceOf } from './price';
import type { Parcel } from '../types';

/**
 * Full popup: next-round price leads, start price is demoted to a struck-through
 * aside. The aside is omitted when nothing has come down — a struck-through
 * number with no change behind it reads as "already discounted", which would be
 * a false signal on a lot that never moved.
 */
/**
 * The opening price, for the popup's deed line.
 *
 * Lives here rather than in popups.ts because the invariant it carries - a
 * discounted lot must show what it opened at - is checked against this module.
 * The check cannot import popups.ts without dragging maplibre into the test, so
 * when the markup moved next to the deed number the check could no longer see it
 * and reported 274 phantom problems. One implementation, both callers.
 *
 * Returns nothing when there is no discount: putting an opening price beside a
 * headline that already equals it says the same thing twice.
 */
export function openPriceHtml(next: { discountPct: number; startPrice: number } | null | undefined): string {
  if (!next || next.discountPct <= 0) return '';
  return `<div class="pop-was" data-tip="ราคาเปิด">${fmtMoneyNow(next.startPrice)} ·&nbsp;</div>`;
}

export function priceHtmlFull(p: Parcel, now = Date.now()): string {
  const next = nextRoundPrice(p, now);

  if (!next) {
    return `<div class="pop-price"><span>${fmtMoneyNow(p.price)}</span></div>`;
  }

  // const was = next.discountPct > 0
  //   ? `<span class="pop-was"><s>${fmtMoneyNow(next.startPrice)}</s><i>ราคาเปิด</i></span>`
  //   : '';
  const badge = discountBadge(next.discountPct);
  /* The percentage belongs inside the quoted value. Written as
     `data-tip="ลดราคา" ${...}%` it emitted a bare ${...} as a second attribute,
     so the tag never showed and the markup was invalid. */
  const tag = badge
    ? `<span class="pop-disc" data-tip="ลดราคา ${Math.round(next.discountPct)}%">${badge}</span>`
    : '';

  return `<div class="pop-price flex-col">
            <div class="flex gap-1">
              <span>${fmtMoneyNow(next.price)}</span>
              ${tag}
            </div>
          </div>`;
}

/**
 * Compact popup: next-round price, with the discount percentage beside it.
 * A 0% discount renders nothing at all — there is no "-0%" case, because the
 * badge is suppressed rather than hidden with CSS.
 *
 * `prefix` is markup that belongs inside the price line, currently the land-kind
 * icon. Passed in rather than hardcoded so this module stays free of icon code.
 */
export function priceHtmlCompact(p: Parcel, now = Date.now(), prefix = ''): string {
  const next = nextRoundPrice(p, now);
  const badge = next ? discountBadge(next.discountPct) : null;

  if (!next) {
    return `<div class="pop-price"><span>${prefix}</span><span>${fmtMoneyNow(p.price)}</span></div>`;
  }

  return `<div class="pop-price"><span>${prefix}</span><span>${fmtMoneyNow(next.price)}</span>`
    + (badge ? `<span class="pop-disc">${badge}</span>` : '')
    + `</div>`;
}

/** "เปิด 1.2 ล้าน" style aside for a table cell that has no room for a strike. */
export function priceWasText(p: Parcel, now = Date.now()): string {
  const next = nextRoundPrice(p, now);
  if (!next || next.discountPct <= 0) return '';
  return fmtMoneyNow(startPriceOf(p));
}
