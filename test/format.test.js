/* format.test.js — how a drawn measurement is printed.
 *
 *   bun test format.test.js
 *
 * Both of these used to throw away the measurement: a 1.5 m line printed "2 ม."
 * and a 1.5 square metre shape printed "0 ตร.ว.". The unit is now chosen to
 * suit the size, which is the only part of the job the reader cares about.
 */
import { test, expect } from "bun:test";
import { fmtDist, fmtRaiFromM2 } from "../src/lib/format.ts";

test("a short length is in centimetres", () => {
  expect(fmtDist(1.5)).toBe("150 ซม.");
  expect(fmtDist(1.3)).toBe("130 ซม.");
  expect(fmtDist(0.8)).toBe("80 ซม.");
  expect(fmtDist(0)).toBe("0 ซม.");
});

test("a length past a kilometre is in metres, then kilometres", () => {
  expect(fmtDist(1000)).toBe("1,000 ม.");
  expect(fmtDist(1500)).toBe("1,500 ม.");
  expect(fmtDist(9999)).toBe("9,999 ม.");
  expect(fmtDist(10000)).toBe("10 กม.");
  expect(fmtDist(12345)).toBe("12.35 กม.");
});

test("a short area is in square metres, not a rounded zero", () => {
  /* A ไร่ is four square metres, so anything under that has no ตร.ว. to be
   * printed in. Rounding it gave "0 ตร.ว." - less than nothing. */
  expect(fmtRaiFromM2(1.5)).toBe("1.5 ตร.ม.");
  expect(fmtRaiFromM2(1.3)).toBe("1.3 ตร.ม.");
  expect(fmtRaiFromM2(0.25)).toBe("0.25 ตร.ม.");
});

test("an area of a ไร่ and more is still land area", () => {
  expect(fmtRaiFromM2(4)).toBe("1 ตร.วา");
  expect(fmtRaiFromM2(400)).toBe("1 งาน");
  expect(fmtRaiFromM2(1000)).toBe("2 งาน 50 ตร.วา");
});