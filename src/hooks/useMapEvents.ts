import type maplibregl from 'maplibre-gl';
import { useEffect } from 'react';
import { addCustomLayers, addOverlayLayers } from '../map/layers';
import { requireMap } from '../map/mapRef';
import {
  areaClick, drawClick, drawPointerMove, dragVertex, editClick, endVertexDrag, finishDraw, isVertexDragging, vertexDown,
  type PtrEvent,
} from '../map/drawEngine';
import { initPinLayers, seedPins } from '../map/pins';
import { closeHoverPopup, getClickPopId, openHoverPopup, toggleClickPopup } from '../map/popups';
import { PARCEL_BY_ID } from '../data/liveData';
import { deselect, select } from '../store/actions';
import { getApp, patchApp, toast } from '../store/useApp';
import type { BBox } from '../types';

export function readBounds(map: maplibregl.Map): BBox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

interface Options {
  onHideLoader: () => void;
  onPointer: (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => void;
  onPointerOut: () => void;
}

/**
 * Wires every MapLibre event to the store / engines. Re-run only when the map
 * instance changes (the handlers read fresh state via getApp()).
 */
export function useMapEvents(map: maplibregl.Map | null, { onHideLoader, onPointer, onPointerOut }: Options): void {
  useEffect(() => {
    if (!map) return;
    const CAN_HOVER = window.matchMedia('(hover: hover)').matches;
    let healPasses = 0, gErrCount = 0, gErrToasted = false, lastHover = 0, raf = 0;
    let pending: (maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) | null = null;

    const syncBounds = () => patchApp({ bounds: readBounds(map), zoom: map.getZoom() });

    const onLoad = () => {
      /* Fixed stack, bottom → top:
           overlay → cctv → bus → water → land parcel → (DOM overlay) → panel UI
         Overlays must exist before the pins, and the parcel layers last, so the
         parcel dots sit on top of every point marker. */
      try { addOverlayLayers(); } catch (err) { console.error('[load] overlays:', err); }
      try { seedPins(); initPinLayers(); } catch (err) { console.error('[load] pins:', err); }
      try { addCustomLayers(); } catch (err) { console.error('[load] addCustomLayers:', err); }
      patchApp({ mapReady: true });
      syncBounds();
      onHideLoader();
      toast('พร้อมใช้งาน — ข้อมูลพร้อมแสดงบนแผนที่');
    };
    /* Self-heal: re-add custom layers on the first few idle frames, always hide the loader. */
    const onIdle = () => {
      onHideLoader();
      if (getApp().mapReady && healPasses < 3) {
        healPasses++;
        try { addCustomLayers(); } catch (err) { console.error('[idle] heal:', err); }
      }
    };
    const onError = (e: { sourceId?: string }) => {
      if (e.sourceId === 'g-road' || e.sourceId === 'g-sat') {
        gErrCount++;
        if (gErrCount >= 4 && !gErrToasted) {
          gErrToasted = true;
          toast('โหลดแผนที่ฐาน Google ไม่สำเร็จ (เครือข่าย/ถูกบล็อก) — แสดงแผนที่สำรอง (CARTO) ชั่วคราว', 'warn');
        }
      }
    };

    const onHover = (e: maplibregl.MapLayerMouseEvent) => {
      const s = getApp();
      if (s.drawMode || s.editingDraw != null || !CAN_HOVER) return;
      map.getCanvas().style.cursor = 'pointer';
      const now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      const id = Number(e.features?.[0]?.properties?.id);
      if (id === getClickPopId()) return;
      if (s.popupMode === 'active') openHoverPopup(PARCEL_BY_ID.get(id));
    };
    const onLeave = () => { map.getCanvas().style.cursor = ''; closeHoverPopup(); };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const s = getApp();
      if (s.drawMode === 'draw') { drawClick(e); return; }
      if (s.drawMode === 'area') { areaClick(e); return; }
      if (s.editingDraw != null) { editClick(e); return; }
      const fs = map.queryRenderedFeatures(e.point, { layers: ['parcels-dot'] });
      if (fs.length) {
        const id = Number(fs[0].properties?.id);
        /* Re-clicking the selected marker toggles its popup — but only in
           'active' mode. select() gates the popup open on popupMode itself, so
           without this guard the *second* click on an already-selected marker
           opened a popup even in 'all' mode, where clicking is supposed to do
           nothing but fill the right-hand panel. */
        if (id === s.selectedId) { if (s.popupMode === 'active') toggleClickPopup(id); }
        else select(id, { fly: false });
      } else if (s.selectedId != null) deselect();
    };
    /* Right-click a marker to copy its exact coordinate. Temporary, for checking
     * resolved positions against TD and DOL by hand. Copying the feature's own
     * lat/lng rather than the click position matters - the click lands wherever
     * the cursor is, which is not where the marker is. */
    const onContext = (e: maplibregl.MapMouseEvent) => {
        e.preventDefault();
        const fs = map.queryRenderedFeatures(e.point, { layers: ['parcels-dot'] });
        if (!fs.length) return;
        const p = fs[0].properties ?? {};
        const text = `${p.lat}, ${p.lng}`;
        navigator.clipboard?.writeText(text).then(
            () => toast(`คัดลอกพิกาดแล้ว: ${text}`),
            () => toast(text, 'warn'),
        );
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      const s = getApp();
      if (s.drawMode === 'draw' && s.drawTool !== 'circle') { e.preventDefault(); finishDraw(); }
    };

    /* pointer moves are coalesced to one update per animation frame */
    const flush = () => {
      raf = 0;
      const e = pending; pending = null;
      if (!e) return;
      if (isVertexDragging()) { dragVertex(e as PtrEvent); return; }
      const s = getApp();
      if (s.drawMode && (s.drawMode !== 'draw' || s.drawTool !== 'circle' || s.drawCenter)) { drawPointerMove(e as PtrEvent); return; }
      onPointer(e);
    };
    const queueMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      pending = e;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const vertMouse = () => { if (getApp().editingDraw != null) map.getCanvas().style.cursor = 'move'; };
    const vertLeave = () => { if (getApp().editingDraw != null) map.getCanvas().style.cursor = ''; };
    const onUp = () => { if (isVertexDragging()) endVertexDrag(); };
    const vDown = (e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) => vertexDown(e as unknown as PtrEvent & { features?: GeoJSON.Feature[] });

    if (map.loaded() && map.isStyleLoaded()) onLoad(); else map.once('load', onLoad);
    map.on('idle', onIdle);
    map.on('error', onError);
    map.on('moveend', syncBounds);
    map.on('mousemove', 'parcels-dot', onHover);
    map.on('mouseleave', 'parcels-dot', onLeave);
    map.on('mouseenter', 'draw-verts', vertMouse);
    map.on('mouseleave', 'draw-verts', vertLeave);
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    map.on('dblclick', onDbl);
    map.on('mousemove', queueMove);
    map.on('touchmove', queueMove);
    map.on('mouseout', onPointerOut);
    map.on('touchend', onPointerOut);
    map.on('mousedown', 'draw-verts', vDown);
    map.on('touchstart', 'draw-verts', vDown);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);

    return () => {
      cancelAnimationFrame(raf);
      map.off('load', onLoad);
      map.off('idle', onIdle);
      map.off('error', onError);
      map.off('moveend', syncBounds);
      map.off('mousemove', 'parcels-dot', onHover);
      map.off('mouseleave', 'parcels-dot', onLeave);
      map.off('mouseenter', 'draw-verts', vertMouse);
      map.off('mouseleave', 'draw-verts', vertLeave);
      map.off('click', onClick);
      map.off('dblclick', onDbl);
      map.off('mousemove', queueMove);
      map.off('touchmove', queueMove);
      map.off('mouseout', onPointerOut);
      map.off('touchend', onPointerOut);
      map.off('mousedown', 'draw-verts', vDown);
      map.off('touchstart', 'draw-verts', vDown);
      map.off('mouseup', onUp);
      map.off('touchend', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
}

export { requireMap };
