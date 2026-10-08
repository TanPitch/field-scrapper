import { POIS } from '../data/constants';
import type { OnlinePlace } from '../store/useSearch';
import type { BBox, Cascade } from '../types';

const inBox = (lng: number, lat: number, b: BBox): boolean => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface NominatimRow { display_name: string; lat: string; lon: string; class?: string; type?: string }

/**
 * Online place search restricted to a bbox.
 * cascade "google" + key → simulated Google (local POI list); otherwise Nominatim with viewbox+bounded.
 * Throws on network/HTTP errors (AbortError included — callers decide what to do).
 */
export async function onlineSearch(q: string, bbox: BBox, cascade: Cascade, gkey: string, signal: AbortSignal): Promise<OnlinePlace[]> {
  const needle = q.toLowerCase();
  if (cascade === 'google' && gkey) {
    await sleep(400);
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    return POIS.filter(x => x[0].toLowerCase().includes(needle) && inBox(x[1], x[2], bbox)).slice(0, 5)
      .map(x => ({ name: x[0], lat: x[2], lng: x[1], src: 'Google (จำลอง)', cat: x[3] }));
  }
  const [w, s, e, n] = bbox;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=8&accept-language=th'
    + '&viewbox=' + encodeURIComponent(`${w},${s},${e},${n}`) + '&bounded=1&q=' + encodeURIComponent(q);
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = (await r.json()) as NominatimRow[];
  return rows
    .map(x => ({ name: x.display_name.split(',').slice(0, 2).join(', '), lat: +x.lat, lng: +x.lon, src: 'Nominatim', cat: `${x.class ?? ''} ${x.type ?? ''}` }))
    .filter(x => inBox(x.lng, x.lat, bbox));
}

/** OSM category → lucide icon name (first match wins). */
const POI_ICONS: [RegExp, string][] = [
  [/restaurant|fast_food|cafe|bar|pub|food/, 'utensils'], [/hotel|guest_house|hostel|resort|motel/, 'bed'],
  [/shop|supermarket|mall|market|store|convenience/, 'shopping-bag'], [/fuel|gas/, 'fuel'],
  [/hospital|clinic|pharmacy|doctor|dentist/, 'cross'], [/school|university|college|kindergarten|institute/, 'graduation-cap'],
  [/bank|atm|finance|money/, 'landmark'], [/police/, 'shield'], [/parking/, 'square-parking'],
  [/park|garden|playground/, 'trees'], [/place_of_worship|temple|church|mosque|wat/, 'church'],
  [/aerodrome|airport|harbour|ferry/, 'plane'], [/road|street|town|suburb|village|city/, 'signpost'],
];
export const poiIcon = (cat = ''): string => {
  const c = cat.toLowerCase();
  return POI_ICONS.find(([re]) => re.test(c))?.[1] ?? 'map-pin';
};
