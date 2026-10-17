import maplibregl from 'maplibre-gl';
import { STATUS } from '../data/constants';
import { PARCEL_BY_ID } from '../data/liveData';
import { fmtMoneyNow } from '../hooks/useMoney';
import { esc, fmtRai, numDate } from '../lib/format';
import { priceHtmlFull } from '../lib/priceHtml';
import { discountBadge, nextRoundPrice } from '../lib/price';
import { shortPrice } from '../lib/landType';
import { LAND_KIND_LABEL } from '../components/ui/LandKindIcon';
import { parcelPopupBg } from '../lib/parcelColor';
import { getApp } from '../store/useApp';
import type { Parcel, PopupField, PopupKind } from '../types';
import { requireMap } from './mapRef';
import { landKindSvg, unitBadge } from './parcelLabels';

export const popupKind = (p: Parcel): PopupKind => (p.resell && p.status === 'sale' ? 're' : p.status);

/** 'empty' is "no data", not a land type - it has nothing to say in the table. */
const landKindLabel = (p: Parcel): string | null =>
  p.landKind === 'empty' ? null : LAND_KIND_LABEL[p.landKind];

function popupContent(p: Parcel): { html: string; bg: string } {
  const s = getApp();
  const kind = popupKind(p), cfg = s.popupCfg[kind];
  const row = (l: string, v: string) => `<div class="pop-row"><span>${l}</span><b>${v}</b></div>`;
  let rows = '';
  if (cfg.size) rows += row('ขนาดที่ดิน', fmtRai(p.wah));
  /* Land type sits between the size and the unit price: it is the answer to
     "what is this, and can I build on it", which is the next question after how
     big. It used to be a text chip in the header row, where it competed with the
     status and pushed the unit price off a short popup. */
  if (landKindLabel(p)) rows += row('ประเภทที่ดิน', landKindLabel(p)!);
  if (cfg.perWah) rows += row('ราคา/ตร.วา', fmtMoneyNow(p.perWah));
  // if (cfg.announce) rows += row('ประกาศขาย', fdate(p.announce));
  // if (cfg.soldTs && p.soldTs) rows += row('ขายออกแล้ว', fdate(p.soldTs));
  // if (cfg.resale && p.resell) {
  //   const ev = p.events.find(e => e.label === 'นำกลับมาขายใหม่');
  //   if (ev) rows += row('นำกลับมาขายใหม่', fdate(p.hist[ev.idx].d));
  // }
  // ${esc(p.name)}
  // if (cfg.deed) rows += row('เลขโฉนด', esc(p.deed));
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
    ? `<span class="pop-kind-ic" data-kind="${p.landKind}" title="${esc(LAND_KIND_LABEL[p.landKind])}">${landKindSvg(p.landKind)}</span>`
    : '';
  /* Hand-off links removed: the map is already the map, and Street View is a
     second trip out of the app for something the popup tells you anyway. */
  return {
    html: `<div class="pop-box" data-selectable>
      <div class="pop-tags">
        <span class="pop-tag">${STATUS[kind].th}</span>
        <span class="pop-src">${esc(p.dataSource)}</span>${kindBadge}${unitBadge(p)}
      </div>
      ${priceHtmlFull(p)}
      <div class="pop-name">${cfg.deed ? esc(p.deed) : ""}</div>${rows}
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
    popClick.on('close', () => { clickPopId = null; onUserDismiss?.(); });
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
let onUserDismiss: (() => void) | null = null;
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
/** Re-render open popups after a settings change (fields, colours, price format). */
export function refreshOpenPopups(): void {
  /* Both ids read first. openClickPopup closes the hover popup, which nulls
     hoverPopId - so reading it afterwards meant a hover popup was never
     refreshed, and a settings change silently closed it instead. */
  const clickId = clickPopId, hoverId = hoverPopId;
  if (clickId != null) openClickPopup(PARCEL_BY_ID.get(clickId));
  if (hoverId != null) openHoverPopup(PARCEL_BY_ID.get(hoverId));
}
export const getHoverPopId = (): number | null => hoverPopId;
