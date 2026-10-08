import type { LngLat } from '../types';

export const RAD = Math.PI / 180;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpLL = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Haversine distance in metres. */
export function havM(a: LngLat, b: LngLat): number {
  const R = 6371000, dLa = (b[1] - a[1]) * RAD, dLo = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function pathLenM(cs: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < cs.length; i++) s += havM(cs[i - 1], cs[i]);
  return s;
}
export function bearingDeg(a: LngLat, b: LngLat): number {
  const phi = ((a[1] + b[1]) / 2) * RAD, dx = (b[0] - a[0]) * Math.cos(phi), dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}
export function destPoint([lng, lat]: LngLat, brg: number, dist: number): LngLat {
  const R = 6371000, d = dist / R, f1 = lat * RAD, l1 = lng * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [((l2 / RAD + 540) % 360) - 180, f2 / RAD];
}
export const circleRing = (c: LngLat, r: number): LngLat[] =>
  Array.from({ length: 73 }, (_, i) => destPoint(c, i * 5 * RAD, r));

/** Point-in-polygon (ray casting). */
export function pip(pt: LngLat, ring: LngLat[]): boolean {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Spherical polygon area in m² (ring must be closed). */
export function ringAreaM2(ring: LngLat[]): number {
  const R = 6378137;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, t1] = ring[i], [l2, t2] = ring[i + 1];
    a += (l2 - l1) * RAD * (2 + Math.sin(t1 * RAD) + Math.sin(t2 * RAD));
  }
  return Math.abs((a * R * R) / 2);
}
/** Squared distance from a point to a segment (screen space). */
export function d2seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}
export function midPointByLength(cs: LngLat[]): LngLat {
  const total = pathLenM(cs);
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    const seg = havM(cs[i - 1], cs[i]);
    if (acc + seg >= total / 2) return lerpLL(cs[i - 1], cs[i], (total / 2 - acc) / seg);
    acc += seg;
  }
  return cs[cs.length - 1];
}
export const closeRing = (coords: LngLat[]): LngLat[] => [...coords, coords[0]];

/** Slippy-map helpers used by the WMS tile protocol. */
export function tile2lat(y: number, z: number): number {
  const n = 2 ** z, yy = Math.PI - (2 * Math.PI * y) / n;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy)));
}
