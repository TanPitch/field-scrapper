import maplibregl from 'maplibre-gl';
import { STATUS } from '../data/constants';
import { PARCEL_BY_ID } from '../data/mockData';
import { fmtMoneyNow } from '../hooks/useMoney';
import { esc, fmtRai } from '../lib/format';
import { deltaText, lastDelta } from '../lib/price';
import { LAND_KIND_LABEL } from '../components/ui/LandKindIcon';
import { kindIcon } from './parcelLabels';
import { parcelPopupBg } from '../lib/parcelColor';
import { getApp } from '../store/useApp';
import type { Parcel, PopupField, PopupKind } from '../types';
import { requireMap } from './mapRef';

export const popupKind = (p: Parcel): PopupKind => (p.resell && p.status === 'sale' ? 're' : p.status);

function popupContent(p: Parcel): { html: string; bg: string } {
  const s = getApp();
  const kind = popupKind(p), cfg = s.popupCfg[kind];
  const row = (l: string, v: string) => `<div class="pop-row"><span>${l}</span><b>${v}</b></div>`;
  let rows = '';
  if (cfg.size) rows += row('ขนาดที่ดิน', fmtRai(p.wah));
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
  const delta = lastDelta(p);
  const deltaEl = delta
    ? `<span class="pop-delta ${delta.up ? 'is-up' : 'is-down'}">${deltaText(delta)}</span>`
    : '';

  /* Compact is forced when the user picks แสดงทุกจุด — a popup on every parcel has
     to stay small, so it ignores the per-kind field list. Otherwise it is used
     when only a couple of fields are enabled. */
  const dense = s.popupMode === 'all' || countRows(p, cfg) <= 2;

  if (dense) {
    /* two lines: bold price on the pin colour (+ optional land-kind icon),
       then the delta chip */
    const icon = s.showLandKindIcon
      ? `<span class="pop-kind-ic" title="${LAND_KIND_LABEL[p.landKind]}">${kindIcon(p.landKind)}</span>`
      : '';
    return {
      /* no usable delta (+0% / 0% / -0%) -> omit the bottom strip entirely */
      html: `<div class="pop-box pop-box--compact">`
        + `<div class="pop-price">${icon}${fmtMoneyNow(p.price)}</div>`
        + (deltaEl ? `<div class="pop-delta-row">${deltaEl}</div>` : '')
        + `</div>`,
      bg,
    };
  }

  /* full popup: status tag, data source, price, optional land-kind badge */
  const kindBadge = s.showLandKindIcon
    ? `<span class="pop-kind" data-kind="${p.landKind}">${LAND_KIND_LABEL[p.landKind]}</span>`
    : '';
  return {
    html: `<div class="pop-box">`
      + `<span class="pop-tag">${STATUS[kind].th}</span>`
      + `<div class="pop-meta"><span class="pop-src">${esc(p.dataSource)}</span>${kindBadge}</div>`
      + `<div class="pop-price">${fmtMoneyNow(p.price)}${deltaEl}</div>`
      + `<div class="pop-name">${cfg.deed ? esc(p.deed) : ""}</div>${rows}</div>`,
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
    popClick.on('close', () => { clickPopId = null; });
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

export function openClickPopup(p: Parcel | undefined): void {
  if (!p) return;
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
  if (clickPopId != null) openClickPopup(PARCEL_BY_ID.get(clickPopId));
  if (hoverPopId != null) openHoverPopup(PARCEL_BY_ID.get(hoverPopId));
}
export const getHoverPopId = (): number | null => hoverPopId;
