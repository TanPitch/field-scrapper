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
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { esc, fdate, numDate } from '../lib/format';
import { landTypeOf } from '../lib/landType';
import { nextRoundPrice } from '../lib/price';
import { getApp } from '../store/useApp';
import type { Parcel } from '../types';
import { getMap } from './mapRef';
import { LandKindIcon } from '../components/ui/LandKindIcon';

/** Vertical gap between the parcel dot and the top of the label, in px. */
export const PARCEL_LABEL_OFFSET = 14;

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
  const app = getApp();
  const now = Date.now();

  /* This label is always-on map furniture, not a popup. Per spec it carries:
       [land-type icon] [next-round price] [-N%]   +   next round date
     It previously showed the change-since-last-sold and the parcel's landKind.
     Neither is what this slot is for, and the number a buyer cares about is the
     next round's price, not the opening one. */
  const next = nextRoundPrice(p, now);
  const lt = landTypeOf(p.propertyType);
  const iconEl = app.showLandKindIcon
  ? `<span class="inline-flex flex-none items-center opacity-95 [&>svg]:size-[11px]">${landKindSvg(p.landKind)}</span>`
  : '';
  const title = lt.label ?? p.propertyType ?? 'ที่ดิน';

  /* Next dated round; showDate is the existing toggle for whether to show it. */
  const dated = p.rounds.find((r) => r.date != null && r.date >= now)
    ?? p.rounds.filter((r) => r.date != null).slice(-1)[0];

  const top =
    `<div class="w-full pt-1 text-white" style="background:${statusHex(p)}">
      <div class="flex justify-center">
        <div class="flex items-center gap-[3px]">
          ${iconEl}<span class="whitespace-nowrap text-[12px] font-bold tracking-[0.1em]">${shortMoney(next ? next.price : p.price)}</span>${unitBadge(p)}
        </div>
      </div>
      ${showDate && dated?.date != null ?
        `<div class="text-center whitespace-nowrap text-[8.5px] opacity-85 mt-[-6px]">${numDate(dated.date)}</div>` : ''
      }
    </div>`;

  const bottom = next && next.discountPct > 0 ?
    `<div class="flex justify-center w-full bg-white text-black">
      <div class="whitespace-nowrap text-[11px] font-bold">-${Math.round(next.discountPct)}%</div>
    </div>` : ``;

  return `<div class="flex min-w-[64px] flex-col items-center justify-center overflow-hidden rounded-[5px] shadow-[0_2px_7px_rgba(0,0,0,0.45)]" title="${esc(title)}">${top}${bottom}</div>`;
}

/**
 * The "N ยอด" badge: how many separate assets stand behind this dot.
 *
 * A condominium building is one cadastral parcel sold as several units, so it
 * draws one dot but the table lists several rows. Without this the dot looks
 * identical to a lone unit and the reader cannot tell why the table disagrees
 * with what they clicked.
 *
 * Only rendered when there really is more than one. A single-unit building and
 * ordinary land carry no badge, so the marker's presence means "more here".
 */
export function unitBadge(p: { lotCount?: number | null }): string {
  const n = p.lotCount ?? 1;
  if (n <= 1) return '';
  return `<span class="whitespace-nowrap rounded-full bg-black/45 px-[7px] py-[1px] text-[9.5px] font-semibold leading-none text-white">×${n}</span>`;
}

/**
 * Render a land-type Lucide icon to static SVG markup.
 *
 * The labels are a DOM overlay built from HTML strings, not React, so this
 * bridges the two: the icon component is rendered to a string and injected.
 * Keeps the stroke consistent with the rest of the app and avoids the emoji
 * fallback problem (tofu boxes wherever the emoji font is missing).
 */

export function landKindSvg(kind: string): string {
  if (!kind) return '';
  return renderToStaticMarkup(
    createElement(LandKindIcon, { kind, size: 11 })
  );
}

/** Compact money for the label: 5M not 5.0M, and a ฿ only when the user asked. */
function shortMoney(v: number | null): string {
  if (v == null) return '-';
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

export function syncParcelLabels(parcels: Parcel[], showNextDate: boolean): void {
  const map = getMap();
  const el = ensureHost();
  if (!map || !el) return;

  const live = new Set(parcels.map(p => p.id));
  for (const [id, node] of rows) {
    if (!live.has(id)) { node.remove(); rows.delete(id); }
  }

  parcels.forEach(p => {
    const html = labelHtml(p, showNextDate);
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
