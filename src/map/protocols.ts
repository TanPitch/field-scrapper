import maplibregl from 'maplibre-gl';
import { WMS_BASE } from '../data/constants';
import { hexRgb } from '../lib/color';
import { RAD, lerp, tile2lat } from '../lib/geo';
import { getApp } from '../store/useApp';

/* ======================= Flood tiles (Terrarium DEM) ======================= */
const TERRARIUM = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

async function floodTile(params: { url: string }): Promise<{ data: ArrayBuffer }> {
  const m = params.url.match(/flood:\/\/f\/(\d+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) throw new Error('bad flood url');
  const z = +m[2], x = +m[3], y = +m[4];
  const flood = getApp().flood;
  const sz = 256;
  const zReq = Math.min(z, flood.maxDataZoom);
  const factor = 2 ** (z - zReq);
  const xReq = Math.floor(x / factor), yReq = Math.floor(y / factor);
  const srcX = (x % factor) * (sz / factor), srcY = (y % factor) * (sz / factor);
  const srcW = sz / factor, srcH = sz / factor;

  const resp = await fetch(TERRARIUM(zReq, xReq, yReq));
  if (!resp.ok) throw new Error('DEM tile HTTP ' + resp.status);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, srcX, srcY, srcW, srcH, 0, 0, sz, sz);
  const img = ctx.getImageData(0, 0, sz, sz), d = img.data;

  const { sea, dry } = flood;
  const [flr, flg, flb] = hexRgb(flood.floodLo.c), [fhr, fhg, fhb] = hexRgb(flood.floodHi.c);
  const [dlr, dlg, dlb] = hexRgb(flood.dryLo.c), [dhr, dhg, dhb] = hexRgb(flood.dryHi.c);
  for (let i = 0; i < d.length; i += 4) {
    const el = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
    const depth = sea - el;
    if (depth > 0) {
      const t = Math.min(1, depth / 20);
      d[i] = lerp(flr, fhr, t); d[i + 1] = lerp(flg, fhg, t); d[i + 2] = lerp(flb, fhb, t);
      d[i + 3] = Math.round(255 * lerp(flood.floodLo.a, flood.floodHi.a, t));
    } else if (dry) {
      const t = Math.min(1, Math.max(0, el / 1500));
      let r = lerp(dlr, dhr, t), g = lerp(dlg, dhg, t), b = lerp(dlb, dhb, t);
      const frac = ((el % 10) + 10) % 10; /* contour lines also work below 0 m */
      if (frac < 0.4 || frac > 9.6) { r = Math.min(r + 35, 255); g = Math.min(g + 35, 255); b = Math.min(b + 35, 255); }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = Math.round(255 * lerp(flood.dryLo.a, flood.dryHi.a, t));
    } else d[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  const out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  if (!out) throw new Error('toBlob failed');
  return { data: await out.arrayBuffer() };
}

/* ---------- point elevation probe (cached DEM tiles) ---------- */
const elevCache = new Map<string, Promise<ImageData>>();
export async function elevAt(lng: number, lat: number, z: number): Promise<number> {
  const n = 2 ** z;
  const tx = ((lng + 180) / 360) * n;
  const lr = lat * RAD;
  const ty = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n;
  const X = Math.floor(tx), Y = Math.floor(ty);
  const key = `${z}/${((X % n) + n) % n}/${Math.min(n - 1, Math.max(0, Y))}`;
  let entry = elevCache.get(key);
  if (!entry) {
    entry = fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`)
      .then(r => { if (!r.ok) throw new Error('DEM tile HTTP ' + r.status); return r.blob(); })
      .then(blob => createImageBitmap(blob))
      .then(bmp => {
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('2d context unavailable');
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      });
    const pending = entry;
    pending.catch(() => elevCache.delete(key)); /* never cache a failed tile */
    elevCache.set(key, pending);
    if (elevCache.size > 60) {
      const first = elevCache.keys().next().value;
      if (first !== undefined) elevCache.delete(first);
    }
  }
  const img = await entry;
  const px = Math.min(img.width - 1, Math.floor((tx - X) * img.width));
  const py = Math.min(img.height - 1, Math.floor((ty - Y) * img.height));
  const i = (py * img.width + px) * 4;
  return img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256 - 32768;
}

/* ======================= WMS tiles (axis-order auto-detect) ======================= */
let wmsOrder: 'xy' | 'yx' = 'xy';
export function wmsTileUrl(z: number, x: number, y: number): string {
  const n = 2 ** z;
  const w = (x / n) * 360 - 180, e = ((x + 1) / n) * 360 - 180;
  const nLat = tile2lat(y, z), sLat = tile2lat(y + 1, z);
  return wmsOrder === 'xy'
    ? `${WMS_BASE}&BBOX=${w},${sLat},${e},${nLat}`
    : `${WMS_BASE}&BBOX=${sLat},${w},${nLat},${e}`;
}
async function wmsTile(params: { url: string }): Promise<{ data: ArrayBuffer }> {
  const m = params.url.match(/wms:\/\/dol_hd\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) throw new Error('bad wms url');
  const z = +m[1], x = +m[2], y = +m[3];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(wmsTileUrl(z, x, y));
    if (r.ok) return { data: await (await r.blob()).arrayBuffer() };
    if (attempt === 0) wmsOrder = wmsOrder === 'xy' ? 'yx' : 'xy';
  }
  throw new Error('WMS failed (both axis orders)');
}

let registered = false;
/** Idempotent — safe under React StrictMode double-mount. */
export function registerProtocols(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('flood', floodTile);
  maplibregl.addProtocol('wms', wmsTile);
}

/* ======================= API connectivity tests (settings → search & API) ======================= */
export const tileTest = (url: string): Promise<string> =>
  new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res('tile OK');
    img.onerror = () => rej(new Error('โหลด tile ไม่สำเร็จ'));
    img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  });
export const nominatimTest = async (): Promise<string> => {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent('กรุงเทพมหานคร'));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d: unknown[] = await r.json();
  return d.length + ' ผลลัพธ์';
};
