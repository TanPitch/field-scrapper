/* lib/coord.ts — the one coordinate-text parser.
 *
 * "16.46796629,102.83515227" pasted as one field, two numbers split across two
 * boxes, or a stray comma/space between them — every separator between two
 * decimals is a split point, so the sources' contents merge into one lat,lng
 * pair. Swapped or unit-text pastes fail (null) rather than placing land in
 * the Gulf of Thailand. Used by ข้อมูลตกหล่น' together with any admin
 * lat/lng input. */

export function parseCoordPair(...sources: string[]): [number, number] | null {
  const nums: number[] = [];
  for (const f of sources) {
    for (const piece of f.split(/[,\s;|]+/)) {
      if (!piece.trim()) continue;
      const n = Number(piece);
      if (!Number.isFinite(n)) continue;
      nums.push(n);
    }
  }
  if (nums.length < 2) return null;
  const [lat, lon] = nums;
  /* Thailand's box, so a swapped pair is an error, not a location. */
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat < 5 || lat > 21 || lon < 97 || lon > 106) return null;
  return [lat, lon];
}
