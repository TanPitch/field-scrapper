import { useEffect, useRef } from 'react';
import { debounce } from '../lib/format';
import { isResell } from '../lib/parcelColor';
import {
  applyDrawPrefs, applyLabelLayout, applyOverlayOpacity, applyOverlayVisibility, applyPaint, applyParcelLayerVisibility,
  rebuildFlood, refreshPlates,
} from '../map/layers';
import { fc, getMap, ptF, setSourceData } from '../map/mapRef';
import { syncDraws } from '../map/drawEngine';
import { applyPinMarkerSize, syncPinData, syncPinSelectionRing } from '../map/pins';
import { closeAllPopups, refreshOpenPopups } from '../map/popups';
import { useApp } from '../store/useApp';
import { fmtShortMoneyNow } from './useMoney';
import { numDate } from '../lib/format';
import { useParcels } from './useParcels';

const rebuildFloodSoft = debounce(rebuildFlood, 280);

/**
 * One-way store → map synchronisation. Every effect here replaces what the
 * original single-file app did inside applyVisible() / ad-hoc setters.
 */
export function useMapSync(): void {
  const { vis } = useParcels();
  const mapReady = useApp(s => s.mapReady);
  const bounds = useApp(s => s.bounds);

  const popColors = useApp(s => s.popColors);
  const reColor = useApp(s => s.reColor);
  const popupMode = useApp(s => s.popupMode);
  const labelOverlap = useApp(s => s.labelOverlap);
  const labelSold = useApp(s => s.labelSold);
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

  /* parcel dots + compact labels */
  useEffect(() => {
    if (!mapReady) return;
    setSourceData('parcels', fc(vis.map(p => ptF([p.lng, p.lat], { id: p.id, status: p.status, resell: isResell(p) }))));
    setSourceData('labels', fc(vis.map(p => ptF([p.lng, p.lat], {
      status: p.status,
      lp: fmtShortMoneyNow(p.price) + (labelSold && p.soldTs ? '\n' + numDate(p.soldTs) : ''),
    }))));
  }, [mapReady, vis, labelSold, priceBath]);

  /* status colours → dots + label plates (reColor feeds the "นำกลับมาขายใหม่" dots) */
  useEffect(() => { if (mapReady) { applyPaint(); refreshPlates(); } }, [mapReady, popColors, reColor]);

  /* label layout + land master toggle */
  useEffect(() => { if (mapReady) { applyLabelLayout(); applyParcelLayerVisibility(); } }, [mapReady, popupMode, labelOverlap, landOn]);
  useEffect(() => { document.body.classList.toggle('fs-land-off', !landOn); }, [landOn]);

  /* popups follow settings */
  useEffect(() => { if (popupMode === 'all') closeAllPopups(); }, [popupMode]);
  useEffect(() => { if (mapReady) refreshOpenPopups(); }, [mapReady, popupCfg, popColors, reColor, priceBath, priceSpace]);

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
