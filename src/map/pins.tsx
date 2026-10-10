import maplibregl from 'maplibre-gl';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons, type LucideIcon } from 'lucide-react';
import type { ExpressionSpecification } from 'maplibre-gl';
import { CctvPopup } from '../components/pins/CctvPopup';
import { MIN_ZOOM } from '../data/constants';
import { PARCEL_BY_ID, ALL_PARCELS } from '../data/mockData';
import { select, showRight } from '../store/actions';
import { getApp, patchApp } from '../store/useApp';
import type { BBox, CctvPin, LngLat, MarkerSize, SearchHit, SensorPin, TransportPin } from '../types';
import { fc, getMap, hasLayer, ptF, setSourceData, setVisibility } from './mapRef';

/* ---------- bbox helpers ---------- */
export const inBbox = (ll: LngLat, bb: BBox | null): boolean =>
  !!bb && ll[0] >= bb[0] && ll[0] <= bb[2] && ll[1] >= bb[1] && ll[1] <= bb[3];

export function currentBbox(): BBox | null {
  const map = getMap(); if (!map) return null;
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

const markerImageHalf = 5; // 36px canvas / pixelRatio 2 / 2
const smallLandRadius = 7.5; // current small land dot radius
/** เล็ก / ปกติ / ใหญ่ → a multiplier for every marker image and selection ring. */
const MARKER_SCALE: Record<MarkerSize, number> = {
  small: 0.72, normal: 1, large: (smallLandRadius * 2) / (markerImageHalf * 2),
};
export const markerScale = (): number => MARKER_SCALE[getApp().markerSize] ?? 1;
export function applyPinMarkerSize(): void {
  const map = getMap(); if (!map) return;
  const s = markerScale();
  try {
    if (hasLayer('fs-cctv-pin')) map.setLayoutProperty('fs-cctv-pin', 'icon-size', s);
    if (hasLayer('fs-flood-pin')) map.setLayoutProperty('fs-flood-pin', 'icon-size', s);
    if (hasLayer('fs-transport-pin')) map.setLayoutProperty('fs-transport-pin', 'icon-size', s);
    if (hasLayer('fs-search-ic')) map.setLayoutProperty('fs-search-ic', 'icon-size', searchIconSize());
    if (hasLayer('fs-pin-sel-ring')) map.setPaintProperty('fs-pin-sel-ring', 'circle-radius', 12 * s);
    if (hasLayer('fs-sel-ring')) map.setPaintProperty('fs-sel-ring', 'circle-radius', 17 * s);
    if (hasLayer('fs-search-sel-ring')) map.setPaintProperty('fs-search-sel-ring', 'circle-radius', 17 * s);
  } catch { /* style not ready */ }
}

/* ---------- canvas / lucide icons ---------- */
type Glyph = (g: CanvasRenderingContext2D) => void;
function mkIcon(draw: Glyph): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 36;
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  return c;
}
const CCTV_PATHS = [
  'M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97',
  'M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z',
  'M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15',
  'M2 21v-4',
  'M7 9h.01',
] as const;
const DROPLET_PATHS = ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'] as const;
const BUS_NODES = [
  ['path', { d: 'M8 6v6' }], ['path', { d: 'M15 6v6' }], ['path', { d: 'M2 12h19.6' }],
  ['path', { d: 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3' }],
  ['circle', { cx: 7, cy: 18, r: 2 }], ['path', { d: 'M9 18h5' }], ['circle', { cx: 16, cy: 18, r: 2 }],
] as const;
const METRO_NODES = [
  ['rect', { x: 4, y: 3, width: 16, height: 16, rx: 2 }], ['path', { d: 'M4 11h16' }], ['path', { d: 'M12 3v8' }],
  ['path', { d: 'm8 19-2 3' }], ['path', { d: 'm18 22-2-3' }], ['path', { d: 'M8 15h.01' }], ['path', { d: 'M16 15h.01' }],
] as const;
const TRAIN_NODES = [
  ['path', { d: 'M8 3.1V7a4 4 0 0 0 8 0V3.1' }], ['path', { d: 'm9 15-1-1' }], ['path', { d: 'm15 15 1-1' }],
  ['path', { d: 'M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z' }], ['path', { d: 'm8 19-2 3' }], ['path', { d: 'm16 19 2 3' }],
] as const;
const CAR_NODES = [
  ['path', { d: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2' }],
  ['circle', { cx: 7, cy: 17, r: 2 }], ['path', { d: 'M9 17h6' }], ['circle', { cx: 17, cy: 17, r: 2 }],
] as const;
const lucidePaths = (paths: readonly string[]): Glyph => g => {
  g.save();
  g.translate(18, 18);
  g.scale(0.72, 0.72);
  g.translate(-12, -12);
  g.lineWidth = 2 / 0.72;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const d of paths) g.stroke(new Path2D(d));
  g.restore();
};
const lucideNodes = (nodes: readonly (readonly [string, any])[]): Glyph => g => {
  g.save();
  g.translate(18, 18);
  g.scale(0.72, 0.72);
  g.translate(-12, -12);
  g.lineWidth = 2 / 0.72;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [tag, a] of nodes) {
    if (tag === 'path') g.stroke(new Path2D(a.d as string));
    else if (tag === 'circle') { g.beginPath(); g.arc(a.cx as number, a.cy as number, a.r as number, 0, Math.PI * 2); g.stroke(); }
    else if (tag === 'rect') {
      g.beginPath();
      const rx = (a.rx as number | undefined) ?? 0;
      if ((g as any).roundRect) (g as any).roundRect(a.x as number, a.y as number, a.width as number, a.height as number, rx);
      else g.rect(a.x as number, a.y as number, a.width as number, a.height as number);
      g.stroke();
    }
  }
  g.restore();
};
const busGlyph: Glyph = lucideNodes(BUS_NODES);
const metroGlyph: Glyph = lucideNodes(METRO_NODES);
const trainGlyph: Glyph = lucideNodes(TRAIN_NODES);
const carGlyph: Glyph = lucideNodes(CAR_NODES);
const camGlyph: Glyph = lucidePaths(CCTV_PATHS);
const dropGlyph: Glyph = lucidePaths(DROPLET_PATHS);
const circleIcon = (bg: string, ring: string, glyph: Glyph): HTMLCanvasElement => mkIcon(g => {
  g.beginPath(); g.arc(18, 18, 15, 0, 7); g.fillStyle = bg; g.fill();
  g.lineWidth = 2.4; g.strokeStyle = ring; g.stroke();
  g.strokeStyle = ring; g.fillStyle = ring; g.lineWidth = 2.2; glyph(g);
});

/** Raw `<svg>` inner markup for a lucide-react icon. */
export function lucideInner(Icon: LucideIcon): string {
  const svg = renderToStaticMarkup(createElement(Icon));
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}
/** Lucide icon by (kebab-case) name → svg string; falls back to map-pin. */
export function lucideSvgByName(name: string): string {
  const pascal = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  const Icon = (icons as Record<string, LucideIcon>)[pascal] ?? icons.MapPin;
  return renderToStaticMarkup(createElement(Icon, {size: 13}));
}

/* ---------- POI markers: black disc + the glyph for the place type ---------- */
const poiImageIds = new Set<string>();
const poiPending = new Set<string>();

/**
 * Rasterises a lucide SVG onto a black disc. `currentColor` is rewritten first —
 * lucide renders with `stroke="currentColor"`, which resolves to *black* inside
 * an <img> data URL and would be invisible on the black disc.
 */
function poiCanvas(iconName: string): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = c.height = 36;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.beginPath(); g.arc(18, 18, 15, 0, 7); g.fillStyle = '#0C0E0C'; g.fill();
  g.lineWidth = 2.4; g.strokeStyle = 'rgba(241,243,238,.5)'; g.stroke();

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { g.drawImage(img, 9, 9, 18, 18); resolve(c); };
    img.onerror = () => resolve(c);
    const svg = lucideSvgByName(iconName).replace(/currentColor/g, '#F1F3EE');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Registers `fs-poi-<iconName>` once; the symbol layer resolves it by id. */
function ensurePoiImage(iconName: string): void {
  const map = getMap(); if (!map) return;
  const id = 'fs-poi-' + iconName;
  if (poiImageIds.has(id) || poiPending.has(id)) return;
  poiPending.add(id);
  void poiCanvas(iconName)
    .then(c => {
      poiPending.delete(id);
      if (poiImageIds.has(id)) return;
      try {
        const data = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height);
        map.addImage(id, { width: c.width, height: c.height, data: new Uint8Array(data.data) }, { pixelRatio: 2 });
        poiImageIds.add(id);
        /* symbols already drawn without the image re-resolve on the next frame */
        map.triggerRepaint();
      } catch { /* style not ready */ }
    })
    .catch(() => poiPending.delete(id));
}

/* ---------- mock pin data (TODO: replace with real API clients) ---------- */
export function seedPins(): void {
  const map = getMap(); if (!map) return;
  const c = map.getCenter().toArray() as LngLat, sp = () => Math.random() - 0.5;
  let seq = 0;
  const cctvList: CctvPin[] = Array.from({ length: 10 }, (_, i) => ({
    id: 'CCTV-' + ++seq, name: 'กล้อง CCTV จุดที่ ' + (i + 1), ll: [c[0] + sp() * 0.05, c[1] + sp() * 0.032],
  }));
  const names = ['สถานีวัดน้ำท่วม', 'สถานีวัดอัตราไหลเขื่อน', 'เซ็นเซอร์ระดับน้ำ', 'ด่านวัดน้ำ', 'สถานีเฝ้าระวังน้ำ'];
  const sensList: SensorPin[] = Array.from({ length: 6 }, (_, i) => {
    const type: SensorPin['type'] = i % 3 === 2 ? 'dam' : 'flood';
    const crit = +(3.2 + Math.random() * 1.6).toFixed(2);
    const lv = +(crit * (0.45 + Math.random() * 0.4)).toFixed(2);
    const hist: SensorPin['hist'] = [];
    let v = Math.max(0.2, lv - 1.3 - Math.random());
    for (let h = 23; h >= 0; h--) {
      v = Math.max(0.1, Math.min(crit - 0.08, v + (Math.random() - 0.4) * 0.16));
      hist.push({ t: Date.now() - h * 3600e3, lv: +v.toFixed(2) });
    }
    hist[23].lv = lv;
    return {
      id: (type === 'dam' ? 'DAM-' : 'FLD-') + ++seq, type, name: names[i % names.length] + ' ' + (i + 1),
      detail: type === 'dam' ? 'จุดวัดอัตราไหลประตูระบายน้ำเขื่อน (ข้อมูลตัวอย่าง)' : 'จุดวัดระดับน้ำ/น้ำท่วมภาคสนาม (ข้อมูลตัวอย่าง)',
      ll: [c[0] + sp() * 0.055, c[1] + sp() * 0.036], lv, crit, hist,
    };
  });
  const transportList: TransportPin[] = (['bus', 'metro', 'train', 'car'] as TransportPin['mode'][]).flatMap((mode, i) =>
    Array.from({ length: 2 }, (_, j) => ({
      id: mode.toUpperCase() + '-' + (i * 2 + j + 1), mode,
      name: (mode === 'bus' ? 'ป้ายรถเมล์ ' : mode === 'metro' ? 'สถานีรถไฟฟ้า ' : mode === 'train' ? 'สถานีรถไฟ ' : 'ลานจอดรถ ') + (i * 2 + j + 1),
      ll: [c[0] + sp() * 0.05, c[1] + sp() * 0.032] as LngLat,
    })),
  );
  patchApp({ cctvList, sensList, transportList });
}

/* Water caption sits below its droplet. Raise this to move the caption lower. */
export const WATER_LABEL_OFFSET = 12;

/* ---------- layers ---------- */
/** Cached caption images: key → map image id. Cleared whenever layers are rebuilt. */
const floodLabelImages = new Map<string, string>();
let floodImgSeq = 0;

/** Render a caption as a rounded, bordered chip (same look as the old DOM label). */
function floodLabelChip(text: string, isDam: boolean): HTMLCanvasElement {
  const scale = 2;
  const font = "700 10px 'Noto Sans Thai', sans-serif";
  const padX = 7, padY = 3, r = 5;
  const probe = document.createElement('canvas').getContext('2d');
  probe!.font = font;
  const w = Math.ceil(probe!.measureText(text).width) + padX * 2;
  const h = Math.ceil(10 + padY * 2);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  /* chip */
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
  else ctx.rect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = isDam ? '#21162F' : '#071B2D';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isDam ? '#9B8CFF' : '#4C9AFF';
  ctx.stroke();
  /* text */
  ctx.fillStyle = isDam ? '#E2DCFF' : '#D7E9FF';
  ctx.fillText(text, padX, h / 2 + 0.5);
  return c;
}

export function initPinLayers(): void {
  const map = getMap(); if (!map) return;
  const addSrc = (id: string) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc([]) }); };
  const addImg = (id: string, img: HTMLCanvasElement) => {
    if (map.hasImage(id)) return;
    const data = (img.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, img.width, img.height);
    map.addImage(id, { width: img.width, height: img.height, data: new Uint8Array(data.data) }, { pixelRatio: 2 });
  };
  const iconLayout = { 'icon-size': markerScale(), 'icon-allow-overlap': true, 'icon-ignore-placement': true };

  /* Layer creation order is the render order, bottom → top:
   search → cctv → bus → water → land parcel (added later, in layers.ts).
   Search markers sit at the bottom so a hit never covers a pin that is already
   on the map. Do not reorder these blocks without re-checking the whole stack. */

  /* search markers — internet hits only, glyph chosen from the place type */
  addSrc('fs-search-src');
  if (!map.getLayer('fs-search-ic')) {
    map.addLayer({
      id: 'fs-search-ic', type: 'symbol', source: 'fs-search-src',
      layout: {
        'icon-image': ['concat', 'fs-poi-', ['coalesce', ['get', 'ic'], 'map-pin']],
        'icon-size': searchIconSize(), 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    });
  }
  addSrc('fs-search-sel-src');
  if (!map.getLayer('fs-search-sel-ring')) {
    map.addLayer({
      id: 'fs-search-sel-ring', type: 'circle', source: 'fs-search-sel-src',
      paint: { 'circle-radius': 17 * markerScale(), 'circle-color': 'rgba(184,241,63,0)', 'circle-stroke-color': '#B8F13F', 'circle-stroke-width': 3, 'circle-stroke-opacity': 1 },
    });
  }

  /* cctv */
  floodLabelImages.clear();
  floodImgSeq = 0;
  addSrc('fs-cctv-src');
  addImg('fs-ic-cctv', circleIcon('#0C0E0C', '#FFC94D', camGlyph));
  if (!map.getLayer('fs-cctv-pin')) map.addLayer({ id: 'fs-cctv-pin', type: 'symbol', source: 'fs-cctv-src', layout: { ...iconLayout, 'icon-image': 'fs-ic-cctv' } });

  /* transport */
  addSrc('fs-transport-src');
  addImg('fs-ic-bus', circleIcon('#0C0E0C', '#FFC94D', busGlyph));
  addImg('fs-ic-metro', circleIcon('#0C0E0C', '#4C9AFF', metroGlyph));
  addImg('fs-ic-train', circleIcon('#0C0E0C', '#9B8CFF', trainGlyph));
  addImg('fs-ic-car', circleIcon('#0C0E0C', '#E5484D', carGlyph));
  if (!map.getLayer('fs-transport-pin')) {
    map.addLayer({
      id: 'fs-transport-pin', type: 'symbol', source: 'fs-transport-src',
      layout: { ...iconLayout, 'icon-image': ['match', ['get', 'mode'], 'bus', 'fs-ic-bus', 'metro', 'fs-ic-metro', 'train', 'fs-ic-train', 'fs-ic-car'] },
    });
  }

  /* water — droplet and its caption, caption on top of the droplet */
  addSrc('fs-flood-src');
  addImg('fs-ic-drop', circleIcon('#0C0E0C', '#4C9AFF', dropGlyph));
  addImg('fs-ic-drop-dam', circleIcon('#0C0E0C', '#9B8CFF', dropGlyph));
  if (!map.getLayer('fs-flood-pin')) map.addLayer({ id: 'fs-flood-pin', type: 'symbol', source: 'fs-flood-src', layout: { ...iconLayout, 'icon-image': ['match', ['get', 'type'], 'dam', 'fs-ic-drop-dam', 'fs-ic-drop'] } });
  if (!map.getLayer('fs-flood-lbl')) {
    map.addLayer({
      id: 'fs-flood-lbl', type: 'symbol', source: 'fs-flood-src',
      layout: {
        'icon-image': ['get', 'img'], 'icon-size': 1,
        'icon-anchor': 'top', 'icon-offset': [0, WATER_LABEL_OFFSET],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    });
  }

  /* cctv */
  floodLabelImages.clear();
  /* transient flash ring (gotoItem) and the persistent cctv/bus/water selection */
  addSrc('fs-sel-src');
  if (!map.getLayer('fs-sel-ring')) map.addLayer({ id: 'fs-sel-ring', type: 'circle', source: 'fs-sel-src', paint: { 'circle-radius': 17 * markerScale(), 'circle-color': 'rgba(184,241,63,0)', 'circle-stroke-color': '#B8F13F', 'circle-stroke-width': 3, 'circle-stroke-opacity': 1 } });
  addSrc('fs-pin-sel-src');
  if (!map.getLayer('fs-pin-sel-ring')) {
    map.addLayer({
      id: 'fs-pin-sel-ring', type: 'circle', source: 'fs-pin-sel-src',
      paint: { 'circle-radius': 12 * markerScale(), 'circle-color': 'rgba(184,241,63,0)', 'circle-stroke-color': '#B8F13F', 'circle-stroke-width': 3, 'circle-stroke-opacity': 1 },
    });
  }

  /* interactions */
  map.on('click', 'fs-cctv-pin', e => {
    const f = e.features?.[0];
    if (f && f.geometry.type === 'Point') openCctv(String(f.properties?.id), f.geometry.coordinates as LngLat);
  });
  map.on('click', 'fs-flood-pin', e => { const f = e.features?.[0]; if (f) openSensor(String(f.properties?.id)); });
  map.on('click', 'fs-transport-pin', e => { const f = e.features?.[0]; if (f) openTransport(String(f.properties?.id)); });
  map.on('click', 'fs-search-ic', e => { const f = e.features?.[0]; if (f && onSearchPick) onSearchPick(String(f.properties?.id)); });
  (['fs-cctv-pin', 'fs-flood-pin', 'fs-transport-pin'] as const).forEach(ly => {
    map.on('mouseenter', ly, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', ly, () => { map.getCanvas().style.cursor = ''; });
  });
}

/* ---------- data sync ---------- */
/** Map image id for a caption, rendering and caching it on first use. */
function floodLabelImageId(text: string, isDam: boolean): string {
  const key = (isDam ? 'dam' : 'fld') + '|' + text;
  const hit = floodLabelImages.get(key);
  if (hit) return hit;
  const map = getMap();
  const id = `fs-lbl-${isDam ? 'dam' : 'fld'}-${++floodImgSeq}`;
  if (!map) return id;
  const chip = floodLabelChip(text, isDam);
  const data = chip.getContext('2d')!.getImageData(0, 0, chip.width, chip.height);
  map.addImage(id, { width: data.width, height: data.height, data: new Uint8Array(data.data) }, { pixelRatio: 2 });
  floodLabelImages.set(key, id);
  return id;
}

export function syncPinData(): void {
  const s = getApp(), bb = currentBbox();
  const zoomOk = getApp().zoom >= MIN_ZOOM;
  setSourceData('fs-cctv-src', fc(s.cctvOn && zoomOk ? s.cctvList.filter(p => inBbox(p.ll, bb)).map(p => ptF(p.ll, { id: p.id })) : []));
  setSourceData('fs-flood-src', fc(s.sensOn && zoomOk ? s.sensList.filter(p => inBbox(p.ll, bb)).map(p => {
    const text = `${p.lv.toFixed(2)} ม.`;
    return ptF(p.ll, { id: p.id, type: p.type, lb: text, img: floodLabelImageId(text, p.type === 'dam') });
  }) : []));
  setSourceData('fs-transport-src', fc(s.transportOn && zoomOk ? s.transportList.filter(p => inBbox(p.ll, bb)).map(p => ptF(p.ll, { id: p.id, mode: p.mode, name: p.name })) : []));
  try { getMap()?.setPaintProperty('fs-transport-pin', 'icon-opacity', s.transportOpacity); } catch { /* layer missing */ }
  ['fs-transport-pin'].forEach(ly => setVisibility(ly, s.transportOn && zoomOk));
  try { getMap()?.setPaintProperty('fs-flood-pin', 'icon-opacity', s.sensOpacity); } catch { /* property n/a */ }
  try { getMap()?.setPaintProperty('fs-flood-lbl', 'icon-opacity', s.sensOpacity); } catch { /* property n/a */ }
  ['fs-cctv-pin'].forEach(ly => setVisibility(ly, s.cctvOn && zoomOk));
  ['fs-flood-pin', 'fs-flood-lbl'].forEach(ly => setVisibility(ly, s.sensOn && zoomOk));
}

/* ---------- CCTV popup + selection ---------- */
let camPopup: maplibregl.Popup | null = null;
let camRoot: Root | null = null;
export function syncPinSelectionRing(): void {
  const s = getApp(), sel = s.pinSel;
  if (s.zoom < MIN_ZOOM) { setSourceData('fs-pin-sel-src', fc([])); return; }
  const pin = s.cctvList.find(p => p.id === sel) ?? s.sensList.find(p => p.id === sel) ?? s.transportList.find(p => p.id === sel);
  setSourceData('fs-pin-sel-src', pin ? fc([ptF(pin.ll, { id: pin.id })]) : fc([]));
}

export function openCctv(id: string, at?: LngLat): void {
  const map = getMap();
  const st = getApp().cctvList.find(p => p.id === id);
  if (!map || !st) return;
  camPopup?.remove();
  camRoot?.unmount();
  const host = document.createElement('div');
  camRoot = createRoot(host);
  camRoot.render(createElement(CctvPopup, { pin: st, onZoom: () => map.flyTo({ center: st.ll, zoom: Math.max(map.getZoom(), 17), essential: true }) }));
  camPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '270px', offset: 12 }).setLngLat(at ?? st.ll).setDOMContent(host).addTo(map);
  patchApp({ pinSel: st.id });
  showRight('cctv');
}
export function openSensor(id: string): void {
  if (!getApp().sensList.some(s => s.id === id)) return;
  patchApp({ pinSel: id });
  showRight('sensor');
}
export function openTransport(id: string): void {
  const st = getApp().transportList.find(t => t.id === id);
  if (!st) return;
  patchApp({ pinSel: id });
  showRight('transport');
}

/* ---------- search integration ---------- */
let onSearchPick: ((rid: string) => void) | null = null;
export const setSearchPickHandler = (fn: ((rid: string) => void) | null): void => { onSearchPick = fn; };
export const getSearchPickHandler = (): ((rid: string) => void) | null => onSearchPick;

/** The chosen search marker is drawn ~30% larger, so selection reads at a glance. */
function searchIconSize(): ExpressionSpecification {
  const s = markerScale();
  return ['case', ['boolean', ['get', 'sel'], false], s * 1.3, s] as ExpressionSpecification;
}

/** last plotted positions, so a selection ring can be placed without a re-plot */
const searchPts = new Map<string, { ll: LngLat; ic: string }>();
let searchSelId: string | null = null;

/** Internet hits only — local results keep their own markers. */
export function plotSearch(items: { id: string; kind: string; ll: LngLat; ic?: string }[]): void {
  searchPts.clear();
  items.forEach(it => {
    searchPts.set(it.id, { ll: it.ll, ic: it.ic ?? '' });
    ensurePoiImage(it.ic || 'map-pin');
  });
  if (searchSelId && !searchPts.has(searchSelId)) searchSelId = null;
  setSourceData('fs-search-src', fc(items.map(it => ptF(it.ll, { id: it.id, ic: it.ic ?? '', sel: it.id === searchSelId }))));
  syncSearchSelectionRing();
}

/** Rings the chosen internet hit. Pass null (or `clearSearchSelection`) to clear. */
export function setSearchSelection(rid: string | null): void {
  searchSelId = rid;
  const map = getMap();
  try { if (map && hasLayer('fs-search-ic')) map.setLayoutProperty('fs-search-ic', 'icon-size', searchIconSize()); } catch { /* style not ready */ }
  /* re-plot so the `sel` flag lands on the right feature */
  setSourceData('fs-search-src', fc([...searchPts].map(([id, v]) => ptF(v.ll, { id, ic: v.ic, sel: id === searchSelId }))));
  syncSearchSelectionRing();
}

/** Drops the green ring around a selected internet marker. */
export function clearSearchSelection(): void {
  if (searchSelId == null) return;
  setSearchSelection(null);
}

function syncSearchSelectionRing(): void {
  const hit = searchSelId ? searchPts.get(searchSelId) : null;
  setSourceData('fs-search-sel-src', hit ? fc([ptF(hit.ll)]) : fc([]));
}

let ringRaf = 0;
/** Flash the green selection ring (1 s fade). */
export function ringAt(at: LngLat | null): void {
  const map = getMap();
  if (!at || !map || !hasLayer('fs-sel-ring')) return;
  cancelAnimationFrame(ringRaf);
  setSourceData('fs-sel-src', fc([ptF(at)]));
  const t0 = performance.now();
  /* leave the layer exactly as the marker-size toggle expects to find it */
  const settle = () => {
    setSourceData('fs-sel-src', fc([]));
    try {
      map.setPaintProperty('fs-sel-ring', 'circle-stroke-opacity', 1);
      map.setPaintProperty('fs-sel-ring', 'circle-radius', 17 * markerScale());
    } catch { /* style not ready */ }
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / 1000);
    if (t >= 1) { settle(); return; }
    try {
      map.setPaintProperty('fs-sel-ring', 'circle-stroke-opacity', 1 - t);
      map.setPaintProperty('fs-sel-ring', 'circle-radius', 17 * markerScale() + t * 16);
    } catch { return; }
    ringRaf = requestAnimationFrame(step);
  };
  ringRaf = requestAnimationFrame(step);
}

/** CCTV + sensor hits inside the bbox for a lower-cased query. */
export function matchPins(ql: string, bb: BBox | null = currentBbox()): SearchHit[] {
  const s = getApp(), out: SearchHit[] = [];
  const hit = (p: { name: string; id: string; ll: LngLat }) => (p.name + ' ' + p.id).toLowerCase().includes(ql) && inBbox(p.ll, bb);
  if (s.cctvOn) s.cctvList.filter(hit).forEach(p => out.push({ kind: 'cctv', id: p.id, ll: p.ll, name: p.name, sub: p.id + ' · กล้อง CCTV' }));
  if (s.sensOn) s.sensList.filter(hit).forEach(p => out.push({ kind: 'sensor', id: p.id, ll: p.ll, name: p.name, sub: p.id + ' · ' + (p.type === 'dam' ? 'อัตราไหลเขื่อน' : 'เซ็นเซอร์น้ำ') }));
  if (s.transportOn) s.transportList.filter(hit).forEach(p => out.push({ kind: 'transport', id: p.id, ll: p.ll, name: p.name, sub: p.id + ' · ' + (p.mode === 'bus' ? 'รถเมล์' : p.mode === 'metro' ? 'รถไฟฟ้า' : p.mode === 'train' ? 'รถไฟ' : 'รถยนต์') }));
  return out;
}
/** Parcels + pins matching a query inside the bbox (right-panel search). */
export function matchAll(query: string, bb: BBox | null = currentBbox()): SearchHit[] {
  const ql = query.toLowerCase(), out: SearchHit[] = [];
  if (getApp().landOn) {
    for (const p of ALL_PARCELS) {
      if (out.length >= 14) break;
      if (p.name.toLowerCase().includes(ql) && inBbox([p.lng, p.lat], bb)) out.push({ kind: 'land', id: String(p.id), ll: [p.lng, p.lat], name: p.name, sub: 'แปลงที่ดิน' });
    }
  }
  out.push(...matchPins(ql, bb));
  return out.slice(0, 14);
}

let placeMarker: maplibregl.Marker | null = null;

/** Below this zoom a result is too small to be useful, so the view zooms in. */
const SEARCH_MIN_ZOOM = 12;
const SEARCH_FOCUS_ZOOM = 15;

/** Pan to a result — and only zoom when the map is currently too far out. */
export function flyToResult(ll: LngLat): void {
  const map = getMap(); if (!map) return;
  const z = map.getZoom();
  if (z < SEARCH_MIN_ZOOM) map.flyTo({ center: ll, zoom: SEARCH_FOCUS_ZOOM, essential: true });
  else map.easeTo({ center: ll, duration: 600, essential: true });
}

/**
 * Fly to / open a search result of any kind.
 * `ring` is only needed when the caller has no persistent selection ring of its
 * own — passing it alongside `setSearchSelection` draws two rings on one point.
 */
export function gotoItem(it: SearchHit, ring = true): void {
  const map = getMap(); if (!map) return;
  if (it.kind === 'land') select(Number(it.id), { fly: false });
  else if (it.kind === 'cctv') openCctv(it.id, it.ll);
  else if (it.kind === 'sensor') openSensor(it.id);
  else if (it.kind === 'transport') openTransport(it.id);
  else {
    placeMarker?.remove();
    const pop = new maplibregl.Popup({ offset: 14 });
    const body = document.createElement('div');
    const b = document.createElement('b'); b.textContent = it.name; b.style.font = "600 12px 'Noto Sans Thai'";
    const sub = document.createElement('div'); sub.textContent = it.sub; sub.style.cssText = "font:400 10.5px 'Noto Sans Thai';opacity:.75;margin-top:2px";
    body.append(b, sub);
    pop.setDOMContent(body);
    placeMarker = new maplibregl.Marker({ color: '#0C0E0C' }).setLngLat(it.ll).setPopup(pop).addTo(map);
    setTimeout(() => placeMarker?.togglePopup(), 700);
  }
  if (ring) ringAt(it.ll);
  flyToResult(it.ll);
}

export const parcelById = (id: number) => PARCEL_BY_ID.get(id);
