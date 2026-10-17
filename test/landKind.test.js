import { expect, test } from 'bun:test';
import { landKindOf } from '../src/components/ui/LandKindIcon';

/* The three values LED actually publishes, read out of auction_lots rather than
 * guessed. If LED ever adds a fourth, this is the test that should fail first. */
test('LED asset types map to the LandKind keys the icon map uses', () => {
  expect(landKindOf('ที่ดินพร้อมสิ่งปลูกสร้าง')).toBe('land_with_buildings');
  expect(landKindOf('ที่ดินว่างเปล่า')).toBe('vacant_land');
  expect(landKindOf('ห้องชุด')).toBe('condominium_unit');
});

test('a unit described as a building is still a unit', () => {
  expect(landKindOf('ห้องชุดในอาคารพาณิช')).toBe('condominium_unit');
});

test('anything unrecognised reports no data rather than guessing', () => {
  expect(landKindOf(null)).toBe('empty');
  expect(landKindOf('')).toBe('empty');
  expect(landKindOf('ที่ดินเกษตรกรรม')).toBe('empty');
});
