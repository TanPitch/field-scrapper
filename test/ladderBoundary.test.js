/* ladderBoundary.test.js — the listing boundary and the group share.
 *
 *   cd test; bun test ladderBoundary.test.js
 *
 * Src/lib/price.ts was rewritten so a relist re-sets the discount floor and
 * a ขายรวม sibling's no-bid round deepens the shared price. Both live in the
 * same file and neither is exercised by the DB agreement test (that one feeds
 * no announce), so they are pinned here on fixture rounds shaped exactly like
 * the cases that produced them (ผบ.754/2562, ผบE.3247/2567). The back-end
 * pricing.js is untouched by this: the agreement test's stored-price leg may
 * still report old drift, that is a dataset matter, not this rule.
 */
import { describe, test, expect } from "bun:test";
import { priceLadder, nextRoundPrice } from "../src/lib/price.ts";
import { saleOrderLabels } from "../src/components/panel/DetailView.tsx";
import { ALL_PARCELS, PARCEL_BY_ID } from "../src/data/liveData.ts";

const DAY = 864e5;
/** Dated round fixture; status text is what LED prints, code is the ingest's. */
const ar = (d, status, code = null) => /* SellRound */
  ({ date: d, status, label: status, statusCode: code, price: null, discountPct: null, soldPrice: null, ledLabel: null });

const ANN = Date.parse("2026-08-27T17:00:00Z"); // publish = 28 ก.ค. Bangkok
const START = 9_074_000;

/* priceLadder: history before the announce never deepens. */
describe("priceLadder announce boundary", () => {
  test("pre-announce ไม่มีผู้สู้ราคา rows do not deepen the current order", () => {
    const ladder = priceLadder([
      ar(ANN - 300 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
      ar(ANN - 250 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
      ar(ANN - 200 * DAY, "งดขาย", 0),
      ar(ANN - 150 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
      ar(ANN + 30 * DAY, "งดขายไม่มีผู้สู้ราคา", 0), // round 1 of the live listing
      ar(ANN + 60 * DAY, "รอประกาศ", null),          // round 2, no verdict yet
    ], START, ANN);
    expect(ladder[0].discountPct).toBe(0); // history verdict ignored
    expect(ladder[4].discountPct).toBe(0); // the no-bid round holds its own price
    expect(ladder[4].price).toBe(START);
    expect(ladder[5].discountPct).toBe(10); // deepened AFTER it
    expect(ladder[5].price).toBe(Math.round(START * 0.9 * 100) / 100);
  });

  test("cap stays -30% and history keeps the ledger passthrough", () => {
    const ladder = priceLadder([
      ar(ANN - 90 * DAY, "งดขาย", 0),
      ar(ANN + 0 * DAY, "งดขายไม่มีผู้สู้ราคา", 0),
      ar(ANN + 30 * DAY, "งดขายไม่มีผู้สู้ราคา", 0),
      ar(ANN + 60 * DAY, "งดขายไม่มีผู้สู้ราคา", 0),
      ar(ANN + 90 * DAY, "รอประกาศ", null),
    ], START, ANN);
    expect(ladder[4].discountPct).toBe(30);
    /* start_price missing → every row passes its own price through (null). */
    const noStart = priceLadder([ar(ANN + 5 * DAY, "งดขายไม่มีผู้สู้ราคา", 0)], null, ANN);
    expect(noStart[0].price).toBeNull();
  });
});

/* nextRoundPrice through the group share. Two parcels shaped like
 * ผบ.754/2562: same case/year/order, one ขายรวม remark naming both deeds,
 * LED's verdict printed on p's table only. */
describe("nextRoundPrice group share", () => {
  const mkParcel = (id, deedNo, extra = {}) => /* Parcel, minimal shape */
  ({
    id, deedNo,
    status: "sale", announce: ANN, price: START,
    hist: [{ d: ANN, v: START }],
    rounds: [],
    groupCount: null, remark: "", caseNoRaw: "ผบ.754", caseYear: "2562", order: "2/2569",
    province: "ขอนแก่น", deed: deedNo, ...extra,
  });
  const P = mkParcel(9102, "24653");
  const Q = mkParcel(9103, "161371");
  P.remark = "ขายรวมกับที่ดินโฉนดเลขที่ 161371 ราคาประเมินรวม";
  Q.remark = "ขายรวมกับที่ดินโฉนดเลขที่ 24653";
  P.rounds = [
    ar(ANN + 30 * DAY, "งดขายไม่มีผู้สู้ราคา", 0), // round 1, held 28 ต.ค.
    ar(ANN + 75 * DAY, "รอประกาศ", null),
  ];
  Q.rounds = [ar(ANN + 75 * DAY, "รอประกาศ", null)]; // 161371's own table: silent
  ALL_PARCELS.push(P, Q);
  PARCEL_BY_ID.set(P.id, P);
  PARCEL_BY_ID.set(Q.id, Q);

  const NOW = ANN + 60 * DAY; // between the held round and the next one

  test("own no-bid round inside the listing deepens once", () => {
    const next = nextRoundPrice(P, NOW);
    expect(next).not.toBeNull();
    expect(next.discountPct).toBe(10);
    expect(next.price).toBe(Math.round(START * 0.9 * 100) / 100);
  });

  test("silent sibling inherits the same share (24653 ↔ 161371)", () => {
    const next = nextRoundPrice(Q, NOW);
    expect(next).not.toBeNull();
    expect(next.discountPct).toBe(10);
  });

  test("pre-announce no-bid rows deepen nothing at all", () => {
    const h = mkParcel(9104, "222333", {
      rounds: [
        ar(ANN - 300 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
        ar(ANN - 200 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
        ar(ANN - 100 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
        ar(ANN - 50 * DAY, "งดขายไม่มีผู้สู้ราคา", 10),
        ar(ANN + 75 * DAY, "รอประกาศ", null),
      ],
    });
    ALL_PARCELS.push(h); PARCEL_BY_ID.set(h.id, h);
    expect(nextRoundPrice(h, NOW)?.discountPct).toBe(0);
  });
});

/* saleOrderLabels: the three split rules and the current-order guarantee. */
describe("saleOrderLabels", () => {
  test("60-day gap starts a lettered older order", () => {
    const ls = saleOrderLabels([
      { date: 0 }, { date: 21 * DAY },
      { date: 21 * DAY + 61 * DAY }, { date: 21 * DAY + 61 * DAY + 21 * DAY },
    ], null);
    expect(ls.map((l) => l.text)).toEqual(["A1", "A2", "1", "2"]);
  });

  test("adjacent relist (<14 days) splits even without a 60-day gap", () => {
    /* ผบE.3247/2567 shape: order A ends 10/03, order B starts 13/03; the
       announce sits at B (the live listing), so only A keeps letters. */
    const t0 = Date.parse("2026-01-10T00:00:00Z");
    const b = t0 + 60 * DAY + 3 * DAY;
    const ls = saleOrderLabels([
      { date: t0 }, { date: t0 + 21 * DAY }, { date: t0 + 60 * DAY }, // A …
      { date: b }, { date: b + 21 * DAY },                            // B …
    ], b);
    expect(ls.map((l) => l.text)).toEqual(["A1", "A2", "A3", "1", "2"]);
    expect(ls.map((l) => l.prev)).toEqual([true, true, true, false, false]);
  });

  test("same-day copies stay in one order", () => {
    const ls = saleOrderLabels([{ date: 0 }, { date: 0 }], null);
    expect(ls.map((l) => l.text)).toEqual(["1", "2"]);
  });

  test("the announce crossing is always a new order, and the current order never splits", () => {
    const ann = 100 * DAY;
    const ls = saleOrderLabels([
      { date: ann - 40 * DAY },               // 40d gap: no split rule fires
      { date: ann + 30 * DAY },               // crossing announce
      { date: ann + 120 * DAY },              // a งดขาย suspension would pass 60d
      { date: ann + 150 * DAY },
    ], ann);
    expect(ls.map((l) => l.text)).toEqual(["A1", "1", "2", "3"]);
    expect(ls.map((l) => l.prev)).toEqual([true, false, false, false]);
  });
});

/* Provenance mode (round idx from the ingest): the boundary is the row's own
   source, not a date heuristic. Pinned on ผบE.3247/2567 lot 221345's real
   shape: 12 report rows (two relisted orders, the second opening 3 days after
   the first ended) then the live listing's six นัด. The announce-date fallback
   misgrouped this lot — its 19/06 publish predates the live listing's first
   นัด by two months, so 01/07 slid into the live order and printed 1-7. */
describe("saleOrderLabels walks on round source (idx)", () => {
  const d = (y, m, day) => Date.parse(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T17:00:00Z`);
  const rep = (ts) => ({ date: ts, idx: null });   // source='report'
  const lst = (ts) => ({ date: ts, idx: 1 });      // source='lists'
  const A = [rep(d(2025, 11, 25)), rep(d(2025, 12, 16)), rep(d(2026, 1, 6)),
             rep(d(2026, 1, 27)), rep(d(2026, 2, 17)), rep(d(2026, 3, 10))];
  const B = [rep(d(2026, 3, 13)), rep(d(2026, 4, 7)), rep(d(2026, 4, 28)),
             rep(d(2026, 5, 19)), rep(d(2026, 6, 9)), rep(d(2026, 6, 30))];
  const LIVE_1 = d(2026, 8, 19);
  const LIVE = [lst(LIVE_1), lst(LIVE_1 + 21 * DAY), lst(LIVE_1 + 42 * DAY),
                lst(LIVE_1 + 63 * DAY), lst(LIVE_1 + 84 * DAY), lst(LIVE_1 + 105 * DAY)];

  test("221345: report rows letter A1-A6 / B1-B6, the live listing runs plain 1-6", () => {
    const ls = saleOrderLabels([...A, ...B, ...LIVE]);
    expect(ls.map((l) => l.text)).toEqual(
      ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6", "1", "2", "3", "4", "5", "6"]);
    expect(ls.map((l) => l.prev)).toEqual(
      [...Array(12).fill(true), ...Array(6).fill(false)]);
    /* The dashed order divider sits under B1 and under the live listing. */
    expect(ls.map((l) => l.sep)).toEqual(
      [false, false, false, false, false, false, true, false, false, false, false, false, true, false, false, false, false, false]);
  });

  test("a lists-only lot (no report history) is one plain order", () => {
    const ls = saleOrderLabels([...LIVE]);
    expect(ls.map((l) => l.text)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(ls.map((l) => l.prev)).toEqual([false, false, false, false, false, false]);
  });

  test("announce param alone never regresses the fallback lots (all-idx-null rows)", () => {
    const ann = LIVE_1 - 40 * DAY;
    const ls = saleOrderLabels([rep(ann - 30 * DAY), rep(ann + 100 * DAY), rep(ann + 121 * DAY)], ann);
    expect(ls.map((l) => l.text)).toEqual(["A1", "1", "2"]);
  });
});
