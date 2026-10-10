import { BASEMAPS, DEFAULT_COL_HIDDEN, DEFAULT_COL_ORDER } from '../data/constants';
import { PARCEL_BY_ID } from '../data/mockData';
import { getMap, hasLayer } from '../map/mapRef';
import { closeClickPopup, closeHoverPopup, getHoverPopId, openClickPopup } from '../map/popups';
import type { BasemapId, ColKey, Overlay, OverlayId, RightView } from '../types';
import { EMPTY_FILTERS, getApp, patchApp, toast } from './useApp';

export function setRight(open: boolean): void { patchApp({ rightOpen: open }); }
export function setLeft(open: boolean): void { patchApp({ leftOpen: open }); }
export function setRpView(v: RightView): void { patchApp({ rpView: v }); }
export function showRight(v: RightView): void { patchApp({ rpView: v, rightOpen: true }); }

export function select(id: number, { fly = true }: { fly?: boolean } = {}): void {
  const p = PARCEL_BY_ID.get(id);
  if (!p) return;
  const map = getMap();
  patchApp({ selectedId: id, rpView: 'detail', rightOpen: true, pinSel: String(id) });
  if (map && hasLayer('parcels-halo')) map.setFilter('parcels-halo', ['==', ['get', 'id'], id]);
  if (getHoverPopId() === id) closeHoverPopup();
  if (getApp().popupMode === 'active') openClickPopup(p);
  if (fly && map) map.flyTo({ center: [p.lng, p.lat], zoom: 15.5, duration: 850 });
}

export function deselect(): void {
  const map = getMap();
  patchApp({ selectedId: null, pinSel: null });
  if (map && hasLayer('parcels-halo')) map.setFilter('parcels-halo', ['==', ['get', 'id'], -1]);
  closeClickPopup();
}

/**
 * Drops the green ring around a cctv / water / bus pin without touching the land
 * selection — closing the right panel should not leave a ring stranded on the map.
 */
export function deselectPin(): void {
  if (getApp().pinSel == null) return;
  patchApp({ pinSel: null });
}

export function setBasemap(v: BasemapId): void {
  const map = getMap();
  if (!map || getApp().basemap === v) return;
  patchApp({ basemap: v });
  map.setLayoutProperty('g-road-l', 'visibility', v === 'road' ? 'visible' : 'none');
  map.setLayoutProperty('g-sat-l', 'visibility', v === 'sat' ? 'visible' : 'none');
  toast('เปลี่ยนแผนที่ฐาน: ' + BASEMAPS[v].name);
}

/** Patch one overlay immutably (useMapSync pushes the change to the map). */
export function updateOverlay(id: OverlayId, patch: Partial<Overlay>, announce = false): void {
  const overlays = getApp().overlays.map(o => (o.id === id ? { ...o, ...patch } : o));
  patchApp({ overlays });
  if (announce && patch.visible != null) {
    const ov = overlays.find(o => o.id === id);
    if (ov) toast((ov.visible ? 'เปิด' : 'ปิด') + 'เลย์เยอร์: ' + ov.name);
  }
}

/** Lock / unlock the current view as the search area. */
export function toggleForce(): void {
  const s = getApp(), map = getMap();
  if (!s.mapReady || !map) { toast('แผนที่ยังโหลดอยู่ ลองอีกครั้ง', 'warn'); return; }
  if (s.forceArea) { patchApp({ forceArea: null }); toast('ยกเลิกล็อกพื้นที่ค้นหาแล้ว'); return; }
  const b = map.getBounds();
  patchApp({ forceArea: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  toast('ล็อกพื้นที่นี้ไว้ — เลื่อนแผนที่แล้วผลลัพธ์ไม่เปลี่ยน');
}

export function clearAllFilters(): void {
  patchApp({ filters: { ...EMPTY_FILTERS } });
}

export function resetColumns(): void {
  patchApp({
    colOrder: [...DEFAULT_COL_ORDER],
    colHidden: new Set<ColKey>(DEFAULT_COL_HIDDEN),
    colPinned: new Set<ColKey>(),
    colWidths: {},
  });
}

export function resetAll(): void {
  clearAllFilters();
  patchApp({ sort: { key: 'price', dir: 'desc' }, chartRange: null, pinnedIds: new Set<number>() });
  resetColumns();
  toast('รีเซ็ตตัวกรอง คอลัมน์ และการปักหมุดแล้ว');
}

export function toggleColPin(k: ColKey): void {
  const next = new Set(getApp().colPinned);
  if (next.has(k)) next.delete(k); else next.add(k);
  patchApp({ colPinned: next });
}
export function togglePinRow(id: number): void {
  const next = new Set(getApp().pinnedIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  patchApp({ pinnedIds: next });
}
/** Move column `key` so it sits at position `idx` within its pinned / unpinned zone. */
export function applyReorder(key: ColKey, idx: number): void {
  const { colOrder, colPinned } = getApp();
  const zone = colPinned.has(key);
  const zKeys = colOrder.filter(k => colPinned.has(k) === zone && k !== key);
  const before = zKeys[idx];
  const order = colOrder.filter(k => k !== key);
  if (before != null) order.splice(order.indexOf(before), 0, key);
  else if (zone) {
    const fu = order.findIndex(k => !colPinned.has(k));
    if (fu < 0) order.push(key); else order.splice(fu, 0, key);
  } else order.push(key);
  patchApp({ colOrder: order });
}
