import { MIN_ZOOM } from '../data/constants';
import { ALL_PARCELS } from '../data/mockData';
import type { BBox, FilterArea, Filters, LngLat, Parcel, SortState, Status } from '../types';
import { closeRing, pip } from './geo';

export interface RowInputs {
  filters: Filters;
  statusVisible: Record<Status, boolean>;
  pinnedIds: ReadonlySet<number>;
  restrict: boolean;
  override: boolean;
  areas: FilterArea[];
  forceArea: BBox | null;
  bounds: BBox | null;
  zoom: number;
  mapReady: boolean;
  sort: SortState;
}
export interface RowSets {
  vis: Parcel[];      /* parcels drawn on the map */
  tbl: Parcel[];      /* vis + pinned rows outside the view */
  pinRows: Parcel[];
  normRows: Parcel[];
  viewRows: Parcel[]; /* pinRows then normRows (table order) */
}

export function dataPass(p: Parcel, { filters: f, statusVisible }: Pick<RowInputs, 'filters' | 'statusVisible'>): boolean {
  if (!statusVisible[p.status]) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.province && p.province !== f.province) return false;
  if (f.provinces?.length && !f.provinces.includes(p.province)) return false;
  if (f.minWah != null && p.wah < f.minWah) return false;
  if (f.maxWah != null && p.wah > f.maxWah) return false;
  if (f.tambons?.length && !f.tambons.includes(p.tambon)) return false;
  if (f.amps?.length && !f.amps.includes(p.amp)) return false;
  if (f.propertyTypes?.length && !f.propertyTypes.includes(p.propertyType)) return false;
  if (f.minPrice != null && p.price < f.minPrice) return false;
  if (f.maxPrice != null && p.price > f.maxPrice) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (!(p.name.toLowerCase().includes(q) || p.deed.toLowerCase().includes(q))) return false;
  }
  return true;
}

const inBox = (p: Parcel, b: BBox): boolean => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

export function makeSpatialPass(i: RowInputs): (p: Parcel) => boolean {
  const rings: LngLat[][] = i.areas.filter(a => a.enabled).map(a => closeRing(a.coords));
  const inAnyArea = (p: Parcel): boolean => rings.some(r => pip([p.lng, p.lat], r));
  return p => {
    if (i.pinnedIds.has(p.id)) return true;
    if (i.restrict) return inAnyArea(p);
    if (i.forceArea) return inBox(p, i.forceArea) || (i.override && inAnyArea(p));
    if (i.zoom < MIN_ZOOM || !i.bounds) return i.override && inAnyArea(p);
    return inBox(p, i.bounds) || (i.override && inAnyArea(p));
  };
}

export function makeComparator({ key, dir }: SortState): (a: Parcel, b: Parcel) => number {
  const s = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = a[key], bv = b[key];
    return (typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'th') : (av as number) - (bv as number)) * s;
  };
}

export function computeRows(i: RowInputs): RowSets {
  const spatial = makeSpatialPass(i);
  const vis = i.mapReady
    ? ALL_PARCELS.filter(p => dataPass(p, i) && spatial(p))
    : ALL_PARCELS.filter(p => dataPass(p, i) && !i.pinnedIds.has(p.id));
  const seen = new Set(vis.map(p => p.id));
  const tbl = [...vis, ...ALL_PARCELS.filter(p => i.pinnedIds.has(p.id) && dataPass(p, i) && !seen.has(p.id))];
  const cmp = makeComparator(i.sort);
  const pinRows = tbl.filter(p => i.pinnedIds.has(p.id)).sort(cmp);
  const normRows = tbl.filter(p => !i.pinnedIds.has(p.id)).sort(cmp);
  return { vis, tbl, pinRows, normRows, viewRows: [...pinRows, ...normRows] };
}

export function emptyReason(i: RowInputs): string {
  if (!ALL_PARCELS.some(p => dataPass(p, i))) return 'ไม่มีแปลงที่ตรงกับเงื่อนไขกรอง';
  if (!i.mapReady) return 'กำลังโหลดแผนที่…';
  if (i.restrict && !i.areas.length && !i.pinnedIds.size) return 'แสดงเฉพาะพื้นที่กรอง: วาดพื้นที่กรองก่อน (แผงพื้นที่กรองจุด)';
  if (!i.restrict && i.zoom < MIN_ZOOM && !i.forceArea && !i.pinnedIds.size) return 'ซูมเกินระดับ 12 เพื่อแสดงจุดในมุมมอง';
  return 'ไม่มีจุดในกรอบมุมมองปัจจุบัน';
}
