import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { ACCENT, AREA_COLOR, MAP_FONTS, WMS_BASE } from '../data/constants';
import { getApp } from '../store/useApp';
import type { Overlay, Status } from '../types';
import { fc, getMap, hasLayer, requireMap } from './mapRef';
import { markerScale } from './pins';
import { setParcelLabelVisibility } from './parcelLabels';

void WMS_BASE;

const safeAddLayer = (def: LayerSpecification): void => {
  try { requireMap().addLayer(def); } catch { /* non-fatal: layer may exist or style is mid-reload */ }
};

/* ---------- zoom-driven radius / fades ---------- */
const RADIUS_STOPS: [number, number][] = [[11, 3.2], [13, 4.6], [15, 6.5], [18, 9.5]];
const radiusExpr = (pad: number): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...RADIUS_STOPS.flatMap(([z, r]) => [z, (r + pad) * markerScale()])] as ExpressionSpecification;
const zoomFadeIcon = ['interpolate', ['exponential', 1.8], ['zoom'], 13, 0, 13.8, 0.9] as ExpressionSpecification;
const zoomFadeText = ['interpolate', ['exponential', 1.8], ['zoom'], 13, 0, 13.8, 1] as ExpressionSpecification;

/** Resale parcels win over their status so "นำกลับมาขายใหม่" keeps its own colour. */
const statusColor = (c: Record<Status, string>, reColor: string): ExpressionSpecification =>
  ['case',
    ['all', ['==', ['get', 'status'], 'sale'], ['==', ['get', 'resell'], true]], reColor,
    ['match', ['get', 'status'], 'sale', c.sale, 'sold', c.sold, '#fff'],
  ] as ExpressionSpecification;

/* ---------- 9-slice plate images + hairline tick ---------- */
interface PlateImage {
  image: { width: number; height: number; data: Uint8Array };
  opts: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] };
}
function plateImage(hex: string, alpha = 255): PlateImage {
  const s = 2, w = 30, h = 18, r = 5;
  const c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(s, s);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, w, h, r); else ctx.rect(0, 0, w, h);
  ctx.globalAlpha = alpha / 255;
  ctx.fillStyle = hex; ctx.fill();
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return {
    image: { width: c.width, height: c.height, data: new Uint8Array(id.data) },
    opts: { pixelRatio: s, stretchX: [[r * s, (w - r) * s]], stretchY: [[r * s, (h - r) * s]], content: [r * s, r * s, (w - r) * s, (h - r) * s] },
  };
}
function tickImage(): PlateImage['image'] {
  const s = 2, w = 16, h = 2;
  const c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data) };
}
function addPlate(id: string, p: PlateImage): void {
  const map = requireMap();
  try { if (!map.hasImage(id)) map.addImage(id, p.image, p.opts); } catch { /* non-fatal */ }
}
export function addPlateImages(): void {
  const { popColors } = getApp();
  const map = requireMap();
  addPlate('plate-n', plateImage('#0D0F0D', 238));
  addPlate('plate-s', plateImage(popColors.sale, 244));
  addPlate('plate-d', plateImage(popColors.sold, 244));
  /* second block of the compact label — the percent row, light so it reads */
  addPlate('plate-b', plateImage('#F1F3EA', 246));
  try { if (!map.hasImage('rbar')) map.addImage('rbar', tickImage(), { pixelRatio: 2 }); } catch { /* non-fatal */ }
}
export function refreshPlates(): void {
  const map = getMap(); if (!map) return;
  const { popColors } = getApp();
  try {
    if (map.hasImage('plate-s')) { const p = plateImage(popColors.sale, 244); map.updateImage('plate-s', p.image); }
    if (map.hasImage('plate-d')) { const p = plateImage(popColors.sold, 244); map.updateImage('plate-d', p.image); }
  } catch { /* non-fatal */ }
}

/* ---------- filter-area layers (also re-called by the draw engine so they can never go missing) ---------- */
export function ensureAreaLayers(): void {
  const map = requireMap();
  if (!map.getSource('areafill')) {
    map.addSource('areafill', { type: 'geojson', data: fc([]) });
    safeAddLayer({ id: 'areafill-l', type: 'fill', source: 'areafill', paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.14 } });
  }
  if (!map.getSource('areaborder')) {
    map.addSource('areaborder', { type: 'geojson', data: fc([]) });
    safeAddLayer({ id: 'areaborder-l', type: 'line', source: 'areaborder', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': AREA_COLOR, 'line-width': 3, 'line-opacity': 1 } });
  }
  if (!map.getSource('arealabels')) {
    map.addSource('arealabels', { type: 'geojson', data: fc([]) });
    safeAddLayer({
      id: 'area-tags', type: 'symbol', source: 'arealabels',
      layout: {
        'icon-image': 'plate-n', 'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 6, 3, 6],
        'text-field': ['get', 'lbl'], 'text-font': MAP_FONTS, 'text-size': 10.5,
        'text-allow-overlap': true, 'icon-allow-overlap': true, 'text-ignore-placement': true, 'icon-ignore-placement': true,
      },
      paint: { 'text-color': '#FFFFFF', 'icon-opacity': 1, 'text-opacity': 1 },
    });
  }
}

/* ---------- overlays ---------- */
export function addOverlayLayers(): void {
  const map = requireMap();
  const { overlays, floodV } = getApp();
  overlays.forEach(ov => {
    const sid = 'ov-' + ov.id;
    if (map.getSource(sid)) return;
    const vis = ov.visible ? 'visible' : 'none';
    if (ov.type === 'wms') {
      map.addSource(sid, { type: 'raster', tiles: ['wms://dol_hd/{z}/{x}/{y}'], tileSize: 256, attribution: 'Longdo / กรมที่ดิน' });
      safeAddLayer({ id: sid + '-r', type: 'raster', source: sid, layout: { visibility: vis }, paint: { 'raster-opacity': ov.opacity } });
    } else if (ov.type === 'flood') {
      map.addSource(sid, { type: 'raster', tiles: [`flood://f/${floodV}/{z}/{x}/{y}`], tileSize: 256, attribution: 'Terrarium DEM / AWS' });
      safeAddLayer({ id: sid + '-r', type: 'raster', source: sid, layout: { visibility: vis }, paint: { 'raster-opacity': ov.opacity } });
    } else {
      map.addSource(sid, { type: 'geojson', data: fc([]) });
      safeAddLayer({ id: sid + '-f', type: 'fill', source: sid, layout: { visibility: vis }, paint: { 'fill-color': ov.color, 'fill-opacity': ov.opacity } });
      safeAddLayer({ id: sid + '-o', type: 'line', source: sid, layout: { visibility: vis }, paint: { 'line-color': ov.color, 'line-width': 1.4, 'line-opacity': Math.min(1, ov.opacity + 0.35) } });
    }
  });
}
export function applyOverlayVisibility(ov: Overlay): void {
  const map = getMap(); if (!map || !map.getSource('ov-' + ov.id)) return;
  const sid = 'ov-' + ov.id, v = ov.visible ? 'visible' : 'none';
  [sid + '-f', sid + '-o', sid + '-r'].forEach(l => { if (hasLayer(l)) map.setLayoutProperty(l, 'visibility', v); });
}
export function applyOverlayOpacity(ov: Overlay): void {
  const map = getMap(); if (!map || !map.getSource('ov-' + ov.id)) return;
  const sid = 'ov-' + ov.id;
  if (ov.type === 'flood' || ov.type === 'wms') { if (hasLayer(sid + '-r')) map.setPaintProperty(sid + '-r', 'raster-opacity', ov.opacity); }
  else {
    if (hasLayer(sid + '-f')) map.setPaintProperty(sid + '-f', 'fill-opacity', ov.opacity);
    if (hasLayer(sid + '-o')) map.setPaintProperty(sid + '-o', 'line-opacity', Math.min(1, ov.opacity + 0.35));
  }
}
/** Flood tiles are computed client-side; changing sea level / colours means a new tile URL (cache-bust). */
export function rebuildFlood(): void {
  const map = getMap(); if (!map) return;
  const sid = 'ov-flood';
  if (!map.getSource(sid)) return;
  const ov = getApp().overlays.find(o => o.id === 'flood');
  if (!ov) return;
  try { if (hasLayer(sid + '-r')) map.removeLayer(sid + '-r'); map.removeSource(sid); } catch { /* non-fatal */ }
  const floodV = getApp().floodV + 1;
  getApp().patch({ floodV });
  map.addSource(sid, { type: 'raster', tiles: [`flood://f/${floodV}/{z}/{x}/{y}`], tileSize: 256, attribution: 'Terrarium DEM / AWS' });
  safeAddLayer({ id: sid + '-r', type: 'raster', source: sid, layout: { visibility: ov.visible ? 'visible' : 'none' }, paint: { 'raster-opacity': ov.opacity } });
}

/* ---------- parcels, labels, drawings ---------- */
export function addCustomLayers(): void {
  const map = requireMap();
  const s = getApp();
  addPlateImages();
  addOverlayLayers();
  ensureAreaLayers();

  if (!map.getSource('parcels')) {
    map.addSource('parcels', { type: 'geojson', data: fc([]) });
    safeAddLayer({ id: 'parcels-halo', type: 'circle', source: 'parcels', filter: ['==', ['get', 'id'], -1], paint: { 'circle-radius': radiusExpr(5.5), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ACCENT, 'circle-stroke-width': 2.4 } });
    safeAddLayer({ id: 'parcels-dot', type: 'circle', source: 'parcels', paint: { 'circle-radius': radiusExpr(0), 'circle-color': statusColor(s.popColors, s.reColor), 'circle-stroke-color': 'rgba(255,255,255,.92)', 'circle-stroke-width': 1.3, 'circle-opacity': 1, 'circle-stroke-opacity': 1 } });
  }
  if (!map.getSource('labels')) {
    map.addSource('labels', { type: 'geojson', data: fc([]) });
    /* The compact parcel label is a DOM overlay (src/map/parcelLabels.ts) so it can
       use two coloured blocks plus an inline land-kind icon. The source stays as a
       cheap placeholder so nothing else has to care. */
  }
  if (!map.getSource('draws')) addDrawLayers();
  if (s.selectedId != null && hasLayer('parcels-halo')) map.setFilter('parcels-halo', ['==', ['get', 'id'], s.selectedId]);
}

const showSeg = (m: string) => m === 'both' || m === 'seg';
const showRound = (m: string) => m === 'both' || m === 'round';

function addDrawLayers(): void {
  const map = requireMap();
  const s = getApp();
  const plateLayout = (pad: [number, number, number, number], size: number): LayerSpecification['layout'] => ({
    'icon-image': 'plate-n', 'icon-text-fit': 'both', 'icon-text-fit-padding': pad,
    'text-field': ['get', 'lbl'], 'text-font': MAP_FONTS, 'text-size': size,
  } as LayerSpecification['layout']);
  const src = (id: string) => map.addSource(id, { type: 'geojson', data: fc([]) });

  src('draws');
  safeAddLayer({ id: 'draw-fill', type: 'fill', source: 'draws', filter: ['in', ['get', 'ft'], ['literal', ['poly', 'circle']]], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.13 } });
  safeAddLayer({ id: 'draw-stroke', type: 'line', source: 'draws', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
  src('drawverts');
  safeAddLayer({
    id: 'draw-verts', type: 'circle', source: 'drawverts',
    paint: {
      'circle-radius': ['case', ['in', ['get', 'vi'], ['literal', [-1, -2]]], 7, 5],
      'circle-color': ['case', ['in', ['get', 'vi'], ['literal', [-1, -2]]], ACCENT, '#FFFFFF'],
      'circle-stroke-color': ACCENT, 'circle-stroke-width': 2,
    },
  });
  src('drawlabels');
  safeAddLayer({
    id: 'draw-tags', type: 'symbol', source: 'drawlabels',
    layout: { ...plateLayout([3, 6, 3, 6], 10.5), 'text-allow-overlap': true, 'icon-allow-overlap': true, 'text-ignore-placement': true, 'icon-ignore-placement': true },
    paint: { 'text-color': '#FFFFFF', 'icon-opacity': 1, 'text-opacity': 1 },
  });
  src('drawseg');
  safeAddLayer({
    id: 'draw-seg-l', type: 'symbol', source: 'drawseg',
    layout: { ...plateLayout([2.5, 5, 2.5, 5], 9.5), 'text-letter-spacing': 0.02, visibility: showSeg(s.drawDistMode) ? 'visible' : 'none' },
    paint: { 'text-color': '#FFFFFF', 'icon-opacity': zoomFadeIcon, 'text-opacity': zoomFadeText },
  });
  src('drawround');
  safeAddLayer({
    id: 'draw-round-b', type: 'symbol', source: 'drawround',
    layout: { 'icon-image': 'rbar', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility: showRound(s.drawDistMode) ? 'visible' : 'none' },
    paint: { 'icon-opacity': zoomFadeText },
  });
  safeAddLayer({
    id: 'draw-round-l', type: 'symbol', source: 'drawround',
    layout: {
      ...plateLayout([2.5, 5, 2.5, 5], 9.5), 'text-anchor': 'bottom',
      'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'text-allow-overlap': true, 'icon-allow-overlap': true, visibility: showRound(s.drawDistMode) ? 'visible' : 'none',
    },
    paint: { 'text-color': '#FFFFFF', 'icon-opacity': zoomFadeIcon, 'text-opacity': zoomFadeText },
  });
  src('drawmeta');
  safeAddLayer({ id: 'draw-meta-d', type: 'circle', source: 'drawmeta', layout: { visibility: s.showCircleMeta ? 'visible' : 'none' }, paint: { 'circle-radius': 4, 'circle-color': ACCENT, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6 } });
  safeAddLayer({
    id: 'draw-meta-l', type: 'symbol', source: 'drawmeta',
    layout: { ...plateLayout([3, 6, 3, 6], 9.5), 'text-anchor': 'bottom', 'text-offset': [0, 0.9], 'text-allow-overlap': true, 'icon-allow-overlap': true, visibility: s.showCircleMeta ? 'visible' : 'none' },
    paint: { 'text-color': '#FFFFFF' },
  });
  src('drawprev');
  safeAddLayer({ id: 'draw-prev-l', type: 'line', source: 'drawprev', paint: { 'line-color': '#FFFFFF', 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': 0.75 } });
}

/** Apply settings-driven paint/layout properties to existing layers. */
export function applyPaint(): void {
  const map = getMap();
  if (!map || !map.getSource('parcels')) return;
  map.setPaintProperty('parcels-dot', 'circle-color', statusColor(getApp().popColors, getApp().reColor));
  map.setPaintProperty('parcels-dot', 'circle-radius', radiusExpr(0));
  if (map.getLayer('parcels-halo')) map.setPaintProperty('parcels-halo', 'circle-radius', radiusExpr(5.5));
}
export function applyLabelLayout(): void {
  const s = getApp();
  setParcelLabelVisibility(s.popupMode === 'all' && s.landOn);
}
export function applyDrawPrefs(): void {
  const map = getMap(); if (!map) return;
  const s = getApp();
  const segOn = showSeg(s.drawDistMode), rndOn = showRound(s.drawDistMode);
  ([['draw-seg-l', segOn], ['draw-round-b', rndOn], ['draw-round-l', rndOn], ['draw-meta-d', s.showCircleMeta], ['draw-meta-l', s.showCircleMeta]] as [string, boolean][])
    .forEach(([l, on]) => { if (hasLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'); });
}
export function applyParcelLayerVisibility(): void {
  const on = getApp().landOn;
  (['parcels-dot', 'parcels-halo'] as const).forEach(l => {
    const map = getMap();
    if (map && hasLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
  });
  applyLabelLayout();
}
