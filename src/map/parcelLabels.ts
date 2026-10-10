/**
 * Compact labels for land parcels, drawn as a DOM overlay instead of MapLibre
 * symbol layers.
 *
 * Why DOM: the label needs two differently-coloured blocks, an inline Lucide
 * icon, and a per-line date — a symbol layer renders one icon per feature and one
 * shared text colour, so it cannot express this.
 *
 * The overlay paints above the whole MapLibre canvas, which is fine here because
 * the map stack is fixed (see RENDER_ORDER in data/constants.ts): the parcel
 * layers are the topmost canvas layers, so the label always lands above its own
 * dot and the UI panels stay above both.
 *
 * Icons come from lucide-react (rendered once to static markup) and every style
 * is a Tailwind utility, so they behave like the rest of the app.
 */
import { Building, Grid2X2 } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LAND_KIND_LABEL } from '../components/ui/LandKindIcon';
import { fdate, numDate } from '../lib/format';
import { deltaText, lastDelta } from '../lib/price';
import { getApp } from '../store/useApp';
import type { LandKind, Parcel } from '../types';
import { getMap } from './mapRef';

/** Vertical gap between the parcel dot and the top of the label, in px. */
export const PARCEL_LABEL_OFFSET = 14;

/* Lucide markup, rendered once. `currentColor` keeps the icon on the block colour. */
const ICON_B = renderToStaticMarkup(createElement(Building, { size: 12, strokeWidth: 2.4, 'aria-hidden': 'true' }));
const ICON_E = renderToStaticMarkup(createElement(Grid2X2, { size: 12, strokeWidth: 2.4, 'aria-hidden': 'true' }));

export const kindIcon = (k: LandKind): string => (k === 'building' ? ICON_B : ICON_E);

let host: HTMLDivElement | null = null;
let rows = new Map<number, HTMLDivElement>();

/**
 * Adopt any host already in the map container rather than blindly creating one.
 *
 * A module reload (Vite HMR) resets the module-level `host`, so a naive
 * "if (!host) create" would append a *second* overlay and leave the first one
 * frozen at its last position. Adopting makes exactly one host survive.
 */
function ensureHost(): HTMLDivElement | null {
  const map = getMap();
  const container = map?.getContainer();
  if (!container) return null;

  const existing = container.querySelector<HTMLDivElement>('.fs-parcel-labels');
  if (existing) {
    host = existing;
    rows = new Map(
      Array.from(existing.children)
        .filter((c): c is HTMLDivElement => c instanceof HTMLDivElement && c.dataset.id != null)
        .map(c => [Number(c.dataset.id), c]),
    );
    return host;
  }

  host?.remove();
  host = document.createElement('div');
  /* overlay: sits over the parcel layers, under the UI panels and the popup */
  host.className = 'fs-parcel-labels pointer-events-none absolute inset-0 z-[10] overflow-hidden';
  container.appendChild(host);
  rows = new Map();
  return host;
}

export function parcelLabelHost(): HTMLDivElement | null { return ensureHost(); }

/* ---------- build ---------- */

function labelHtml(p: Parcel, showDate: boolean): string {
  const d = lastDelta(p);
  const showIcon = getApp().showLandKindIcon;
  const icon = showIcon ? kindIcon(p.landKind) : '';
  const iconEl = icon ? `<span class="inline-flex flex-none opacity-90 [&>svg]:size-[10px]">${icon}</span>` : '';
  const title = LAND_KIND_LABEL[p.landKind];
  const dateLine = showDate && p.soldTs ? `<span class="block whitespace-nowrap text-[8.5px] opacity-85">${numDate(p.soldTs)}</span>` : '';
  const top =
    `<div class="flex w-full flex-col items-center gap-0 px-[6px] pb-[3px] pt-[2px] text-white" style="background:${statusHex(p)}">`
    + `<span class="flex items-center gap-[3px]">${iconEl}`
    + `<span class="whitespace-nowrap text-[12px] font-bold tracking-[0.01em]">${shortMoney(p.price)}</span></span>`
    + dateLine + `</div>`;
  /* note: colours below mirror the previous hand-written CSS — down green, up red */
  const bot = d
    ? `<div class="w-full border border-black/25 bg-[#F1F3EA]/95 px-[6px] py-px text-center text-[10px] font-bold whitespace-nowrap ${d.up ? 'text-[#8c1b1f]' : 'text-[#2f5b1c]'}">${deltaText(d)}</div>`
    : '';
  return `<div class="flex min-w-[54px] flex-col items-center overflow-hidden rounded-[5px] shadow-[0_2px_7px_rgba(0,0,0,0.45)]" title="${title}">${top}${bot}</div>`;
}

function shortMoney(v: number): string {
  const bath = getApp().priceBath;
  const s = v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));
  return bath ? '฿' + s : s;
}

function statusHex(p: Parcel): string {
  const s = getApp();
  if (p.resell && p.status === 'sale') return s.reColor;
  return s.popColors[p.status];
}

/* ---------- sync + position ---------- */

export function syncParcelLabels(parcels: Parcel[], showDate: boolean): void {
  const map = getMap();
  const el = ensureHost();
  if (!map || !el) return;

  const live = new Set(parcels.map(p => p.id));
  for (const [id, node] of rows) {
    if (!live.has(id)) { node.remove(); rows.delete(id); }
  }

  parcels.forEach(p => {
    const html = labelHtml(p, showDate);
    let node = rows.get(p.id);
    if (!node) {
      node = document.createElement('div');
      /* positioned + will-change so panning stays cheap */
      node.className = 'absolute left-0 top-0 flex flex-col items-center gap-px will-change-transform';
      node.setAttribute('data-id', String(p.id));
      el.appendChild(node);
      rows.set(p.id, node);
    }
    if (node.dataset.html !== html) {
      node.innerHTML = html;
      node.dataset.html = html;
      node.setAttribute('data-tip', `${p.name} · ${fdate(p.announce)}`);
    }
  });

  position();
}

/** Project every label to its screen position and apply the overlap rule. */
export function position(): void {
  const map = getMap();
  if (!map || !host) return;
  const allowOverlap = getApp().labelOverlap;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const cw = map.getCanvas().clientWidth, ch = map.getCanvas().clientHeight;
  rows.forEach(node => {
    const p = parcelOf(Number(node.dataset.id));
    if (!p) { node.style.visibility = 'hidden'; return; }
    const pt = map.project([p.lng, p.lat]);
    const w = node.offsetWidth || 64, h = node.offsetHeight || 30;
    const x = Math.round(pt.x), y = Math.round(pt.y + PARCEL_LABEL_OFFSET);
    const off = x < -80 || x > cw + 80 || y < -60 || y > ch + 60;
    let blocked = false;
    if (!off && !allowOverlap) {
      blocked = placed.some(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
      if (!blocked) placed.push({ x, y, w, h });
    }
    node.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
    node.style.visibility = off || blocked ? 'hidden' : 'visible';
  });
}

const byId = new Map<number, Parcel>();
export function registerParcels(list: Parcel[]): void {
  byId.clear();
  list.forEach(p => byId.set(p.id, p));
}
const parcelOf = (id: number): Parcel | undefined => byId.get(id);

/** Show or hide the whole overlay (matches the old layer visibility rule). */
export function setParcelLabelVisibility(on: boolean): void {
  if (host) host.style.display = on ? '' : 'none';
  if (!on) rows.clear();
}
