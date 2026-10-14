import { test, expect } from "bun:test";
import { representativeUnit, groupUnitsByParcel } from "../src/lib/condoUnits.ts";

// The real Phuket units, as they sit in the database.
const PHUKET = [
  { id: 2287, orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 39.11, sizeUnit: "wa", startPrice: 5389358 },
  { id: 2288, orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40.44, sizeUnit: "wa", startPrice: 5572632 },
  { id: 2289, orderLabel: "1 - 3", rai: 0, ngan: 0, wa: 40.35, sizeUnit: "wa", startPrice: 5560230 },
  { id: 2290, orderLabel: "1 - 4", rai: 0, ngan: 0, wa: 40.29, sizeUnit: "wa", startPrice: 5648658 },
  { id: 2291, orderLabel: "1 - 5", rai: 0, ngan: 0, wa: 39.39, sizeUnit: "wa", startPrice: 5522478 },
];

test("a single unit is its own representative", () => {
  expect(representativeUnit([PHUKET[0]])).toBe(PHUKET[0]);
});

test("no units gives null rather than throwing", () => {
  expect(representativeUnit([])).toBeNull();
  expect(representativeUnit(null)).toBeNull();
});

test("largest unit wins, regardless of price", () => {
  const rep = representativeUnit(PHUKET);
  expect(rep.orderLabel).toBe("1 - 2"); // 40.44 วา, the largest
});

test("price breaks a tie on size", () => {
  const equal = [
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 900 },
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 700 },
  ];
  expect(representativeUnit(equal).orderLabel).toBe("1 - 1"); // cheaper
});

test("order_label is the final tiebreak, so a price change cannot move the marker", () => {
  const a = { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 500 };
  const b = { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 500 };
  expect(representativeUnit([b, a]).orderLabel).toBe("1 - 1");
  // Now move a price. Size and order are unchanged, so it must not flip.
  const after = { ...a, startPrice: 1 };
  expect(representativeUnit([b, after]).orderLabel).toBe("1 - 1");
});

test("rai/ngan/wa combine into one area", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 20, sizeUnit: "wa", startPrice: 1 },
    { orderLabel: "1 - 2", rai: 1, ngan: 0, wa: 0, sizeUnit: "wa", startPrice: 2 }, // 400 วา
  ];
  expect(representativeUnit(units).orderLabel).toBe("1 - 2");
});

test("square metres are converted before comparing", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 400, sizeUnit: "sqm", startPrice: 1 },  // 1 วา
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 2 },   // 40 วา
  ];
  expect(representativeUnit(units).orderLabel).toBe("1 - 2");
});

test("order labels sort naturally, so 1-2 precedes 1-10", () => {
  const units = [
    { orderLabel: "1 - 10", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1 },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1 },
  ];
  expect(representativeUnit(units).orderLabel).toBe("1 - 2");
});

test("a lot with no price does not win by default", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: null },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 900 },
  ];
  expect(representativeUnit(units).orderLabel).toBe("1 - 2");
});

test("grouping puts units of one parcel together and keeps singletons apart", () => {
  const lots = [
    ...PHUKET.map((u, i) => ({ ...u, parcelId: 2082, key: `u${i}` })),
    { id: 1, parcelId: 99, key: "solo" },
  ];
  const g = groupUnitsByParcel(lots);
  expect(g.get(2082)).toHaveLength(5);
  expect(g.get(99)).toHaveLength(1);
  expect(g.size).toBe(2);
});

test("the real Phuket building picks 1-2, and reports 5 units", () => {
  const rep = representativeUnit(PHUKET);
  expect(rep.orderLabel).toBe("1 - 2");
  expect(PHUKET.length).toBe(5);
});