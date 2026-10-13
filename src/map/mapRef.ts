import type maplibregl from 'maplibre-gl';

/**
 * Module-level handle to the single MapLibre instance.
 * React components create it (MapView) and imperative helpers (draw engine,
 * popups, pins) read it — this avoids prop-drilling a mutable, non-serialisable
 * object through the tree and keeps it out of the zustand store.
 */
let current: maplibregl.Map | null = null;

export const setMap = (m: maplibregl.Map | null): void => { current = m; };
export const getMap = (): maplibregl.Map | null => current;
export const requireMap = (): maplibregl.Map => {
  if (!current) throw new Error('Map not initialised');
  return current;
};

export const hasLayer = (id: string): boolean => !!current?.getLayer(id);
export const setSourceData = (id: string, data: GeoJSON.FeatureCollection): void => {
  const src = current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData(data);
};
export const setVisibility = (layer: string, on: boolean): void => {
  if (current?.getLayer(layer)) current.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
};

export const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
export const ptF = (c: [number, number], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: props,
});

/**
 * Move the camera so `points` are all visible. Returns false when there is
 * nothing to frame or no map yet.
 *
 * This exists because the app opens on DEFAULT_CENTER (Bangkok) while the data
 * can be anywhere in the country. The visibility pipeline filters to the current
 * viewport, so parcels outside it are not merely off-screen — they are excluded
 * from the map source entirely, and there is nothing to click. "Loaded 30
 * parcels" and "shows 0 markers" are the same state, which is how this went
 * unnoticed.
 */
export const framePoints = (points: Array<[number, number]>, opts?: { padding?: number; maxZoom?: number }): boolean => {
  const map = current;
  if (!map || !points.length) return false;

  let w = points[0][0], e = points[0][0], s = points[0][1], n = points[0][1];
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  if (![w, e, s, n].every(Number.isFinite)) return false;

  /* A single parcel, or several at effectively one spot, has no extent to fit.
     easeTo keeps the user oriented; fitBounds on a zero-area box is undefined. */
  if (e - w < 0.005 && n - s < 0.005) {
    map.easeTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 14, duration: 700, essential: true });
    return true;
  }

  map.fitBounds([[w, s], [e, n]], {
    padding: opts?.padding ?? 70,
    maxZoom: opts?.maxZoom ?? 13.5,
    duration: 700,
  });
  return true;
};
