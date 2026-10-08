import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapId } from '../types';

/**
 * One permanent style. Layer order (bottom → top):
 * [CARTO fallback] → [Google Road] → [Google Satellite].
 * Switching basemap is visibility-only, so custom layers can never be destroyed,
 * and if Google tiles are blocked the fallback shows through (never a blank map).
 */
export function buildStyle(basemap: BasemapId): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      fallback: {
        type: 'raster', tileSize: 256, attribution: '© CARTO',
        tiles: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
      },
      'g-road': { type: 'raster', tiles: ['https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'], tileSize: 256, attribution: 'Google' },
      'g-sat': { type: 'raster', tiles: ['https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'], tileSize: 256, attribution: 'Google' },
    },
    layers: [
      { id: 'fallback-l', type: 'raster', source: 'fallback' },
      { id: 'g-road-l', type: 'raster', source: 'g-road', layout: { visibility: basemap === 'road' ? 'visible' : 'none' } },
      { id: 'g-sat-l', type: 'raster', source: 'g-sat', layout: { visibility: basemap === 'sat' ? 'visible' : 'none' } },
    ],
  };
}
