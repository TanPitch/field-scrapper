/* mapStatus.test.js — the lot status classifier.
 *
 *   bun test mapStatus.test.js
 *
 * This function decides what every marker, popup and table row says about a lot,
 * and it has already broken silently: an earlier version looked for Thai prose in
 * close_reason, but LED writes an enum, so the branch could never fire and every
 * withdrawn lot was reported as an expired listing. Nothing failed, because
 * nothing tested it.
 */
import { test, expect } from "bun:test";
import { mapStatus } from "../server/mapStatus.js";

test("a listed lot is still for sale", () => {
  expect(mapStatus("active", null, null)).toBe("sale");
});

test("close_reason is LED's enum, not prose", () => {
  /* withdrawn = ถอนการยึด, cancelled_remaining_rounds = งดขายในนัดที่เหลือ.
   * Both are dead ends and both read as ยกเลิกการขาย, never as an expired
   * listing - the court lifted the attachment, the auction did not time out. */
  expect(mapStatus("closed", "withdrawn", 6)).toBe("cancelled");
  expect(mapStatus("closed", "cancelled_remaining_rounds", 26)).toBe("cancelled");
});

test("a dead end wins even when LED still flags the lot active", () => {
  /* Otherwise the parcel advertises a next auction date for land that will not
   * be auctioned again, which is the worst possible thing to tell a buyer. */
  expect(mapStatus("active", "withdrawn", 6)).toBe("cancelled");
  expect(mapStatus("active", "cancelled_remaining_rounds", 26)).toBe("cancelled");
});

test("a sale with a buyer is ขายแล้ว, by either signal", () => {
  expect(mapStatus("closed", "sold", 1)).toBe("sold");
  expect(mapStatus("closed", null, 1)).toBe("sold");
});

test("closed with neither signal falls back to inactive, never to sold", () => {
  expect(mapStatus("closed", null, null)).toBe("inactive");
});

test("every close_reason in the LED enum maps to a known status", () => {
  for (const reason of [null, "sold", "withdrawn", "cancelled_remaining_rounds"]) {
    for (const status of ["active", "inactive", "closed"]) {
      for (const code of [null, 1, 6, 26]) {
        expect(["sale", "sold", "inactive", "cancelled"]).toContain(
          mapStatus(status, reason, code),
        );
      }
    }
  }
});