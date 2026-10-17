import { useEffect, useRef } from 'react';
import { debounce } from '../lib/format';
import { isResell } from '../lib/parcelColor';
import {
  applyDrawPrefs, applyLabelLayout, applyOverlayOpacity, applyOverlayVisibility, applyPaint, applyParcelLayerVisibility,
  rebuildFlood, refreshPlates,
} from '../map/layers';
import { position as positionParcelLabels, registerParcels, syncParcelLabels } from '../map/parcelLabels';
import { setUnitOrder, subscribeParcels } from '../data/liveData';
import { markerRows } from '../lib/condoUnits';
import { fc, getMap, ptF, setSourceData } from '../map/mapRef';
import { computeRows } from '../lib/visibility';
import { syncDraws } from '../map/drawEngine';
import { applyPinMarkerSize, syncPinData, syncPinSelectionRing } from '../map/pins';
import { closeAllPopups, refreshOpenPopups } from '../map/popups';
import { patchApp, useApp } from '../store/useApp';
import { useParcels } from './useParcels';

const rebuildFloodSoft = debounce(rebuildFlood, 280);

/**
 * One-way store → map synchronisation. Every effect here replaces what the
 * original single-file app did inside applyVisible() / ad-hoc setters.
 */
export function useMapSync(): void {
  const { vis } = useParcels();
  const mapReady = useApp(s => s.mapReady);
  const persistMapView = useApp(s => s.persistMapView);
  const bounds = useApp(s => s.bounds);

  const popColors = useApp(s => s.popColors);
  const condoUnitOrder = useApp(s => s.condoUnitOrder);
  const reColor = useApp(s => s.reColor);
  const popupMode = useApp(s => s.popupMode);
  const labelOverlap = useApp(s => s.labelOverlap);
  const labelNextDate = useApp(s => s.labelNextDate);
  const showLandKindIcon = useApp(s => s.showLandKindIcon);
  const priceBath = useApp(s => s.priceBath);
  const priceSpace = useApp(s => s.priceSpace);
  const landOn = useApp(s => s.landOn);
  const popupCfg = useApp(s => s.popupCfg);
  const drawDistMode = useApp(s => s.drawDistMode);
  const showCircleMeta = useApp(s => s.showCircleMeta);
  const overlays = useApp(s => s.overlays);
  const flood = useApp(s => s.flood);
  const cctvList = useApp(s => s.cctvList);
  const sensList = useApp(s => s.sensList);
  const cctvOn = useApp(s => s.cctvOn);
  const sensOn = useApp(s => s.sensOn);
  const sensOpacity = useApp(s => s.sensOpacity);
  const transportOn = useApp(s => s.transportOn);
  const transportOpacity = useApp(s => s.transportOpacity);
  const transportList = useApp(s => s.transportList);
  const pinSel = useApp(s => s.pinSel);
  const markerSize = useApp(s => s.markerSize);

/* Parcel dots + compact labels.
   *
   * Refreshes from the collection's own subscription, not from `vis` changing
   * identity. React's memo and the map's GeoJSON source are two separate caches,
   * and when they drifted — map holding the fixture features while the lookup
   * held the live rows — clicking a marker reported "ไม่พบแปลงหมายเลข N" with no
   * visible cause. Driving the source from the same subscription that swaps the
   * collection means the two cannot disagree about which one is current.
   *
   * Inputs are read straight from the store rather than from props, so the
   * subscription callback always sees current state without having to be
   * re-subscribed on every filter tweak. */
  useEffect(() => {
    if (!mapReady) return;

    const refresh = () => {
      const s = useApp.getState();
      const rows = computeRows({
        filters: s.filters, statusVisible: s.statusVisible, pinnedIds: s.pinnedIds,
        restrict: s.restrict, override: s.override, areas: s.areas,
        forceArea: s.forceArea, bounds: s.bounds, zoom: s.zoom,
        mapReady: true, sort: s.sort,
      });
      /* One dot per parcel, not per lot. A condominium building arrives as N
         rows on one coordinate; drawing them all stacks identical dots and
         gives one place N labels and N click targets. The chosen unit follows
         the user's criterion so the dot is explainable, and `units` carries the
         siblings so the label and popup can say how many assets are behind it.
         The table still lists every lot. */
      const markers = markerRows(rows.vis, s.condoUnitOrder);
      setSourceData('parcels', fc(markers.map(m => ptF([m.unit.lng, m.unit.lat], {
        id: m.id,
        status: m.unit.status,
        resell: isResell(m.unit),
        units: m.units.length,
      }))));
      registerParcels(rows.vis);
      syncParcelLabels(rows.vis, s.labelNextDate);
    };

    refresh();
    /* Fires the instant liveData.publish() swaps the collection, before React
       has necessarily re-rendered. */
    const unsub = subscribeParcels(refresh);

    /* …and refresh on every viewport change too. Without these deps the source
       was populated once at load (with whatever bounds existed then) and never
       again, so panning updated the table — whose memo does depend on bounds —
       while the map kept its empty initial set. That was the "table has rows,
       map has no dots" state. */
    const unsubBounds = useApp.subscribe((s, prev) => {
      if (s.bounds !== prev.bounds || s.zoom !== prev.zoom) refresh();
    });

    return () => { unsub(); unsubBounds(); };
  }, [mapReady, priceBath]);

  /* status colours → dots + label plates (reColor feeds the "นำกลับมาขายใหม่" dots) */
  useEffect(() => { if (mapReady) { applyPaint(); refreshPlates(); } }, [mapReady, popColors, reColor]);

  /* The popup and the detail panel resolve a parcel through PARCEL_BY_ID, so the
     cascade has to reach that index too - otherwise the dot picks a unit by the
     user's order and the popup still shows whichever one the API returned last. */
  useEffect(() => { setUnitOrder(condoUnitOrder); }, [condoUnitOrder]);

  /* label layout + land master toggle */
  useEffect(() => { if (mapReady) { applyLabelLayout(); applyParcelLayerVisibility(); } }, [mapReady, popupMode, labelOverlap, landOn]);
  useEffect(() => { document.body.classList.toggle('fs-land-off', !landOn); }, [landOn]);

  /* "ป็อปอัพซ้อนกันได้" culls DOM labels, so re-run the cull right away */
  useEffect(() => { if (mapReady) positionParcelLabels(); }, [mapReady, labelOverlap]);

  /* the land-kind icon is baked into the label markup, so rebuild on toggle */
  useEffect(() => { if (mapReady) syncParcelLabels(vis, labelNextDate); }, [mapReady, showLandKindIcon, labelNextDate]);

  /* the DOM labels are positioned in screen space, so they follow the camera */
  useEffect(() => {
    if (!mapReady) return;
    const map = getMap();
    if (!map) return;
    const on = () => positionParcelLabels();
    map.on('move', on);
    map.on('zoom', on);
    map.on('resize', on);
    return () => {
      map.off('move', on);
      map.off('zoom', on);
map.off('resize', on);
    };
  }, [mapReady]);

  /* Remember where the user left the map, and come back to it on the next
     login. Saved on `moveend` rather than `move`: `move` fires continuously
     during a drag and would push a settings write per frame. `moveend` fires
     once the gesture settles.

     Writing to the synced store is what persists it, so this effect depends on
     `persistMapView` — turning the setting off has to detach the listener, not
     just stop writing, or the map would keep overwriting a deliberately
     discarded position. */
  useEffect(() => {
    if (!mapReady || !persistMapView) return;
    const map = getMap();
    if (!map) return;
    const on = () => {
      const c = map.getCenter();
      patchApp({ lastView: { lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5), zoom: +map.getZoom().toFixed(2) } });
    };
    map.on('moveend', on);
    return () => { map.off('moveend', on); };
  }, [mapReady, persistMapView]);

  /* popups follow settings */
  useEffect(() => { if (popupMode === 'all') closeAllPopups(); }, [popupMode]);
  useEffect(() => { if (mapReady) refreshOpenPopups(); }, [mapReady, popupCfg, popColors, reColor, showLandKindIcon, priceBath, priceSpace]);

  /* drawings: redraw whenever any draw-related state changes (incl. cursor preview) */
  useEffect(() => {
    if (!mapReady) return;
    syncDraws();
    return useApp.subscribe((s, p) => {
      if (
        s.draws !== p.draws || s.areas !== p.areas || s.drawPts !== p.drawPts || s.drawCenter !== p.drawCenter ||
        s.previewR !== p.previewR || s.cursorLL !== p.cursorLL || s.drawMode !== p.drawMode || s.drawTool !== p.drawTool ||
        s.editingDraw !== p.editingDraw
      ) syncDraws();
    });
  }, [mapReady]);
  useEffect(() => { if (mapReady) { applyDrawPrefs(); syncDraws(); } }, [mapReady, drawDistMode, showCircleMeta]);

  /* overlays */
  useEffect(() => {
    if (!mapReady) return;
    overlays.forEach(ov => { applyOverlayVisibility(ov); applyOverlayOpacity(ov); });
  }, [mapReady, overlays]);
  const floodFirst = useRef(true);
  useEffect(() => {
    if (!mapReady) return;
    if (floodFirst.current) { floodFirst.current = false; return; }
    rebuildFloodSoft();
  }, [mapReady, flood]);

  /* pins */
  useEffect(() => { if (mapReady) syncPinData(); }, [mapReady, bounds, cctvList, sensList, cctvOn, sensOn, sensOpacity, transportOn, transportOpacity, transportList]);
  useEffect(() => { if (mapReady) syncPinSelectionRing(); }, [mapReady, pinSel, cctvList, sensList, transportList]);
  useEffect(() => { if (mapReady) { applyPinMarkerSize(); applyPaint(); } }, [mapReady, markerSize]);

  /* keep the canvas sized when side panels animate */
  useEffect(() => {
    const map = getMap();
    const el = map?.getContainer();
    if (!map || !el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => map.resize()); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [mapReady]);
}
