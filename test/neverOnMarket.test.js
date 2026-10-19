/* neverOnMarket.test.js — when an "active" lot is really cancelled.
 *
 *   bun test neverOnMarket.test.js
 *
 * LED leaves a lot flagged active after every one of its rounds has come back
 * งดขาย. Reporting that as กำลังขาย advertises a next auction date for land that
 * is not going to market, which is the worst thing to tell someone deciding what
 * to buy.
 */
import { test, expect } from "bun:test";
import { neverOnMarket, noSaleRound } from "../src/data/liveData.js";

/* date null = a round still to come. status is LED's own label. */
const rd = (status, date = 1) => ({ status, date });

test("a flat งดขาย is a sale called off", () => {
  expect(noSaleRound(rd("งดขาย"))).toBe(true);
});

test("no bidders is not the same as cancelled", () => {
  /* The lot is still being auctioned and the next round is a real chance, so
     lumping it in with งดขาย would drop live land off the map. */
  expect(noSaleRound(rd("งดขายไม่มีผู้สู้ราคา"))).toBe(false);
  expect(noSaleRound(rd("ถอนการยึด"))).toBe(false);
  expect(noSaleRound(rd("งดขายในนัดที่เหลือ"))).toBe(false);
  expect(noSaleRound(rd("ขายได้"))).toBe(false);
});

test("every dated round งดขาย means the lot is off the market", () => {
  expect(neverOnMarket([rd("งดขาย"), rd("งดขาย"), rd("งดขาย")])).toBe(true);
});

test("one round that got as far as an auction keeps it live", () => {
  expect(neverOnMarket([rd("งดขาย"), rd("งดขาย"), rd("ขายได้")])).toBe(false);
});

test("undated rounds are ignored - they are rounds still to come", () => {
  expect(neverOnMarket([rd("งดขาย"), rd("ยังไม่มีการเปิดประมูล", null)])).toBe(true);
});

test("a lot with no dated round at all is not judged either way", () => {
  expect(neverOnMarket([])).toBe(false);
  expect(neverOnMarket([rd("ยังไม่มีการเปิดประมูล", null)])).toBe(false);
});