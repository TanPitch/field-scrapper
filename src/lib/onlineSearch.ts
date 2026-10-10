import type { OnlinePlace } from '../store/useSearch';
import type { BBox, Cascade } from '../types';

const inBox = (lng: number, lat: number, b: BBox): boolean => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];

interface NominatimRow { display_name: string; lat: string; lon: string; class?: string; type?: string }
interface GoogleGeoResult {
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: { long_name: string; types: string[] }[];
}
interface GoogleGeoResponse { status: string; results: GoogleGeoResult[]; error_message?: string }
interface GooglePlacesResponse {
  status?: string;
  error_message?: string;
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    types?: string[];
  }[];
}

/** Nominatim lookup restricted to a bbox. Throws on network/HTTP errors. */
async function nominatim(q: string, bbox: BBox, signal: AbortSignal): Promise<OnlinePlace[]> {
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

/** Aborts must not be swallowed by a fallback stage. */
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** "ช.วรรณ 16, ตลาดบางคลาน, กรุงเทพมหานคร" -> "ช.วรรณ 16 · ตลาดบางคลาน" */
const shortAddress = (full: string, parts: number): string => {
  const bits = full.split(',').map(s => s.trim()).filter(Boolean);
  return bits.slice(0, parts).join(' · ') || full;
};

/** Google's Geocoding API — addresses, biased to the current view and to Thailand. */
async function googleGeocode(q: string, bbox: BBox, key: string, signal: AbortSignal): Promise<OnlinePlace[]> {
  const [w, s, e, n] = bbox;
  const url = 'https://maps.googleapis.com/maps/api/geocode/json'
    + '?address=' + encodeURIComponent(q)
    + '&bounds=' + encodeURIComponent(`${w}|${s}|${e}|${n}`)
    + '&region=th&language=th&key=' + encodeURIComponent(key);
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('Google Geocoding HTTP ' + r.status);
  const data = (await r.json()) as GoogleGeoResponse;
  /* ZERO_RESULTS is a legitimate empty answer, not a failure — the caller falls
     through to the next stage. Everything else means the key/quota is wrong. */
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error('Google Geocoding: ' + (data.error_message || data.status));
  }
  return data.results
    .map(x => {
      const loc = x.geometry?.location;
      if (!loc) return null;
      const road = x.address_components?.find(c => c.types.includes('route'))?.long_name;
      return {
        name: road ? shortAddress(x.formatted_address ?? road, 2) : shortAddress(x.formatted_address ?? q, 2),
        lat: loc.lat, lng: loc.lng, src: 'Google Geocoding', cat: 'address',
      };
    })
    .filter((x): x is OnlinePlace => !!x)
    .filter(x => inBox(x.lng, x.lat, bbox));
}

/** Google Places Text Search — real businesses and POIs, biased to the view centre. */
async function googlePlaces(q: string, bbox: BBox, key: string, signal: AbortSignal): Promise<OnlinePlace[]> {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
  const radius = Math.max(50, Math.min(50000, Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 111320 * 0.75));
  const body = {
    textQuery: q,
    languageCode: 'th',
    regionCode: 'TH',
    locationBias: { circle: { center: { latitude: cy, longitude: cx }, radius } },
    maxResultCount: 8,
  };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Google Places HTTP ' + r.status);
  const data = (await r.json()) as GooglePlacesResponse;
  if (data.error_message) throw new Error('Google Places: ' + data.error_message);
  return (data.places ?? [])
    .map(x => {
      if (!x.location) return null;
      return {
        name: x.displayName?.text ?? x.formattedAddress ?? q,
        lat: x.location.latitude, lng: x.location.longitude,
        src: 'Google Places', cat: (x.types ?? [])[0] ?? '',
      };
    })
    .filter((x): x is OnlinePlace => !!x)
    .filter(x => inBox(x.lng, x.lat, bbox));
}

/**
 * Online place search restricted to a bbox.
 *
 * With cascade "google" **and** a key, the Google stages run first — Geocoding
 * for addresses, then Places Text Search for businesses/POIs — and Nominatim is
 * queried only when every Google stage throws or finds nothing in the bbox.
 * Without a key it is Nominatim only. Aborts always propagate.
 */
export async function onlineSearch(q: string, bbox: BBox, cascade: Cascade, gkey: string, signal: AbortSignal): Promise<OnlinePlace[]> {
  if (cascade !== 'google' || !gkey) return nominatim(q, bbox, signal);

  for (const stage of [() => googleGeocode(q, bbox, gkey, signal), () => googlePlaces(q, bbox, gkey, signal)]) {
    let hits: OnlinePlace[] = [];
    try {
      hits = await stage();
    } catch (err) {
      if (isAbort(err)) throw err;
    }
    if (hits.length) return hits;
  }
  return nominatim(q, bbox, signal);
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
