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

test("an unpriced lot loses on every criterion, in both directions", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: null },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 900 },
  ];
  // A tie on size now falls to order_label, not to price. So 1-1 wins on
  // size, and 1-2 wins on both price directions because it is the only lot
  // with a figure at all.
  expect(representativeUnit(units, "sizeDesc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(units, "priceAsc").orderLabel).toBe("1 - 2");
  expect(representativeUnit(units, "priceDesc").orderLabel).toBe("1 - 2");
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

test("the ordering criterion is a setting, not a fixed cascade", () => {
  expect(representativeUnit(PHUKET, "orderLabel").orderLabel).toBe("1 - 1");
  expect(representativeUnit(PHUKET, "priceAsc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(PHUKET, "priceDesc").orderLabel).toBe("1 - 4");
  expect(representativeUnit(PHUKET, "sizeAsc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(PHUKET, "sizeDesc").orderLabel).toBe("1 - 2");
});

test("a size tie falls through to order_label, never to price", () => {
  // Both are 40 วา. 1-2 is far dearer, so a price tiebreak would pick it.
  // "largest first" must not silently become "dearest first".
  const tied = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 500 },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 9000 },
  ];
  expect(representativeUnit(tied, "sizeDesc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(tied, "sizeAsc").orderLabel).toBe("1 - 1");
});

test("a price tie also falls through to order_label, never to size", () => {
  const tied = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 10, sizeUnit: "wa", startPrice: 700 },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 90, sizeUnit: "wa", startPrice: 700 },
  ];
  expect(representativeUnit(tied, "priceAsc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(tied, "priceDesc").orderLabel).toBe("1 - 1");
});

test("orderLabel primary ignores price and size entirely", () => {
  const units = [
    { orderLabel: "1 - 3", rai: 1, ngan: 0, wa: 0, sizeUnit: "wa", startPrice: 10 },
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 1, sizeUnit: "wa", startPrice: 999 },
    { orderLabel: "1 - 2", rai: 0, ngan: 2, wa: 0, sizeUnit: "wa", startPrice: 500 },
  ];
  expect(representativeUnit(units, "orderLabel").orderLabel).toBe("1 - 1");
});

test("dearest first puts an unpriced unit last, not first", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: null },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 500 },
  ];
  expect(representativeUnit(units, "priceDesc").orderLabel).toBe("1 - 2");
});

test("the default is largest first", () => {
  expect(representativeUnit(PHUKET).orderLabel).toBe(
    representativeUnit(PHUKET, "sizeDesc").orderLabel,
  );
});

/* statusFirst: the map answers "where is land on sale now", so a building with
   one unit still selling and another already gone must be represented by the one
   still selling, however large or dear the sold one is. */
const MIXED = [
  { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 90, sizeUnit: "wa", startPrice: 100, status: "sold" as const },
  { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 10, sizeUnit: "wa", startPrice: 100, status: "sale" as const },
  { orderLabel: "1 - 3", rai: 0, ngan: 0, wa: 50, sizeUnit: "wa", startPrice: 100, status: "inactive" as const },
];

test("statusFirst puts the still-selling unit ahead of a much larger sold one", () => {
  expect(representativeUnit(MIXED, "statusFirst").orderLabel).toBe("1 - 2");
});

test("statusFirst orders sale, then out, then bought", () => {
  const sold = representativeUnit(MIXED.filter((u) => u.status !== "sale"), "statusFirst");
  expect(sold.orderLabel).toBe("1 - 3"); // inactive before sold
});

test("statusFirst ignores size and price entirely", () => {
  const onlySaleAndSold = [MIXED[0], MIXED[1]];
  expect(representativeUnit(onlySaleAndSold, "sizeDesc").orderLabel).toBe("1 - 1");
  expect(representativeUnit(onlySaleAndSold, "statusFirst").orderLabel).toBe("1 - 2");
});

test("a unit with no status sorts last, never ahead of a known one", () => {
  const units = [
    { orderLabel: "1 - 1", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1, status: null },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1, status: "sold" as const },
  ];
  expect(representativeUnit(units, "statusFirst").orderLabel).toBe("1 - 2");
});

test("statusFirst breaks a status tie on order_label", () => {
  const tie = [
    { orderLabel: "1 - 5", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1, status: "sale" as const },
    { orderLabel: "1 - 2", rai: 0, ngan: 0, wa: 40, sizeUnit: "wa", startPrice: 1, status: "sale" as const },
  ];
  expect(representativeUnit(tie, "statusFirst").orderLabel).toBe("1 - 2");
});