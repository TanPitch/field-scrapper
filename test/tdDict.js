/* tdDict.js — the area dictionaries, and the walk between them.
 *
 *   import { tdDistrictFor, tdProvinceFor } from "./tdDict.js";
 *
 * LED names a place in Thai and numbers it one way. TD numbers it another way
 * and names it in Thai. Neither number means anything outside its own system:
 * LED still calls บึงกาฬ 97 where TD calls it 38, and LED's districts under
 * สระแก้ว sit under 25 where TD has 27. A district can also be renamed outright
 * between the two - พลอยแหวน is ท่าใหม่ in TD - and LED prefixes its island
 * districts with อำเภอ where TD writes none.
 *
 * So a lookup has to walk all four steps, and each needs a dictionary:
 *
 *   LED name  ->  LED number  ->  TD number  ->  TD name
 *
 * All four are in research/dictionaries/led_td_dictionary.json, built by
 * buildDictionaries.js from the two research bundles. Nothing here is inferred
 * or matched by similarity at runtime; the file is a straight join of what the
 * two services publish.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(import.meta.dir, "research", "dictionaries", "led_td_dictionary.json");

let dict = null;

/** The dictionaries, read on first use so a missing file only bites a caller. */
export function dictionaries() {
  if (!dict) dict = JSON.parse(readFileSync(FILE, "utf8"));
  return dict;
}

/**
 * Strip the decorations the two services add to the same place, so
 * "อำเภอเกาะกูด" and "เกาะกูด" compare equal. LED uses อำเภอ for islands and เขต
 * in Bangkok; TD writes เมืองN or nothing at all.
 *
 * Shared with areaMatch.js, which matched the two systems by similarity and
 * needed exactly this. One implementation, so the two cannot drift.
 */
export function normaliseName(name) {
  let s = (name ?? "").trim();
  /* Spaces go first: LED writes "เมือง ขอนแก่น" with a space in it, and a
   * prefix cannot be stripped off a string that still has a space in the
   * middle of it. */
  s = s.replace(/\s+/gu, "");
  /* กิ่งอำเภอ first: it ends in อำเภอ, so stripping the shorter prefix first
   * would leave the กิ่ง behind. LED writes กิ่งอำเภอซำสูง and อำเภอเกาะกูด
   * where TD writes ซำสูง and เกาะกูด. */
  s = s.replace(/^(กิ่งอำเภอ|อำเภอ|เขต|กรุงเทพมหานคร)/u, "");
  s = s.replace(/^เมือง(?=[ก-๙])/u, "");
  return s;
}

/** LED province number -> its name, and the TD province it corresponds to. */
export function ledProvince(code) {
  const p = dictionaries().ledProvinces[String(code)];
  return p ? { code: String(code), ...p } : null;
}

/** LED province by the Thai name LED publishes. */
export function ledProvinceByName(name) {
  const want = normaliseName(name);
  if (!want) return null;
  for (const [code, p] of Object.entries(dictionaries().ledProvinces)) {
    if (normaliseName(p.name) === want) return { code, ...p };
  }
  return null;
}

/**
 * LED district number -> the TD district it corresponds to, and the names on
 * both sides. This is the step that matters: tdDistrictName is the string TD
 * answers with, and it is not always the string LED calls the place.
 */
export function ledDistrict(code) {
  const d = dictionaries().ledDistricts[String(code)];
  return d ? { code: String(code), ...d } : null;
}

/** LED district by the Thai name LED publishes. */
export function ledDistrictByName(name) {
  const want = normaliseName(name);
  if (!want) return null;
  for (const [code, d] of Object.entries(dictionaries().ledDistricts)) {
    if (normaliseName(d.name) === want) return { code, ...d };
  }
  return null;
}

/** TD province number -> TD's own name for it. */
export function tdProvince(code) {
  const name = dictionaries().tdProvinces[String(code)];
  return name ? { code: String(code), name } : null;
}

/** TD province number + TD district number -> TD's own name for it. */
export function tdDistrict(provinceCode, districtCode) {
  const list = dictionaries().tdDistricts[String(provinceCode)];
  const name = list?.[String(districtCode)];
  return name ? { provinceCode: String(provinceCode), code: String(districtCode), name } : null;
}

/**
 * Does a row TD returned belong to the district we were looking for?
 *
 * Compared on the normalised name rather than the raw one, because LED and TD
 * spell the same place differently often enough to matter - and compared
 * against the dictionary's name for that district, not against LED's, so both
 * sides are speaking the same vocabulary.
 */
export function tdRowMatchesDistrict(rowName, tdDistrictName) {
  if (!tdDistrictName) return false;
  if ((rowName ?? "").trim() === tdDistrictName) return true;
  return normaliseName(rowName) === normaliseName(tdDistrictName);
}
