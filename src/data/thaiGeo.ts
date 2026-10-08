/**
 * Thai administrative-area data.
 *
 * Source files (drop the real exports here, same shape):
 *   ./geo/provinces.json      — every entry: { id, name: { th, en }, prefix: null, geography_id }
 *   ./geo/districts.json      — every entry: { id, name, prefix: { th, en }, province_id }
 *   ./geo/subDistricts.json   — every entry: { id, zip_code, name, prefix, district_id }
 *
 * The loader below normalises those raw rows into flat lookups keyed by name, so
 * the UI never has to care about id numbering. Parcels store plain place names,
 * and `districtByName` / `subDistrictByName` resolve them back to the hierarchy.
 */
import districtsRaw from './geo/districts.json';
import provincesRaw from './geo/provinces.json';
import subDistrictsRaw from './geo/subDistricts.json';

export interface Province {
  id: number;
  name: string;
  nameEn: string;
}
export interface District {
  id: number;
  name: string;
  nameEn: string;
  /** Display prefix, e.g. เขต for Bangkok, อำเภอ elsewhere. */
  prefix: string;
  prefixEn: string;
  provinceId: number;
}
export interface SubDistrict {
  id: number;
  name: string;
  nameEn: string;
  prefix: string;
  prefixEn: string;
  districtId: number;
}

/* --- raw row shapes (only the fields we use) --- */
interface RawName { th: string; en: string }
interface RawProvince { id: number; name: RawName; geography_id?: number }
interface RawDistrict { id: number; name: RawName; prefix: RawName | null; province_id: number }
interface RawSubDistrict { id: number; zip_code: number; name: RawName; prefix: RawName | null; district_id: number }

export const PROVINCES: Province[] = (provincesRaw as RawProvince[]).map(p => ({
  id: p.id,
  name: p.name.th,
  nameEn: p.name.en,
}));

export const DISTRICTS: District[] = (districtsRaw as RawDistrict[]).map(d => ({
  id: d.id,
  name: d.name.th,
  nameEn: d.name.en,
  prefix: d.prefix?.th ?? 'อำเภอ',
  prefixEn: d.prefix?.en ?? 'Amphoe',
  provinceId: d.province_id,
}));

export const SUB_DISTRICTS: SubDistrict[] = (subDistrictsRaw as RawSubDistrict[]).map(s => ({
  id: s.id,
  name: s.name.th,
  nameEn: s.name.en,
  prefix: s.prefix?.th ?? 'ตำบล',
  prefixEn: s.prefix?.en ?? 'Tambon',
  districtId: s.district_id,
}));

/* --- name-keyed lookups: parcels store place names, not ids --- */

const provinceByName = new Map(PROVINCES.map(p => [p.name, p]));
const districtsByProvince = new Map<number, District[]>();
DISTRICTS.forEach(d => {
  const list = districtsByProvince.get(d.provinceId) ?? [];
  list.push(d);
  districtsByProvince.set(d.provinceId, list);
});
const subDistrictsByDistrict = new Map<number, SubDistrict[]>();
SUB_DISTRICTS.forEach(s => {
  const list = subDistrictsByDistrict.get(s.districtId) ?? [];
  list.push(s);
  subDistrictsByDistrict.set(s.districtId, list);
});

const sortTh = (a: string, b: string): number => a.localeCompare(b, 'th');

/** All province names, sorted. */
export const provinceNames = (): string[] => PROVINCES.map(p => p.name).sort(sortTh);

/** Districts in a province. Empty string (or unknown province) returns every district. */
export function districtNames(province: string): string[] {
  const p = provinceByName.get(province);
  if (!p) return [...new Set(DISTRICTS.map(d => d.name))].sort(sortTh);
  return (districtsByProvince.get(p.id) ?? []).map(d => d.name).sort(sortTh);
}

/** Subdistricts in a province + district. Blank parts fall back to the wider scope. */
export function subDistrictNames(province: string, district: string): string[] {
  const p = province ? provinceByName.get(province) : null;
  const d = district ? DISTRICTS.find(x => x.name === district && (!p || x.provinceId === p.id)) : null;
  if (!d) {
    const pool = p ? DISTRICTS.filter(x => x.provinceId === p.id) : DISTRICTS;
    const ids = new Set(pool.map(x => x.id));
    return [...new Set(SUB_DISTRICTS.filter(s => ids.has(s.districtId)).map(s => s.name))].sort(sortTh);
  }
  return (subDistrictsByDistrict.get(d.id) ?? []).map(s => s.name).sort(sortTh);
}

/** Display label with the correct prefix, e.g. "เขตพระนคร" / "อำเภนเมือง". */
export function districtLabel(name: string): string {
  const d = DISTRICTS.find(x => x.name === name);
  return d ? `${name}` : name;
}
export function subDistrictLabel(name: string): string {
  const s = SUB_DISTRICTS.find(x => x.name === name);
  return s ? `${name}` : name;
}

/** Which provinces contain this district — used to auto-fill the parent. */
export function provincesOfDistrict(district: string): string[] {
  const d = DISTRICTS.find(x => x.name === district);
  if (!d) return [];
  const p = PROVINCES.find(x => x.id === d.provinceId);
  return p ? [p.name] : [];
}

/** Provinces + districts containing this subdistrict — used to auto-fill both parents. */
export function parentsOfSub(subDistrict: string, district: string): { provinces: string[]; districts: string[] } {
  const candidates = SUB_DISTRICTS.filter(s => s.name === subDistrict);
  const scoped = district ? candidates.filter(s => DISTRICTS.some(d => d.id === s.districtId && d.name === district)) : candidates;
  const pool = scoped.length ? scoped : candidates;
  const ds = pool.map(s => DISTRICTS.find(d => d.id === s.districtId)).filter((d): d is District => !!d);
  return {
    districts: [...new Set(ds.map(d => d.name))].sort(sortTh),
    provinces: [...new Set(ds.map(d => PROVINCES.find(p => p.id === d.provinceId)?.name).filter((n): n is string => !!n))].sort(sortTh),
  };
}