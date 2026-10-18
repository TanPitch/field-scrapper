import { test, expect } from 'bun:test';
import { dataPass } from '../src/lib/visibility';
import type { Parcel, Status } from '../src/types';

/* The map draws markerRows(rows.vis) and the table draws rows.tbl. Both come out
   of computeRows, which gates on this function - so a filter that does not reach
   here reaches neither, and a filter that leaks past here leaks onto the map.
   These pin that contract for the fields the filter popup edits. */

const base = {
  id: 1,
  status: 'sale' as Status,
  resell: false,
  wah: 100,
  price: 1_000_000,
  perWah: 10_000,
  name: 'ที่ดิน',
  deed: '1234',
  province: 'ภูเก็ต',
  amp: 'เมือง',
  tambon: 'รัษฎา',
  propertyType: 'ที่ดินว่างเปล่า',
  lat: 7.8,
  lng: 98.4,
  parcelKey: '1',
} as unknown as Parcel;

const all = { statusVisible: { sale: true, sold: true, cancelled: true, inactive: true } };
const f = (filters: Record<string, unknown> = {}) => ({ ...base, ...filters });
const pass = (filters: Record<string, unknown> = {}) =>
  dataPass(base, { filters: { status: '', province: '', provinces: [], tambons: [], amps: [], propertyTypes: [], text: '', ...filters } as never, statusVisible: all.statusVisible });

test('an empty filter set passes everything', () => {
  expect(pass()).toBe(true);
});

test('a price range is enforced on the map rows too', () => {
  expect(pass({ minPrice: 2_000_000 })).toBe(false);
  expect(pass({ maxPrice: 500_000 })).toBe(false);
  expect(pass({ minPrice: 500_000, maxPrice: 2_000_000 })).toBe(true);
});

test('a land-area range is enforced', () => {
  expect(pass({ minWah: 200 })).toBe(false);
  expect(pass({ maxWah: 50 })).toBe(false);
  expect(pass({ minWah: 50, maxWah: 200 })).toBe(true);
});

test('a lot with no land area never satisfies a land-area range', () => {
  const condo = f({ wah: null });
  expect(dataPass(condo, { filters: { minWah: 1 } as never, statusVisible: all.statusVisible })).toBe(false);
});

test('the status toggle hides a parcel even when no status filter is set', () => {
  expect(dataPass(base, { filters: {} as never, statusVisible: { sale: false } as never })).toBe(false);
});

test('province, tambon and district filters are enforced', () => {
  expect(pass({ province: 'กรุงเทพ' })).toBe(false);
  expect(pass({ provinces: ['กรุงเทพ'] })).toBe(false);
  expect(pass({ provinces: ['ภูเก็ต'] })).toBe(true);
  expect(pass({ tambons: ['รัษฎา'] })).toBe(true);
  expect(pass({ amps: ['เมือง'] })).toBe(true);
  expect(pass({ amps: ['ป่าตอง'] })).toBe(false);
});

test('text search covers both the name and the deed number', () => {
  expect(pass({ text: '1234' })).toBe(true);
  expect(pass({ text: 'ที่ดิน' })).toBe(true);
  expect(pass({ text: 'ไม่มีที่ไหน' })).toBe(false);
});

test('an unknown elevation cannot satisfy an elevation range', () => {
  expect(pass({ minElev: 10 })).toBe(false);
});

/* Status is a list, because the question is usually "what is still on the market
   and what came off it" - two kinds at once. */
test('an empty status list means no status filter', () => {
  expect(pass({ status: [] })).toBe(true);
});

test('a status list keeps the kinds named and drops the rest', () => {
  expect(pass({ status: ['sale'] })).toBe(true);
  expect(pass({ status: ['sold'] })).toBe(false);
  expect(pass({ status: ['sale', 'sold'] })).toBe(true);
});

test('the resale kind is reachable by its own name', () => {
  // 're' is a display distinction on a sale lot, never a p.status value.
  const resold = f({ resell: true });
  expect(dataPass(resold, { filters: { status: ['re'] } as never, statusVisible: all.statusVisible })).toBe(true);
  expect(dataPass(resold, { filters: { status: ['sold'] } as never, statusVisible: all.statusVisible })).toBe(false);
});
