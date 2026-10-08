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
