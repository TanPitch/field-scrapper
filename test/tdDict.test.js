/* tdDict.test.js — the LED <-> TD area dictionaries.
 *
 *   bun test tdDict.test.js
 *
 * The lookup walks four steps: LED name -> LED number -> TD number -> TD name.
 * Each step is a dictionary, and each dictionary is a place where a silent
 * mistake would put a marker on the wrong piece of land - so the steps are
 * pinned here, including the cases where the two services disagree about what
 * a place is called.
 */
import { test, expect } from "bun:test";
import {
  dictionaries, ledDistrict, ledProvince, ledProvinceByName,
  tdDistrict, tdProvince, normaliseName, tdRowMatchesDistrict,
} from "./tdDict.js";

test("the dictionary has all four parts", () => {
  const d = dictionaries();
  expect(d.ledProvinces).toBeDefined();
  expect(d.ledDistricts).toBeDefined();
  expect(d.tdProvinces).toBeDefined();
  expect(d.tdDistricts).toBeDefined();
  /* 77 provinces and 928 districts is what the two research bundles contain.
   * A different number means one of the sources changed and the dictionary was
   * not rebuilt. */
  expect(Object.keys(d.ledProvinces).length).toBe(77);
  expect(Object.keys(d.tdProvinces).length).toBe(77);
  expect(Object.keys(d.ledDistricts).length).toBe(1005);
});

test("every mapped LED district points at a district TD actually lists", () => {
  const d = dictionaries();
  let mapped = 0;
  for (const dist of Object.values(d.ledDistricts)) {
    if (!dist.tdDistrictCode) continue;
    mapped++;
    const list = d.tdDistricts[String(dist.tdProvinceCode)];
    expect(list).toBeDefined();
    expect(list[String(dist.tdDistrictCode)]).toBeDefined();
  }
  expect(mapped).toBe(1001);
});

test("LED's province number is not TD's for every province but one", () => {
  /* บึงกาฬ is 97 on LED and 38 on TD. Sending 97 to TD returns nothing for
   * every deed in the province, which is why the bot reads the code from the
   * dictionary rather than off the parcel. */
  const differ = Object.entries(dictionaries().ledProvinces)
    .filter(([code, p]) => String(p.tdCode) !== String(code));
  expect(differ.length).toBe(1);
  expect(differ[0][0]).toBe("97");
  expect(differ[0][1].tdCode).toBe("38");
});

test("the walk works end to end for an ordinary district", () => {
  const d = ledDistrict("4022");
  expect(d.name).toBe("กิ่งอำเภอโคกโพธิ์ไชย");
  expect(d.tdProvinceCode).toBe("40");
  expect(d.tdDistrictCode).toBe("22");
  /* TD's own name for it, which is what TD answers with. */
  expect(d.tdDistrictName).toBe("โคกโพธิ์ไชย");
  expect(tdDistrict(d.tdProvinceCode, d.tdDistrictCode).name).toBe("โคกโพธิ์ไชย");
});

test("a district renamed between the systems keeps both names", () => {
  /* LED writes พนัศ, TD writes พนัสนิคม. Comparing one against the other
   * rejects the parcel, so both are kept. */
  const d = ledDistrict("2012");
  expect(d.name).toBe("พนัศ");
  expect(d.tdDistrictName).toBe("พนัสนิคม");
});

test("a district LED calls สระแก้ว is เมืองสระแก้ว to TD", () => {
  const d = ledDistrict("2504");
  expect(d.name).toBe("สระแก้ว");
  expect(d.tdDistrictName).toBe("เมืองสระแก้ว");
  expect(d.tdProvinceCode).toBe("27");
});

test("a district LED files under the wrong province still maps across", () => {
  /* LED files รัตนวาปี's districts under 41; TD has it as 43. The dictionary
   * carries the cross-province match. */
  const d = ledDistrict("4027");
  expect(d.tdProvinceCode).toBe("43");
  expect(d.tdDistrictName).toBe("รัตนวาปี");
});

test("four LED districts have no TD counterpart and are left unmatched", () => {
  const unmatched = Object.values(dictionaries().ledDistricts)
    .filter((d) => !d.tdDistrictCode);
  expect(unmatched.length).toBe(4);
});

test("a province can be found by the name LED publishes", () => {
  const p = ledProvinceByName("บึงกาฬ");
  expect(p).not.toBeNull();
  expect(p.code).toBe("97");
  expect(p.tdCode).toBe("38");
  expect(tdProvince(p.tdCode).name).toBe("บึงกาฬ");
});

test("the two spellings of a district compare equal", () => {
  /* This is the comparison the old code got wrong: TD's AMPHUR_NAME against
   * LED's district name, with no normalisation. */
  expect(tdRowMatchesDistrict("เมืองสระแก้ว", "เมืองสระแก้ว")).toBe(true);
  expect(tdRowMatchesDistrict("สระแก้ว", "เมืองสระแก้ว")).toBe(true);
  expect(tdRowMatchesDistrict("เมืองขอนแก่น", "ขอนแก่น")).toBe(true);
  expect(tdRowMatchesDistrict("กบินทร์บุรี", "เมืองขอนแก่น")).toBe(false);
});

test("normalising strips the decorations the two services add", () => {
  expect(normaliseName("อำเภอเกาะกูด")).toBe("เกาะกูด");
  expect(normaliseName("กิ่งอำเภอซำสูง")).toBe("ซำสูง");
  expect(normaliseName("เมืองขอนแก่น")).toBe("ขอนแก่น");
  expect(normaliseName("เมือง ขอนแก่น")).toBe("ขอนแก่น");
});