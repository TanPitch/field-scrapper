import maplibregl from 'maplibre-gl';
import { STATUS } from '../data/constants';
import { PARCEL_BY_ID } from '../data/liveData';
import { fmtMoneyNow } from '../hooks/useMoney';
import { esc, fdate, fmtRai, isSqm, numDate, sizeRowLabel } from '../lib/format';
import { openPriceHtml, priceHtmlFull } from '../lib/priceHtml';
import { discountBadge, nextRoundPrice } from '../lib/price';
import { shortPrice } from '../lib/landType';
import { LAND_KIND_LABEL } from '../components/ui/LandKindIcon';
import { parcelPopupBg } from '../lib/parcelColor';
import { getApp } from '../store/useApp';
import type { Parcel, PopupField, PopupKind } from '../types';
import { requireMap } from './mapRef';
import { landKindSvg, unitBadgeCorner } from './parcelLabels';

export const popupKind = (p: Parcel): PopupKind => (p.resell && p.status === 'sale' ? 're' : p.status);

/** 'empty' is "no data", not a land type - it has nothing to say in the table. */
const landKindLabel = (p: Parcel): string | null =>
  p.landKind === 'empty' ? null : LAND_KIND_LABEL[p.landKind];

function popupContent(p: Parcel): { html: string; bg: string } {
  const s = getApp();
  const kind = popupKind(p), cfg = s.popupCfg[kind];
  const row = (l: string, v: string) => `<div class="pop-row"><span>${l}</span><b>${v}</b></div>`;
  let rows = '';
  if (cfg.size) rows += row(sizeRowLabel(p.sizeUnit), fmtRai(p.wah, p.sizeUnit));
  /* Land type sits between the size and the unit price: it is the answer to
     "what is this, and can I build on it", which is the next question after how
     big. It used to be a text chip in the header row, where it competed with the
     status and pushed the unit price off a short popup. */
  if (landKindLabel(p)) rows += row('ประเภทที่ดิน', landKindLabel(p)!);
  /* ประกาศขาย — the date the lists page published this sale order. The field
     list already offers it (วันประกาศขาย in POP_FIELDS) and countRows counted
     it, but no row printed: enabling the field made the popup denser while
     saying nothing. Same wording the detail panel's row uses. */
  if (cfg.announce && p.announce > 0) rows += row('ประกาศขาย', fdate(p.announce));
  /* A ห้องชุด is sold per square metre of floor, so its price per ตร.วา would be
     a division against the whole building's plot - a number that looks real and
     means nothing. Hidden rather than shown as a dash. */
  if (cfg.perWah && !isSqm(p.sizeUnit)) rows += row('ราคา/ตร.วา', fmtMoneyNow(p.perWah));
  rows += row('แหล่งข้อมูล', esc(p.dataSource));
  const bg = parcelPopupBg(p);
  /* The change-since-last-sold chip used to sit under the price. Removed: the
     user asked for the discount against the opening price only, and carrying two
     different percentages in one popup made it ambiguous which was which. The
     ladder's -10/-20/-30% is the one number that means anything here. */

  /* Compact is forced when the user picks แสดงทุกจุด — a popup on every parcel has
     to stay small, so it ignores the per-kind field list. Otherwise it is used
     when only a couple of fields are enabled. */
  const dense = s.popupMode === 'all' || countRows(p, cfg) <= 2;

  if (dense) {
    /* COMPACT — shown only when "แสดงป้ายทุกแปลง" is on. In that mode every
       marker already carries its own label, so the popup has to earn its place
       by being one line and not repeating what the pin says:
         [land-type icon] [short price] [discount] [next round date]
       Hover and click do not open it (see popupMode gating in useMapEvents);
       click still opens the right-hand detail panel. */
    /* landTypeOf returns an icon *name*, and this used to interpolate that name
       straight into the HTML, so the popup printed the word "Building2" where
       the glyph belonged. Rendered through the shared bridge instead, same as
       the map label. The tooltip keeps LED's own Thai wording - that is the
       authority on the property, the icon is only our shorthand for it. */
    const icon = s.showLandKindIcon
      ? `<span class="pop-kind-ic" title="${esc(p.propertyType || LAND_KIND_LABEL[p.landKind])}">${landKindSvg(p.landKind)}</span>`
      : '';
    const next = nextRoundPrice(p, Date.now());
    const disc = next ? discountBadge(next.discountPct) : null;
    const when = next && next.date != null
      ? `<span class="pop-when">${numDate(next.date)}</span>`
      : '';

    return {
      html: `<div class="pop-box pop-box--compact" data-selectable>
        <div class="pop-price">
          ${icon}
          <span>${shortPrice(next ? next.price : p.price)}</span>
          ${disc ? `<span class="pop-disc">${disc}</span>` : ''}
        </div>
        ${when ? `<div class="pop-next">รอบถัดไป ${when}</div>` : ''}
        </div>`,
      bg,
    };
  }

/* full popup: status tag, data source, price, optional land-kind badge.
     The chip is the glyph only - the words moved into the table row. A label
     chip in the header competed with the status for the same line and pushed
     the unit price down; the icon carries the same meaning beside the row that
     now spells it out, and keeps its full name in the tooltip. */
  const kindBadge = s.showLandKindIcon && landKindLabel(p)
    ? `<span class="pop-kind-ic" data-tip="${esc(LAND_KIND_LABEL[p.landKind])}" data-kind="${p.landKind}">${landKindSvg(p.landKind)}</span>`
    : '';
  /* The unit count belongs by the close button. In the chip row it read as
     another land-type tag, sitting among pills that all describe the parcel as
     a whole; here it is the one number about the dot itself. */
  const units = unitBadgeCorner(p);
  /* Deed and opening price are one fact about one lot - which parcel, at what. */
  const openLine = openPriceHtml(nextRoundPrice(p, Date.now()));
  const nameLine = cfg.deed ? esc(p.deed) : '';
  /* The agency is provenance, not a fact about the land, so it goes last and on
     its own line where it cannot be read as another attribute of the parcel. In
     the chip row it sat beside the status and the land-kind icon, where three
     pills of equal weight competed for one line. */
  return {
    html: `<div class="pop-box" data-selectable>
        <div class="pop-tags">
          <span class="pop-tag">${STATUS[kind].th}</span>${kindBadge}${units}
        </div>`
      + priceHtmlFull(p)
      + `<div class="flex">`
        + openLine
        + `<div class="pop-name" data-tip="โฉนด">${nameLine}</div>
        </div>
        ${rows}
    </div>`,
    bg,
  };
}

/** How many detail rows this popup will actually render for the parcel. */
function countRows(p: Parcel, cfg: Record<PopupField, boolean>): number {
  let n = 0;
  if (cfg.size) n++;
  if (cfg.perWah) n++;
  if (cfg.announce) n++;
  if (cfg.soldTs && p.soldTs) n++;
  if (cfg.resale && p.resell) n++;
  if (cfg.deed) n++;
  return n;
}

/* ---------- popup instances (created lazily — they need the maplibre runtime) ---------- */
let popClick: maplibregl.Popup | null = null;
let popHover: maplibregl.Popup | null = null;
/* True only while refreshOpenPopups tears a popup down to rebuild it. Keeps that
   teardown from being mistaken for the user dismissing the popup. */
let rebuilding = false;
let clickPopId: number | null = null;
let hoverPopId: number | null = null;

/** Force a flat (top/bottom/left/right) anchor so the CSS arrow tip lines up. */
function forceFlatAnchor(popup: maplibregl.Popup): void {
  popup.on('open', () => {
    try {
      const map = requireMap();
      const m = /maplibregl-popup-anchor-([\w-]+)/.exec(popup.getElement().className);
      const a = m?.[1];
      if (!a || !a.includes('-')) return;
      const pt = map.project(popup.getLngLat());
      const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
      let flat: 'top' | 'left' | 'right' | 'bottom';
      if (a === 'top-left') flat = pt.y >= pt.x ? 'top' : 'left';
      else if (a === 'top-right') flat = pt.y >= W - pt.x ? 'top' : 'right';
      else if (a === 'bottom-left') flat = H - pt.y >= pt.x ? 'bottom' : 'left';
      else flat = H - pt.y >= W - pt.x ? 'bottom' : 'right';
      popup.options.anchor = flat;
      (popup as unknown as { _update: () => void })._update();
    } catch { /* non-fatal */ }
  });
  popup.on('close', () => { popup.options.anchor = undefined; });
}

function ensurePopups(): { click: maplibregl.Popup; hover: maplibregl.Popup } {
  if (!popClick) {
popClick = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 16, maxWidth: '270px' });
    popClick.on('close', () => { clickPopId = null; if (!rebuilding) onUserDismiss?.(); });
    forceFlatAnchor(popClick);
  }
  if (!popHover) {
    popHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, maxWidth: '270px' });
    popHover.on('close', () => { hoverPopId = null; });
    forceFlatAnchor(popHover);
  }
  return { click: popClick, hover: popHover };
}

export const getClickPopId = (): number | null => clickPopId;

/**
 * Notified when the user dismisses the click popup themselves (the X, or
 * Escape) rather than the app closing it.
 *
 * Registered by the store so dismissing the popup can also drop the land
 * selection: the ring on the marker and the highlight on the table row belong
 * to the popup the user just said goodbye to, so leaving them behind reads as
 * the app ignoring the close. The handler checks for itself — deselect() clears
 * selectedId *before* calling closeClickPopup(), so a programmatic close finds
 * nothing selected and does not recurse.
 */
/* var, not let, and no initializer: the import cycle popups → parcelLabels →
   actions → popups can run actions' body while THIS body is paused on its
   import of parcelLabels, and actions.ts registers the dismiss handler at
   module scope. A `let` binding is still in its temporal dead zone at that
   write — "Cannot access 'onUserDismiss' before initialization" — which broke
   bun test as a whole and would break the browser bundle the same way. A
   hoisted var starts as undefined; the early registration lands and nothing
   ever resets it, because there is no initializer left to re-run. */
var onUserDismiss: (() => void) | null;
export function setPopupDismissHandler(fn: (() => void) | null): void {
  onUserDismiss = fn;
}

export function openClickPopup(p: Parcel | undefined): void {
  if (!p) return;
  /* A pinned popup replaces the hover one. They are two Popup instances at the
     same coordinate, so without this, hovering a marker and then clicking it
     left both on screen, stacked. The hover handler already refuses to open a
     second popup on a pinned marker; this covers the other order. */
  closeHoverPopup();
const { click } = ensurePopups();
  const { html, bg } = popupContent(p);
  clickPopId = p.id;
  click.setLngLat([p.lng, p.lat]).setHTML(html).addTo(requireMap());
  click.getElement().style.setProperty('--pc', bg);
}
export function openHoverPopup(p: Parcel | undefined): void {
  if (!p) return;
const { hover } = ensurePopups();
  const { html, bg } = popupContent(p);
  hoverPopId = p.id;
  hover.setLngLat([p.lng, p.lat]).setHTML(html).addTo(requireMap());
  hover.getElement().style.setProperty('--pc', bg);
}
export function closeHoverPopup(): void { popHover?.remove(); hoverPopId = null; }
export function closeClickPopup(): void { popClick?.remove(); clickPopId = null; }
export function closeAllPopups(): void { closeClickPopup(); closeHoverPopup(); }
export function toggleClickPopup(id: number): void {
  if (clickPopId === id) closeClickPopup();
  else openClickPopup(PARCEL_BY_ID.get(id));
}
/**
 * Re-render open popups after a settings change (fields, colours, price format).
 *
 * Tore down and rebuilt, not setHTML on the live popup.
 *
 * The reported symptom was a settings change repainting the price once and then
 * going stale - the popup needed closing and reopening before it would show the
 * next change. That is the tell: mutating an attached MapLibre popup is not
 * dependable here, and the user's own workaround was exactly the rebuild this
 * now performs. Whatever the reason for the first update landing, every later one
 * now takes the same path as a popup opened fresh.
 *
 * Both ids are read first, because opening the click popup closes the hover one
 * and nulls hoverPopId - reading it afterwards meant a hover popup was never
 * refreshed at all, and a settings change silently closed it instead.
 */
export function refreshOpenPopups(): void {
  const clickId = clickPopId, hoverId = hoverPopId;

  if (clickId != null) {
    const p = PARCEL_BY_ID.get(clickId);
    /* The remove() fires the close handler, which would run the user-dismiss
       path and drop the land selection - the green ring and the highlighted row
       would vanish on a settings change. Suppressed for the duration. */
    rebuilding = true;
    popClick?.remove();
    rebuilding = false;
    if (p) openClickPopup(p);
  }

  if (hoverId != null) {
    const p = PARCEL_BY_ID.get(hoverId);
    popHover?.remove();
    if (p) openHoverPopup(p);
  }
}
export const getHoverPopId = (): number | null => hoverPopId;
