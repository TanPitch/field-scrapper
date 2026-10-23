/* format.test.js — how a drawn measurement is printed.
 *
 *   bun test format.test.js
 *
 * The unit is chosen to suit the size, which is the only part of the job the
 * reader cares about: centimetres for anything under a hand's width, metres
 * at a tenth from there to a kilometre, kilometres past that.
 */
import { test, expect } from "bun:test";
import { fmtDist, fmtRaiFromM2 } from "../src/lib/format.ts";

test("a short length is in centimetres", () => {
  expect(fmtDist(0)).toBe("0 ซม.");
  expect(fmtDist(0.05)).toBe("5 ซม.");
  expect(fmtDist(0.099)).toBe("10 ซม.");
});

test("decimetres to a kilometre are metres at a tenth", () => {
  expect(fmtDist(0.1)).toBe("0.1 ม.");
  expect(fmtDist(1.5)).toBe("1.5 ม.");
  expect(fmtDist(80)).toBe("80 ม.");
  expect(fmtDist(123.45)).toBe("123.5 ม.");
  expect(fmtDist(999.95)).toBe("1,000 ม.");
});

test("a kilometre and past is kilometres", () => {
  expect(fmtDist(1000)).toBe("1 กม.");
  expect(fmtDist(12345)).toBe("12.35 กม.");
  expect(fmtDist(123450)).toBe("123.45 กม.");
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