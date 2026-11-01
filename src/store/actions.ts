import { BASEMAPS, DEFAULT_COL_HIDDEN, DEFAULT_COL_ORDER } from '../data/constants';
import { PARCEL_BY_ID, diagnoseParcels } from '../data/liveData';
import { getMap, hasLayer } from '../map/mapRef';
import { setGroupRing } from '../map/layers';
import { closeClickPopup, closeHoverPopup, getClickPopId, getHoverPopId, openClickPopup, setPopupDismissHandler } from '../map/popups';
import type { BasemapId, ColKey, Overlay, OverlayId, RightView } from '../types';
import { EMPTY_FILTERS, getApp, patchApp, toast } from './useApp';
import { groupOf } from '../lib/group';

/**
 * Clear the selection only once nothing on screen refers to it any more.
 *
 * They are separate dismissals and the user may mean either one. Closing just the
 * popup leaves the ring and the panel; closing just the panel leaves the popup
 * and the ring. The panel also stops referring to the parcel without closing at
 * all — opening search results or the pin settings replaces the detail view in
 * place — and that counts as a dismissal too, which is why this looks at the
 * view and not only at `rightOpen`.
 */
function maybeClearSelection(): void {
    const s = getApp();
    if (s.selectedId == null) return;
    if (s.rightOpen && s.rpView === 'detail') return;
    if (getClickPopId() != null) return;
    deselect();
}

export function setRight(open: boolean): void {
    patchApp({ rightOpen: open });
    if (!open) maybeClearSelection();
}
export function setLeft(open: boolean): void { patchApp({ leftOpen: open }); }
export function setRpView(v: RightView): void {
    patchApp({ rpView: v });
    maybeClearSelection();
}
export function showRight(v: RightView): void { patchApp({ rpView: v, rightOpen: true }); }

/**
 * Parcels that sell together with `id` — LED group sale sibling resolution
 * lives in lib/group.ts so price.ts can share it without dragging the map
 * modules into the price path; the click handler calls the same function.
 */

export function select(id: number, { fly = true }: { fly?: boolean } = {}): void {
const p = PARCEL_BY_ID.get(id);
    /* Silent failure is what made this look like "clicking does nothing": the
       marker highlights, the panel does not open, and nothing says why. Report
       what is actually in each collection rather than a bare "not found" — if
       the table is rendering rows that this Map has never heard of, that is two
       live copies of the data module, and `instance` proves it. */
    if (!p) {
      const d = diagnoseParcels(id);
      console.error('[select] parcel not found', d);
      toast(`ไม่พบแปลงหมายเลข ${id} — แถว ${d.rows} / ดัชนี ${d.mapSize} / id ตัวอย่าง ${JSON.stringify(d.sampleIds)}`, 'warn');
      return;
    }
  const map = getMap();
  const group = groupOf(id);
  patchApp({ selectedId: id, groupIds: group, rpView: 'detail', rightOpen: true, pinSel: String(id) });
  /* A group sale rings every parcel that sells together, not just the one the
     pointer happened to land on. The primary keeps its solid stroke on the
     halo layer; every sibling gets the dashed ring (line layer — see
     layers.setGroupRing, because circle strokes cannot dash). */
  if (map && hasLayer('parcels-halo')) map.setFilter('parcels-halo', ['==', ['get', 'id'], id]);
  if (map && hasLayer('parcels-ring')) {
    setGroupRing(id, group
      .filter((gid) => gid !== id)
      .map((gid) => PARCEL_BY_ID.get(gid))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map((q) => [q.lng, q.lat] as [number, number]));
  }
  if (getHoverPopId() === id) closeHoverPopup();
  if (getApp().popupMode === 'active') openClickPopup(p);
  if (fly && map) map.flyTo({ center: [p.lng, p.lat], zoom: 15.5, duration: 850 });
}

export function deselect(): void {
  const map = getMap();
  /* selectedId is cleared first, deliberately. closeClickPopup() fires the
     popup's own close event, which calls back into here; by then there is
     nothing selected and the handler stops. Clearing it after the close would
     re-enter deselect() and recurse. */
  patchApp({ selectedId: null, groupIds: [], pinSel: null });
  if (map && hasLayer('parcels-halo')) map.setFilter('parcels-halo', ['==', ['get', 'id'], -1]);
  if (map && hasLayer('parcels-ring')) setGroupRing(null, []);
  closeClickPopup();
}

/* Dismissing the popup by hand (its X, or Escape) is one of the two closable
   surfaces. Whether it counts as "done" depends on the panel — see
   maybeClearSelection. */
setPopupDismissHandler(() => {
  maybeClearSelection();
});

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
