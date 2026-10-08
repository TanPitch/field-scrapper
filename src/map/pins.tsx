import maplibregl from 'maplibre-gl';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons, type LucideIcon } from 'lucide-react';
import { CctvPopup } from '../components/pins/CctvPopup';
import { MIN_ZOOM } from '../data/constants';
import { PARCEL_BY_ID, ALL_PARCELS } from '../data/mockData';
import { select, showRight } from '../store/actions';
import { getApp, patchApp } from '../store/useApp';
import type { BBox, CctvPin, LngLat, SearchHit, SensorPin, TransportPin } from '../types';
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
export const markerScale = (): number => (getApp().markerSize === 'large' ? (smallLandRadius * 2) / (markerImageHalf * 2) : 1);
export function applyPinMarkerSize(): void {
  const map = getMap(); if (!map) return;
  const s = markerScale();
  try {
    if (hasLayer('fs-cctv-pin')) map.setLayoutProperty('fs-cctv-pin', 'icon-size', s);
    if (hasLayer('fs-flood-pin')) map.setLayoutProperty('fs-flood-pin', 'icon-size', s);
    if (hasLayer('fs-transport-pin')) map.setLayoutProperty('fs-transport-pin', 'icon-size', s);
    if (hasLayer('fs-search-ic')) map.setLayoutProperty('fs-search-ic', 'icon-size', s);
    if (hasLayer('fs-pin-sel-ring')) map.setPaintProperty('fs-pin-sel-ring', 'circle-radius', 12 * s);
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
const placeGlyph: Glyph = g => { g.beginPath(); g.arc(18, 15, 4.4, 0, 7); g.fill(); g.beginPath(); g.moveTo(18, 19); g.lineTo(18, 26); g.stroke(); };
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
  return renderToStaticMarkup(createElement(Icon));
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

/* ---------- layers ---------- */
export function initPinLayers(): void {
  const map = getMap(); if (!map) return;
  const addSrc = (id: string) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc([]) }); };
  const addImg = (id: string, img: HTMLCanvasElement) => {
    if (map.hasImage(id)) return;
    const data = (img.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, img.width, img.height);
    map.addImage(id, { width: img.width, height: img.height, data: new Uint8Array(data.data) }, { pixelRatio: 2 });
  };
  const iconLayout = { 'icon-size': markerScale(), 'icon-allow-overlap': true, 'icon-ignore-placement': true };

  /* CCTV + sensors */
  addSrc('fs-cctv-src'); addSrc('fs-flood-src');
  addImg('fs-ic-cctv', circleIcon('#0C0E0C', '#FFC94D', camGlyph));
  addImg('fs-ic-drop', circleIcon('#0C0E0C', '#4C9AFF', dropGlyph));
  addImg('fs-ic-drop-dam', circleIcon('#0C0E0C', '#9B8CFF', dropGlyph));
  if (!map.getLayer('fs-cctv-pin')) map.addLayer({ id: 'fs-cctv-pin', type: 'symbol', source: 'fs-cctv-src', layout: { ...iconLayout, 'icon-image': 'fs-ic-cctv' } });
  if (!map.getLayer('fs-flood-pin')) map.addLayer({ id: 'fs-flood-pin', type: 'symbol', source: 'fs-flood-src', layout: { ...iconLayout, 'icon-image': ['match', ['get', 'type'], 'dam', 'fs-ic-drop-dam', 'fs-ic-drop'] } });

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

  /* search result icons + selection ring */
  addSrc('fs-search-src');
  addImg('fs-ic-s-land', circleIcon('#F5F6F4', '#8B9096', () => {}));
  addImg('fs-ic-s-cctv', circleIcon('#0C0E0C', '#FFC94D', camGlyph));
  addImg('fs-ic-s-sensor', circleIcon('#0C0E0C', '#4C9AFF', dropGlyph));
  addImg('fs-ic-s-place', circleIcon('rgba(76,154,255,.16)', '#4C9AFF', placeGlyph));
  addImg('fs-ic-s-transport', circleIcon('#0C0E0C', '#FF9F43', busGlyph));
  if (!map.getLayer('fs-search-ic')) {
    map.addLayer({ id: 'fs-search-ic', type: 'symbol', source: 'fs-search-src', layout: { 'icon-image': ['match', ['get', 'kind'], 'land', 'fs-ic-s-land', 'cctv', 'fs-ic-s-cctv', 'sensor', 'fs-ic-s-sensor', 'transport', 'fs-ic-s-transport', 'fs-ic-s-place'], 'icon-size': markerScale(), 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  }
  addSrc('fs-sel-src');
  if (!map.getLayer('fs-sel-ring')) map.addLayer({ id: 'fs-sel-ring', type: 'circle', source: 'fs-sel-src', paint: { 'circle-radius': 15, 'circle-color': 'rgba(184,241,63,0)', 'circle-stroke-color': '#B8F13F', 'circle-stroke-width': 3, 'circle-stroke-opacity': 1 } });
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
  ensureLabelLayer();
  map.on('move', refreshFloodLabelPositions);
  map.on('zoom', refreshFloodLabelPositions);
  map.on('resize', refreshFloodLabelPositions);
}

/* ---------- data sync ---------- */
let floodLabelDivs = new Map<string, HTMLDivElement>();
let floodLabelPins: SensorPin[] = [];
let labelLayer: HTMLDivElement | null = null;

function ensureLabelLayer(): HTMLDivElement | null {
  const map = getMap(); if (!map) return null;
  if (labelLayer && labelLayer.parentElement === map.getContainer()) return labelLayer;
  labelLayer = document.createElement('div');
  labelLayer.className = 'fs-label-layer';
  map.getContainer().appendChild(labelLayer);
  return labelLayer;
}

function syncFloodLabels(pins: SensorPin[]): void {
  const map = getMap(); if (!map) return;
  const layer = ensureLabelLayer(); if (!layer) return;
  floodLabelPins = pins;
  const live = new Set(pins.map(p => p.id));
  for (const [id, el] of floodLabelDivs) {
    if (!live.has(id)) { el.remove(); floodLabelDivs.delete(id); }
  }
  pins.forEach(p => {
    const isDam = p.type === 'dam';
    const label = `${p.lv.toFixed(2)} ม.`;
    const div = floodLabelDivs.get(p.id) ?? document.createElement('div');
    div.className = 'fs-pin-label';
    div.style.background = isDam ? '#21162F' : '#071B2D';
    div.style.border = `1px solid ${isDam ? '#9B8CFF' : '#4C9AFF'}`;
    div.style.color = isDam ? '#E2DCFF' : '#D7E9FF';
    div.style.opacity = String(getApp().sensOpacity);
    div.textContent = label;
    if (!floodLabelDivs.has(p.id)) { layer.appendChild(div); floodLabelDivs.set(p.id, div); }
    const point = map.project(p.ll);
    div.style.left = `${point.x}px`;
    div.style.top = `${point.y + 14}px`;
  });
}

function refreshFloodLabelPositions(): void {
  const map = getMap();
  if (!map || !labelLayer) return;
  floodLabelPins.forEach(p => {
    const div = floodLabelDivs.get(p.id);
    if (!div) return;
    const point = map.project(p.ll);
    div.style.left = `${point.x}px`;
    div.style.top = `${point.y + 14}px`;
  });
}

export function syncPinData(): void {
  const s = getApp(), bb = currentBbox();
  const zoomOk = getApp().zoom >= MIN_ZOOM;
  setSourceData('fs-cctv-src', fc(s.cctvOn && zoomOk ? s.cctvList.filter(p => inBbox(p.ll, bb)).map(p => ptF(p.ll, { id: p.id })) : []));
  setSourceData('fs-flood-src', fc(s.sensOn && zoomOk ? s.sensList.filter(p => inBbox(p.ll, bb)).map(p => ptF(p.ll, { id: p.id, type: p.type })) : []));
  setSourceData('fs-transport-src', fc(s.transportOn && zoomOk ? s.transportList.filter(p => inBbox(p.ll, bb)).map(p => ptF(p.ll, { id: p.id, mode: p.mode, name: p.name })) : []));
  try { getMap()?.setPaintProperty('fs-transport-pin', 'icon-opacity', s.transportOpacity); } catch { /* layer missing */ }
  ['fs-transport-pin'].forEach(ly => setVisibility(ly, s.transportOn && zoomOk));
  try { getMap()?.setPaintProperty('fs-flood-pin', 'icon-opacity', s.sensOpacity); } catch { /* property n/a */ }
  floodLabelDivs.forEach(div => { div.style.opacity = String(s.sensOpacity); });
  ['fs-cctv-pin'].forEach(ly => setVisibility(ly, s.cctvOn && zoomOk));
  ['fs-flood-pin'].forEach(ly => setVisibility(ly, s.sensOn && zoomOk));
  syncFloodLabels(s.sensOn && zoomOk ? s.sensList.filter(p => inBbox(p.ll, bb)) : []);
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

export function plotSearch(items: { id: string; kind: string; ll: LngLat }[]): void {
  setSourceData('fs-search-src', fc(items.map(it => ptF(it.ll, { kind: it.kind, id: it.id }))));
}

let ringRaf = 0;
/** Flash the green selection ring (1 s fade). */
export function ringAt(at: LngLat | null): void {
  const map = getMap();
  if (!at || !map || !hasLayer('fs-sel-ring')) return;
  cancelAnimationFrame(ringRaf);
  setSourceData('fs-sel-src', fc([ptF(at)]));
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / 1000);
    if (t >= 1) { setSourceData('fs-sel-src', fc([])); return; }
    try {
      map.setPaintProperty('fs-sel-ring', 'circle-stroke-opacity', 1 - t);
      map.setPaintProperty('fs-sel-ring', 'circle-radius', 14 + t * 16);
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
/** Fly to / open a search result of any kind. */
export function gotoItem(it: SearchHit): void {
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
    placeMarker = new maplibregl.Marker({ color: '#4C9AFF' }).setLngLat(it.ll).setPopup(pop).addTo(map);
    setTimeout(() => placeMarker?.togglePopup(), 700);
  }
  ringAt(it.ll);
  map.flyTo({ center: it.ll, zoom: Math.max(map.getZoom() || 13, 16), essential: true });
}

export const parcelById = (id: number) => PARCEL_BY_ID.get(id);
