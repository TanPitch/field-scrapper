/* buildDictionaries.js — consolidate the area dictionaries into one file.
 *
 *   bun buildDictionaries.js
 *
 * LED publishes provinces and districts as Thai text. TD publishes them as
 * numbers: a two-digit province code and a two-digit district code within it.
 * Neither number means anything outside its own system, and the two systems
 * number the same places differently - LED still calls บึงกาฬ 97 where TD calls
 * it 38, and LED's districts under สระแก้ว sit under 25 where TD has 27.
 *
 * So a lookup has to walk: LED name -> LED number -> TD number -> TD name.
 * Every step of that walk needs a dictionary, and three of the four already
 * exist in this repository:
 *
 *   research/led_to_td/led_to_td_map.json        LED <-> TD, 1,005 entries
 *   research/assessprice_api_bundle/
 *     provinces_districts.json                    TD's own 77 provinces and
 *                                                 their districts
 *
 * This writes the four dictionaries into one file so the lookup has one place
 * to read and one file to inspect. Nothing is derived here that is not already
 * in the sources - the point is to join them, not to guess at them.
 *
 * The source led_to_td_map.json lives under test/research/led_to_td/, which
 * .gitignore keeps out of the repository because that bundle carries live
 * credentials and findings not meant to be published. This script therefore
 * only runs where that bundle is present. What it writes is a different
 * matter: the dictionary holds nothing but area codes and the public Thai names
 * both services publish, so it is committed and the bot works on a fresh
 * clone. Rebuild it when the source changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const HERE = import.meta.dir;
const RESEARCH = resolve(HERE, "research");
const OUT = resolve(RESEARCH, "dictionaries", "led_td_dictionary.json");

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const map = read(resolve(RESEARCH, "led_to_td", "led_to_td_map.json"));
const td = read(resolve(RESEARCH, "assessprice_api_bundle", "provinces_districts.json"));

/* TD's own provinces: code -> name. */
const tdProvinces = {};
for (const p of td.provinces) tdProvinces[String(p.CODE)] = p.DESCR;

/* TD's own districts: province code -> district code -> name. */
const tdDistricts = {};
for (const [prov, list] of Object.entries(td.districts_by_province)) {
  tdDistricts[prov] = {};
  for (const d of list) tdDistricts[prov][String(d.CODE)] = d.DESCR;
}

/* LED's provinces, and the LED->TD province step. A province's TD code is taken
 * from whichever of its districts agrees; they all agree, because the map was
 * built province by province. A province with no mapped district has no TD code
 * and is left unresolved rather than guessed. */
const ledProvinces = {};
for (const e of map.entries) {
  const p = String(e.led_province_code);
  if (!ledProvinces[p]) {
    ledProvinces[p] = {
      name: e.led_province_name,
      tdCode: e.td_province_code ?? null,
      tdName: e.td_province_name ?? null,
    };
  }
}

/* LED's districts, and the LED->TD district step. tdDistrictName is TD's own
 * name for that district, which is the string TD answers with, and is not
 * always the string LED calls it: LED writes อำเภอเกาะกูด and กิ่งอำเภอโคกโพธิ์ไชย
 * where TD writes เกาะกูด and โคกโพธิ์ไชย, and a district can be renamed outright
 * between the two systems. */
const ledDistricts = {};
for (const e of map.entries) {
  const code = String(e.led_district_code);
  ledDistricts[code] = {
    name: e.led_district_name,
    variants: e.led_district_name_variants ?? [],
    provinceCode: String(e.led_province_code),
    provinceName: e.led_province_name,
    tdProvinceCode: e.td_province_code ?? null,
    tdProvinceName: e.td_province_name ?? null,
    tdDistrictCode: e.td_district_code ?? null,
    tdDistrictName: e.td_district_name ?? null,
    matchMethod: e.match_method ?? null,
    note: e.note || null,
  };
}

/* Cross-checks. A dictionary that disagrees with its own source is worse than
 * no dictionary, so anything that does not line up is reported and the run
 * fails rather than writing a file that would be quietly wrong. */
const problems = [];

for (const [code, p] of Object.entries(ledProvinces)) {
  if (p.tdCode && !tdProvinces[String(p.tdCode)]) {
    problems.push(`LED province ${code} (${p.name}) maps to TD ${p.tdCode}, which TD does not list`);
  }
  if (p.tdCode && p.tdName && tdProvinces[String(p.tdCode)] !== p.tdName) {
    problems.push(`LED province ${code}: TD's name for ${p.tdCode} is "${tdProvinces[String(p.tdCode)]}", the map says "${p.tdName}"`);
  }
}

let districtsChecked = 0;
for (const [code, d] of Object.entries(ledDistricts)) {
  if (!d.tdDistrictCode) continue;
  districtsChecked++;
  const list = tdDistricts[String(d.tdProvinceCode)];
  if (!list) {
    problems.push(`LED district ${code} (${d.name}) maps to TD province ${d.tdProvinceCode}, which TD does not list`);
    continue;
  }
  const tdName = list[String(d.tdDistrictCode)];
  if (!tdName) {
    problems.push(`LED district ${code} (${d.name}) maps to TD ${d.tdProvinceCode}-${d.tdDistrictCode}, which TD does not list`);
    continue;
  }
  if (d.tdDistrictName && tdName !== d.tdDistrictName) {
    problems.push(`LED district ${code} (${d.name}): TD calls ${d.tdProvinceCode}-${d.tdDistrictCode} "${tdName}", the map says "${d.tdDistrictName}"`);
  }
}

if (problems.length) {
  console.log(`  ${problems.length} problem(s) - not writing the dictionary:`);
  for (const p of problems.slice(0, 30)) console.log(`    ${p}`);
  process.exit(1);
}

const out = {
  description:
    "LED <-> TD area dictionaries. LED names a place in Thai and numbers it one way; " +
    "TD numbers it another way and names it in Thai. A lookup walks LED name -> LED number -> " +
    "TD number -> TD name. Built from research/led_to_td/led_to_td_map.json and " +
    "research/assessprice_api_bundle/provinces_districts.json; nothing here is guessed.",
  generatedFrom: {
    "research/led_to_td/led_to_td_map.json": map.entries.length,
    "research/assessprice_api_bundle/provinces_districts.json": {
      provinces: Object.keys(tdProvinces).length,
      districts: Object.values(tdDistricts).reduce((a, d) => a + Object.keys(d).length, 0),
    },
  },
  totals: {
    ledProvinces: Object.keys(ledProvinces).length,
    ledDistricts: Object.keys(ledDistricts).length,
    ledDistrictsMapped: Object.values(ledDistricts).filter((d) => d.tdDistrictCode).length,
    tdProvinces: Object.keys(tdProvinces).length,
    tdDistricts: Object.values(tdDistricts).reduce((a, d) => a + Object.keys(d).length, 0),
  },
  ledProvinces,
  ledDistricts,
  tdProvinces,
  tdDistricts,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

console.log(`  wrote ${OUT}`);
console.log(`    LED provinces   ${out.totals.ledProvinces}`);
console.log(`    LED districts   ${out.totals.ledDistricts} (${out.totals.ledDistrictsMapped} mapped to TD)`);
console.log(`    TD provinces    ${out.totals.tdProvinces}`);
console.log(`    TD districts    ${out.totals.tdDistricts}`);
console.log(`    cross-checked   ${districtsChecked} district mappings, all consistent`);
