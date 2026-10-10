import type { LngLat as MlLngLat, Point } from 'maplibre-gl';
import { ACCENT } from '../data/constants';
import {
  bearingDeg, circleRing, closeRing, d2seg, destPoint, havM, lerpLL, midPointByLength, pathLenM, ringAreaM2,
} from '../lib/geo';
import { fmtDist, fmtRaiFromM2 } from '../lib/format';
import { getApp, newEntityId, patchApp, toast } from '../store/useApp';
import type { DrawShape, DrawTool, FilterArea, LngLat } from '../types';
import { ensureAreaLayers } from './layers';
import { fc, getMap, ptF, setSourceData } from './mapRef';

export interface PtrEvent {
  lngLat: MlLngLat;
  point: Point;
  preventDefault: () => void;
}

export const D_NAME: Record<DrawTool, string> = { poly: 'พื้นที่', line: 'เส้น', circle: 'วงกลม' };
const ll = (e: PtrEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];
const setInfo = (drawInfo: string): void => patchApp({ drawInfo });

/* ---------- measurement helpers (also used by the right-panel lists) ---------- */
export function shapeMetaLines(d: DrawShape): string[] {
  if (d.type === 'line') return [fmtDist(pathLenM(d.coords))];
  if (d.type === 'circle') return ['รัศมี ' + fmtDist(d.r)];
  const ring = closeRing(d.coords);
  return [fmtDist(pathLenM(ring)), '≈ ' + fmtRaiFromM2(ringAreaM2(ring))];
}
export const shapeMeta = (d: DrawShape): string => shapeMetaLines(d).join(' · ');

export function labelPos(d: DrawShape | { type: 'poly'; coords: LngLat[] }): LngLat {
  if (d.type === 'circle') return destPoint(d.center, 0, Math.max(5, d.r * 0.3));
  if (d.type === 'line') return midPointByLength(d.coords);
  const s = d.coords.reduce<LngLat>((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  return [s[0] / d.coords.length, s[1] / d.coords.length];
}

/* ---------- feature builders ---------- */
function segDistFeats(d: Exclude<DrawShape, { type: 'circle' }>): GeoJSON.Feature[] {
  const cs = d.type === 'poly' ? closeRing(d.coords) : d.coords;
  const f: GeoJSON.Feature[] = [];
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i], m = havM(a, b);
    if (m < 2) continue;
    f.push(ptF([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { lbl: fmtDist(m) }));
  }
  return f;
}
function roundFeats(d: Exclude<DrawShape, { type: 'circle' }>): GeoJSON.Feature[] {
  const cs = d.type === 'poly' ? closeRing(d.coords) : d.coords;
  const total = pathLenM(cs), f: GeoJSON.Feature[] = [], STEP = 500;
  for (let target = STEP; target <= total; target += STEP) {
    let acc = 0, pt: LngLat | null = null, rot = 0;
    for (let i = 1; i < cs.length; i++) {
      const seg = havM(cs[i - 1], cs[i]);
      if (acc + seg >= target) { pt = lerpLL(cs[i - 1], cs[i], (target - acc) / seg); rot = bearingDeg(cs[i - 1], cs[i]); break; }
      acc += seg;
    }
    if (pt) f.push(ptF(pt, { lbl: target >= 1000 ? (target / 1000).toLocaleString('th-TH') + ' กม.' : target.toLocaleString('th-TH') + ' ม.', rot }));
  }
  return f;
}
const vertFeatures = (d: DrawShape): GeoJSON.Feature[] =>
  d.type === 'circle'
    ? [ptF(d.center, { did: d.id, vi: -1 }), ptF(destPoint(d.center, 0, d.r), { did: d.id, vi: -2 })]
    : d.coords.map((c, i) => ptF(c, { did: d.id, vi: i }));

const polyF = (coords: LngLat[], props: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } });
const lineF = (coords: LngLat[], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

/** Re-render every drawn shape, filter area and in-progress preview. Safe to call at pointer-move rate. */
export function syncDraws(): void {
  const map = getMap();
  if (!map || !map.getSource('draws')) return;
  ensureAreaLayers();
  const s = getApp();
  const feats: GeoJSON.Feature[] = [], tags: GeoJSON.Feature[] = [], segL: GeoJSON.Feature[] = [], rndL: GeoJSON.Feature[] = [];
  const meta: GeoJSON.Feature[] = [], atags: GeoJSON.Feature[] = [], afill: GeoJSON.Feature[] = [], aborder: GeoJSON.Feature[] = [], prev: GeoJSON.Feature[] = [];
  const { drawPts, drawCenter, previewR, cursorLL, drawMode, drawTool } = s;
  const segOn = s.drawDistMode === 'both' || s.drawDistMode === 'seg';
  const rndOn = s.drawDistMode === 'both' || s.drawDistMode === 'round';

  s.draws.forEach(d => {
    if (!d.visible) return;
    if (d.type === 'poly') feats.push(polyF(closeRing(d.coords), { did: d.id, ft: 'poly', color: d.color }));
    else if (d.type === 'circle') feats.push(polyF(circleRing(d.center, d.r), { did: d.id, ft: 'circle', color: d.color }));
    else feats.push(lineF(d.coords, { did: d.id, ft: 'line', color: d.color }));
    tags.push(ptF(labelPos(d), { lbl: '#' + d.no }));
    if (d.type === 'circle') { if (s.showCircleMeta) meta.push(ptF(d.center, { lbl: 'รัศมี ' + fmtDist(d.r) })); }
    else {
      if (segOn) segL.push(...segDistFeats(d));
      if (rndOn) rndL.push(...roundFeats(d));
    }
  });

  if (drawMode === 'draw') {
    if (drawTool === 'circle' && drawCenter) {
      feats.push(polyF(circleRing(drawCenter, Math.max(10, previewR)), { ft: 'circle', color: ACCENT }));
      meta.push(ptF(drawCenter, { lbl: 'รัศมี ' + fmtDist(Math.max(10, previewR)) }));
    } else if (drawPts.length) {
      if (drawTool === 'poly' && drawPts.length >= 3) feats.push(polyF(closeRing(drawPts), { ft: 'poly', color: ACCENT }));
      else feats.push(lineF(drawPts, { ft: 'line', color: ACCENT }));
    }
  }
  if (drawMode === 'area' && drawPts.length) {
    if (drawPts.length >= 3) { afill.push(polyF(closeRing(drawPts), {})); aborder.push(lineF(closeRing(drawPts))); }
    else afill.push(lineF(drawPts));
  }
  s.areas.forEach(a => {
    if (!a.enabled) return; /* toggle off hides border AND tag */
    afill.push(polyF(closeRing(a.coords), {}));
    aborder.push(lineF(closeRing(a.coords)));
    atags.push(ptF(labelPos({ type: 'poly', coords: a.coords }), { lbl: 'A' + a.no }));
  });
  if (!s.areaTagsOn) atags.length = 0;

  if ((drawMode === 'draw' || drawMode === 'area') && cursorLL && drawPts.length) {
    prev.push(lineF([drawPts[drawPts.length - 1], cursorLL]));
    if (drawMode === 'area' || (drawTool === 'poly' && drawPts.length >= 2)) prev.push(lineF([cursorLL, drawPts[0]]));
    if (drawMode === 'draw') {
      let lbl = '';
      if (drawTool === 'circle' && drawCenter) lbl = 'รัศมี ' + fmtDist(Math.max(10, previewR));
      else {
        const cs = [...drawPts, cursorLL];
        if (drawTool === 'poly') {
          const ring = cs.length >= 3 ? closeRing(cs) : null;
          lbl = ring ? `${fmtDist(pathLenM(ring))} · ≈ ${fmtRaiFromM2(ringAreaM2(ring))}` : fmtDist(pathLenM(cs));
        } else lbl = fmtDist(pathLenM(cs));
      }
      if (lbl) {
        const cp = map.project(cursorLL);
        const tag = map.unproject([cp.x + 18, cp.y - 30]); /* offset up-right, out from under the pointer */
        segL.push(ptF([tag.lng, tag.lat], { lbl }));
      }
    }
  }

  setSourceData('draws', fc(feats));
  setSourceData('drawlabels', fc(tags));
  setSourceData('drawseg', fc(segL));
  setSourceData('drawround', fc(rndL));
  setSourceData('drawmeta', fc(meta));
  setSourceData('areafill', fc(afill));
  setSourceData('areaborder', fc(aborder));
  setSourceData('arealabels', fc(atags));
  setSourceData('drawprev', fc(prev));

  let vf: GeoJSON.Feature[] = [];
  if (s.editingDraw != null) { const d = s.draws.find(x => x.id === s.editingDraw); if (d) vf = vertFeatures(d); }
  else if (drawMode === 'draw') {
    if (drawTool === 'circle') { if (drawCenter) vf = [ptF(drawCenter, { vi: -1 })]; }
    else vf = drawPts.map(c => ptF(c, { vi: 0 }));
  } else if (drawMode === 'area') vf = drawPts.map(c => ptF(c, { vi: 0 }));
  setSourceData('drawverts', fc(vf));
}

/* ---------- mode control ---------- */
const RESET_PROGRESS = { drawPts: [] as LngLat[], drawCenter: null, previewR: 0, drawRadius: 0, cursorLL: null, drawInfo: '' };

function applyCursorMode(): void {
  const map = getMap(); if (!map) return;
  const { drawMode, editingDraw } = getApp();
  const active = drawMode != null || editingDraw != null;
  map.getCanvas().style.cursor = drawMode ? 'crosshair' : '';
  if (active) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
}

export function stopEdit(): void {
  if (getApp().editingDraw == null) return;
  patchApp({ editingDraw: null, drawInfo: '' });
  applyCursorMode();
  syncDraws();
}
export function startEdit(id: number): void {
  if (getApp().drawMode) cancelDraw();
  patchApp({ editingDraw: id });
  const d = getApp().draws.find(x => x.id === id);
  setInfo(d ? shapeMeta(d) : '');
  applyCursorMode();
  syncDraws();
}
export function startDraw(): void {
  stopEdit();
  patchApp({ drawMode: 'draw', ...RESET_PROGRESS });
  applyCursorMode();
}
export function startArea(): void {
  stopEdit();
  patchApp({ drawMode: 'area', ...RESET_PROGRESS });
  applyCursorMode();
}
export function cancelDraw(): void {
  patchApp({ drawMode: null, ...RESET_PROGRESS });
  applyCursorMode();
  syncDraws();
}
export function startDrawTool(t: DrawTool): void {
  patchApp({ drawTool: t, rightOpen: true, rpView: 'draw' });
  startDraw();
  toast({ line: 'เริ่มวาด "เส้น" — คลิกวางจุด', poly: 'เริ่มวาด "พื้นที่" — คลิกวางจุด', circle: 'เริ่มวาด "วงกลม" — คลิกจุดกลาง แล้วคลิกกำหนดรัศมี' }[t]);
}
export function undoDrawPoint(): void {
  patchApp({ drawPts: getApp().drawPts.slice(0, -1) });
}

/** Delete numbering gaps: names like "พื้นที่ #3" follow the layer number. */
function renumber(draws: DrawShape[]): DrawShape[] {
  return draws.map((d, i) => {
    const no = i + 1;
    if (d.no === no) return d;
    const name = /^(เส้น|พื้นที่|วงกลม) #\d+$/.test(d.name) ? d.name.replace(/#\d+$/, '#' + no) : d.name;
    return { ...d, no, name };
  });
}
export function deleteDraw(id: number): void {
  if (getApp().editingDraw === id) stopEdit();
  const draws = renumber(getApp().draws.filter(d => d.id !== id));
  patchApp({ draws, drawSeq: draws.length + 1 });
  toast('ลบชั้นข้อมูลที่เลือกแล้ว');
}
export function clearDraws(): void {
  stopEdit();
  patchApp({ draws: [], drawSeq: 1 });
  toast('ล้างชั้นข้อมูลที่วาดทั้งหมดแล้ว');
}
export function updateDraw(id: number, patch: Partial<Pick<DrawShape, 'name' | 'color' | 'visible'>>): void {
  patchApp({ draws: getApp().draws.map(d => (d.id === id ? ({ ...d, ...patch } as DrawShape) : d)) });
}
/** Area tags are always 1..n — no gaps left behind by a delete. */
function renumberAreas(areas: FilterArea[]): FilterArea[] {
  return areas.map((a, i) => (a.no === i + 1 ? a : { ...a, no: i + 1 }));
}
const setAreas = (areas: FilterArea[]): void => patchApp({ areas: renumberAreas(areas), areaSeq: areas.length + 1 });

export function deleteArea(id: number): void {
  setAreas(getApp().areas.filter(a => a.id !== id));
  toast('ลบพื้นที่กรองที่เลือกแล้ว');
}
export function clearAreas(): void {
  patchApp({ areas: [], areaSeq: 1 });
  toast('ล้างพื้นที่กรองทั้งหมดแล้ว');
}
export function toggleArea(id: number, enabled: boolean): void {
  patchApp({ areas: getApp().areas.map(a => (a.id === id ? { ...a, enabled } : a)) });
}

export function finishDraw(): void {
  const s = getApp();
  if (s.drawMode !== 'draw') return;
  const t = s.drawTool;
  const base = { id: newEntityId(), no: s.drawSeq, color: ACCENT, visible: true };
  let d: DrawShape;
  if (t === 'circle') {
    if (!s.drawCenter || !s.drawRadius) { cancelDraw(); return; }
    d = { ...base, type: 'circle', name: `วงกลม #${s.drawSeq}`, center: s.drawCenter, r: s.drawRadius };
  } else if (t === 'line') {
    if (s.drawPts.length < 2) { toast('เส้นต้องมีอย่างน้อย 2 จุด', 'warn'); return; }
    d = { ...base, type: 'line', name: `เส้น #${s.drawSeq}`, coords: s.drawPts.slice() };
  } else {
    if (s.drawPts.length < 3) { toast('พื้นที่ต้องมีอย่างน้อย 3 จุด', 'warn'); return; }
    d = { ...base, type: 'poly', name: `พื้นที่ #${s.drawSeq}`, coords: s.drawPts.slice() };
  }
  patchApp({ draws: [...s.draws, d], drawSeq: s.drawSeq + 1 });
  cancelDraw();
  toast(`วาด${D_NAME[t]} #${d.no} สำเร็จ — ${shapeMeta(d)}`);
}
export function finishArea(): void {
  const s = getApp();
  if (s.drawMode !== 'area') return;
  if (s.drawPts.length < 3) { toast('พื้นที่กรองต้องมีอย่างน้อย 3 จุด', 'warn'); return; }
  const a: FilterArea = { id: newEntityId(), no: s.areaSeq, coords: s.drawPts.slice(), enabled: true };
  patchApp({ areas: [...s.areas, a], areaSeq: s.areaSeq + 1 });
  cancelDraw();
  toast(`เพิ่มพื้นที่กรอง A${a.no} — ≈ ${fmtRaiFromM2(ringAreaM2(closeRing(a.coords)))}`);
}

/* ---------- map event handlers (wired in useMapEvents) ---------- */
export function drawClick(e: PtrEvent): void {
  const s = getApp();
  if (s.drawTool === 'circle') {
    if (!s.drawCenter) { patchApp({ drawCenter: ll(e), previewR: 150 }); }
    else { patchApp({ drawRadius: Math.max(10, havM(s.drawCenter, ll(e))) }); finishDraw(); }
    return;
  }
  patchApp({ drawPts: [...s.drawPts, ll(e)] });
}
export function areaClick(e: PtrEvent): void {
  patchApp({ drawPts: [...getApp().drawPts, ll(e)] });
}

/** Cursor move while drawing: updates the live measurement and the preview. */
export function drawPointerMove(e: PtrEvent): void {
  const s = getApp();
  const cursor = ll(e);
  let info = s.drawInfo, previewR = s.previewR;
  if (s.drawMode === 'draw' && s.drawTool === 'circle' && s.drawCenter) {
    previewR = havM(s.drawCenter, cursor);
    info = `รัศมี ${fmtDist(previewR)} · พื้นที่ ≈ ${fmtRaiFromM2(Math.PI * previewR * previewR)}`;
  } else if (s.drawPts.length && s.drawMode === 'draw') {
    const cs = [...s.drawPts, cursor];
    if (s.drawTool === 'poly') {
      const ring = cs.length >= 3 ? closeRing(cs) : null;
      info = ring ? `${fmtDist(pathLenM(ring))} · ≈ ${fmtRaiFromM2(ringAreaM2(ring))}` : fmtDist(pathLenM(cs));
    } else info = fmtDist(pathLenM(cs));
  }
  patchApp({ cursorLL: cursor, previewR, drawInfo: info });
}

/* ---------- edit mode ---------- */
let vDrag: { did: number; vi: number } | null = null;
export const isVertexDragging = (): boolean => vDrag != null;

export function vertexDown(e: PtrEvent & { features?: GeoJSON.Feature[] }): void {
  const editing = getApp().editingDraw;
  const f = e.features?.[0];
  if (editing == null || !f || Number(f.properties?.did) !== editing) return;
  vDrag = { did: editing, vi: Number(f.properties?.vi) };
  getMap()?.dragPan.disable();
  e.preventDefault();
}
export function dragVertex(e: PtrEvent): void {
  if (!vDrag) return;
  const { did, vi } = vDrag;
  const pos = ll(e);
  patchApp({
    draws: getApp().draws.map(d => {
      if (d.id !== did) return d;
      if (d.type === 'circle') return vi === -1 ? { ...d, center: pos } : { ...d, r: Math.max(10, havM(d.center, pos)) };
      return { ...d, coords: d.coords.map((c, i) => (i === vi ? pos : c)) };
    }),
  });
  const d = getApp().draws.find(x => x.id === did);
  if (d) setInfo(shapeMeta(d));
}
export function endVertexDrag(): void {
  if (!vDrag) return;
  vDrag = null;
  getMap()?.dragPan.enable();
}

function mutateEditing(fn: (d: Exclude<DrawShape, { type: 'circle' }>) => Exclude<DrawShape, { type: 'circle' }>): void {
  const id = getApp().editingDraw;
  patchApp({ draws: getApp().draws.map(d => (d.id === id && d.type !== 'circle' ? fn(d) : d)) });
  const d = getApp().draws.find(x => x.id === id);
  if (d) setInfo(shapeMeta(d));
}
export function editClick(e: PtrEvent): void {
  const map = getMap(); if (!map) return;
  const s = getApp();
  const d = s.draws.find(x => x.id === s.editingDraw);
  if (!d) return;
  if (d.type === 'circle') { toast('วงกลม: ลากจุดกลางเพื่อย้าย · ลากจุดขอบเพื่อปรับรัศมี'); return; }
  const mine = (f: GeoJSON.Feature) => Number(f.properties?.did) === s.editingDraw;
  const vf = map.queryRenderedFeatures(e.point as Point, { layers: ['draw-verts'] }).filter(mine);
  if (vf.length) {
    const vi = Number(vf[0].properties?.vi);
    const min = d.type === 'poly' ? 3 : 2;
    if (d.coords.length <= min) { toast(`${D_NAME[d.type]}ต้องมีอย่างน้อย ${min} จุด`, 'warn'); return; }
    mutateEditing(x => ({ ...x, coords: x.coords.filter((_, i) => i !== vi) }));
    return;
  }
  const sf = map.queryRenderedFeatures(e.point as Point, { layers: ['draw-stroke'] }).filter(mine);
  if (sf.length) {
    const proj = d.coords.map(c => map.project(c));
    const px = e.point.x, py = e.point.y;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < proj.length - 1; i++) {
      const dd = d2seg(px, py, proj[i].x, proj[i].y, proj[i + 1].x, proj[i + 1].y);
      if (dd < bd) { bd = dd; bi = i; }
    }
    let pos = bi + 1;
    if (d.type === 'poly') {
      const dd = d2seg(px, py, proj[proj.length - 1].x, proj[proj.length - 1].y, proj[0].x, proj[0].y);
      if (dd < bd) pos = 0;
    }
    const pt = ll(e);
    mutateEditing(x => ({ ...x, coords: [...x.coords.slice(0, pos), pt, ...x.coords.slice(pos)] }));
    return;
  }
  const pt = ll(e);
  mutateEditing(x => ({ ...x, coords: [...x.coords, pt] }));
}
