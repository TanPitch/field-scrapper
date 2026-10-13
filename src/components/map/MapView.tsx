import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CENTER } from '../../data/constants';
import { useMapEvents } from '../../hooks/useMapEvents';
import { useMapSync } from '../../hooks/useMapSync';
import { buildStyle } from '../../map/style';
import { registerProtocols } from '../../map/protocols';
import { setMap } from '../../map/mapRef';
import { getApp, patchApp, useApp } from '../../store/useApp';
import { centerInside, useSearch } from '../../store/useSearch';
import { DrawBar } from './DrawBar';
import { Crosshair } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { rerunSearch } from '../header/SearchBox';
import { FloodProbe, useFloodProbe } from './FloodProbe';

/**
 * Owns the MapLibre instance. Layers/sources are created imperatively in
 * map/layers.ts; this component only creates the map, wires events and
 * renders the HTML overlays that sit on top of it.
 */
export function MapView() {
  const wrap = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const [map, setMapState] = useState<maplibregl.Map | null>(null);
  const [loaderOff, setLoaderOff] = useState(false);
  const probe = useFloodProbe(wrap);

  useEffect(() => {
    if (!el.current) return;
    registerProtocols();
    const m = new maplibregl.Map({
      container: el.current,
      style: buildStyle(getApp().basemap),
      center: DEFAULT_CENTER,
      // zoom: 12.35,
      zoom: 13, // TODO:
      attributionControl: { compact: true },
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.dragRotate.disable();
    m.touchPitch.disable();
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    setMap(m);
    setMapState(m);
    const lastResort = setTimeout(() => setLoaderOff(true), 6000); /* never leave the loader stuck */
    return () => {
      clearTimeout(lastResort);
      patchApp({ mapReady: false });
      setMap(null);
      setMapState(null);
      m.remove();
    };
  }, []);

  useMapEvents(map, {
    onHideLoader: () => setLoaderOff(true),
    onPointer: e => {
      const s = getApp();
      if (s.floodProbe && s.mapReady) probe.onPointer(e, map?.getZoom() ?? 12, s.flood.maxDataZoom);
    },
    onPointerOut: probe.clear,
  });
  useMapSync();

  /* probe toggled off → hide read-out; cursor hint while on */
  const floodProbe = useApp(s => s.floodProbe);
  useEffect(() => {
    if (!floodProbe) probe.clear();
    if (map) map.getCanvas().style.cursor = floodProbe ? 'crosshair' : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floodProbe, map]);

  /* Floating re-search: only after a title-bar search whose area the map has
     since left. Clicking re-runs that text against the new bbox and sends the
     results to ผลการค้นหา — without reopening the title-bar dropdown. */
  const query = useSearch(s => s.query);
  const lastBox = useSearch(s => s.lastFullBBox);
  const bounds = useApp(s => s.bounds);
  const center: [number, number] | null = bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
  const showAgain = !!lastBox && !!query.trim() && !!center && !centerInside(lastBox, center);

  return (
    <main ref={wrap} className="relative overflow-hidden bg-bg [grid-area:mp]">
      <div ref={el} className="absolute inset-0" />
      <FloodProbe hit={probe.hit} dot={probe.dot} size={probe.size} />
      {showAgain && (
        <button
          {...useTipProps('ค้นหาคำเดิมในช่องค้นหาบนแถบชื่อ ในพื้นที่ที่มองเห็นตอนนี้')}
          onClick={rerunSearch}
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-ink shadow-[0_8px_22px_rgba(0,0,0,.5)] transition hover:bg-[#C9FA57]"
        >
          <Crosshair size={13} />ค้นหาในพื้นที่นี้
        </button>
      )}
      <DrawBar />
      <div className={`absolute inset-0 z-[35] grid place-items-center bg-bg transition-opacity duration-[400ms] ${loaderOff ? 'pointer-events-none opacity-0' : ''}`}>
        <div>
          <div className="spin-keep mx-auto mb-3 size-[26px] animate-spin2 rounded-full border-2 border-line2 border-t-accent" />
          <p className="text-center text-xs text-dim">กำลังโหลดแผนที่ฐาน…</p>
        </div>
      </div>
    </main>
  );
}
