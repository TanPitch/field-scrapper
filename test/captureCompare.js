/* captureCompare.js — LED and TD, side by side, for one deed.
 *
 *   DATABASE_URL=... bun captureCompare.js <deedNumber> [provinceCode] [amphur|all]
 *
 * Shows what each service actually returned for the same deed number: the URL
 * that was called, the body that was sent, and the names each one gave for the
 * province, district and subdistrict. That is where a mismatch shows up - one
 * of them says the land is in one amphur and the other says another.
 */
import { LedClient, LED_BASE } from "./ledClient.js";
import { createTdLookup } from "./tdLookup.js";
import { Client } from "pg";
import { dictionaries } from "./tdDict.js";

const deed = process.argv[2] ?? "8483";
const provCode = process.argv[3] ?? "25";
const amphur = process.argv[4] === "all" ? "" : (process.argv[4] ?? "");

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: ours } = await db.query(
  `SELECT p.deed_number, p.tumbol, p.district_name, p.province_name, p.district_dol_code,
          d.code AS led_district_code, d.name AS led_district_ref, d.td_code, d.td_province_code,
          p.td_lat, p.td_lon
     FROM parcels p
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
    WHERE p.deed_number = $1 LIMIT 1`, [deed]);
const row = ours[0] ?? null;

const line = (s) => console.log("  " + s);

console.log(`\n=== deed ${deed} ===`);
if (row) {
  line("what we stored from LED:");
  line(`   province   "${row.province_name}"  (LED code ${provCode})`);
  line(`   district   "${row.district_name}"   (LED district code ${row.led_district_code})`);
  line(`   tambon     "${row.tumbol}"`);
  line(`   TD mapping  province ${row.td_province_code} district ${row.td_code}`);
  line(`   our coord   ${Number(row.td_lat).toFixed(6)}, ${Number(row.td_lon).toFixed(6)}`);
}

/* ---------------------------------------------------------------- LED ----- */
console.log(`\n--- LED ---`);
const led = new LedClient({ baseDelayMs: 1200, verbose: true });
await led.open();
line(`GET  ${LED_BASE}`);
line(`POST ${led.action}`);

/* LED's province parameter is the NAME, not the code - scrapeLED.js sets
 * LED_PROVINCE to prov.text. A number there returns zero rows. */
const { rows: provRows } = await db.query("SELECT name FROM provinces WHERE code = $1", [Number(provCode)]);
const provName = provRows[0]?.name ?? provCode;
line(`LED's province parameter is the NAME: "${provName}"`);

const fields = {
  province: provName,
  ampur: amphur,
  tumbol: "",
  asset_type: "",
  person1: "",
  bid_date: "",
  price_begin: "",
  price_end: "",
  rai_if: "1", rai: "",
  quaterrai_if: "1", quaterrai: "",
  wa_if: "1", wa: "",
  search: "ok",
  page: "1",
};
fields.oseckey = led.seckey;
fields.seckey = led.seckey;
line(`body: ${new URLSearchParams(fields).toString().slice(0, 300)}...`);

/* Search province-wide and page through until the deed turns up - that is what
 * the scraper does, and it is the only way to see LED's own row for a deed
 * without knowing which amphur LED files it under. */
let res = null;
let found = null;
const maxPages = Math.min(Number(process.env.PAGES || 12), 40);
for (let pg = 1; pg <= maxPages; pg++) {
  fields.page = String(pg);
  res = await led.search(fields, { expectRows: false });
  line(`  page ${pg}: ${res.rowCount} rows, totalpage ${res.totalPages}`);
  if (!res.rowCount) break;
  const $ = res.$;
  $("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).each((i, e) => {
    const d = $(e).find('input[name="deedno"]').attr("value");
    if (String(d).trim() === String(deed) && !found) found = $(e);
  });
  if (found) break;
  if (res.totalPages && pg >= res.totalPages) break;
  await led.pace();
}

if (found) {
  const $ = res.$;
  const cells = [];
  found.find("td").each((i, e) => {
    const t = $(e).text().replace(/\s+/g, " ").trim();
    if (t) cells.push(t);
  });
  line(`the row LED returns for deed ${deed}, cell by cell:`);
  cells.forEach((c, i) => line(`   [${i}] ${c}`));

  /* The fields the parser actually reads. The plain tumbol / ampur / city
   * inputs are the owner's contact address and are often "-"; the land's own
   * place names live under the deed* prefix. */
  const key = {};
  found.find("input[name]").each((i, e) => { key[$(e).attr("name")] = $(e).attr("value") ?? ""; });
  line("the fields the parser reads:");
  for (const k of ["deedno", "deedtumbol", "deedampur", "deedcity", "landtype", "landdesc", "landpicture", "map"]) {
    if (key[k] !== undefined) line(`   ${k} = ${key[k]}`);
  }
  line("(for contrast, the contact-address fields LED also sends)");
  for (const k of ["tumbol", "ampur", "city"]) {
    if (key[k] !== undefined) line(`   ${k} = ${key[k]}`);
  }
} else {
  line(`no row on any page carries deed ${deed} - LED does not list it in ${provName}`);
}

/* ---- the detail page: where LED actually publishes the deed numbers ----
 * The list row has no โฉนดเลขที่ of its own - it carries the case, the asset
 * type, the size and the place names. The deeds are on the per-lot detail page,
 * which is what ingest.js reads. This is also where แปลงที่ดิน shows up if it
 * shows up at all, and that is the number TD wants as SURVEY_NO. */
if (found) {
  const $ = res.$;
  const formFields = {};
  found.find("input[name]").each((i, e) => { formFields[$(e).attr("name")] = $(e).attr("value") ?? ""; });
  line(`\n--- LED detail page ---`);
  line(`POST ${new URL("asset_open.asp", LED_BASE).toString()}`);
  line(`body: ${new URLSearchParams(formFields).toString().slice(0, 240)}...`);
  const $d = await led.detail(formFields);
  if ($d) {
    const ins = {};
    $d("input[name]").each((i, e) => { ins[$(e).attr("name")] = $(e).attr("value") ?? ""; });
    line("hidden inputs on the detail page that carry a number:");
    Object.entries(ins).forEach(([k, v]) => {
      if (/\d|ที่ดิน|โฉนด/.test(String(v)) && String(v).trim() && String(v).trim() !== "-") line(`   ${k} = ${v}`);
    });
    const texts = [];
    $d("body").text().split(/\r?\n/).forEach((t) => { const s = t.replace(/\s+/g, " ").trim(); if (s) texts.push(s); });
    line("lines mentioning a number or a land description:");
    texts.filter((t) => /\d{4,}|โฉนด|เลขที่|แปลง|ราง|ระยะ/.test(t)).slice(0, 30).forEach((t) => line(`   ${t}`));
  } else {
    line("no detail page returned");
  }
}

await led.close?.();

/* ----------------------------------------------------------------- TD ----- */
console.log(`\n--- TD ---`);
const dict = dictionaries();
const ledDistrict = row ? dict.ledDistricts[String(row.led_district_code)] : null;
const tdProv = ledDistrict?.tdProvinceCode ?? null;
const tdProvName = ledDistrict?.tdProvinceName ?? null;
const tdDistName = ledDistrict?.tdDistrictName ?? null;
line("we ask TD using ITS OWN names for the district we mapped:");
line(`   PROV_CODE  ${tdProv}      (LED says ${provCode})`);
line(`   PROV_DESCR ${tdProvName}`);
line(`   the district we will filter on: ${tdDistName}   (LED calls it "${row?.district_name}")`);

const lookup = await createTdLookup({ delayMs: 400, log: (m) => line(`   ${m}`) });
line(`POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?.../services/DataService.svc/DS_TRANSIT`);
line(`body: CHANOD_NO=${deed}  PROV_CODE=${tdProv}  PROV_DESCR=${tdProvName}  PARCEL_TYPE=CHANOD_NO  PARCEL_LAYER=PARCEL  BEGIN=1  END=200`);

if (tdProv) lookup.setProvince(tdProv);
const td = await lookup({ deed_number: deed, province_code: tdProv });
line(`found=${td.found}  total=${td.total ?? "-"}  rows=${td.rows?.length ?? 0}`);
for (const r of td.rows ?? []) {
  line(`   amphur "${r.amphurName}"  tambon "${r.tambonName}"  land_no ${r.landNo ?? "-"}`);
}
if ((td.rows ?? []).length) {
  const names = [...new Set((td.rows ?? []).map((r) => r.amphurName))];
  line(`distinct districts TD holds this deed in: ${names.join(", ")}`);
  line(`the one we asked for: ${tdDistName}`);
  line(`is ours among them? ${names.includes(tdDistName)}`);
}

await lookup.close();
await db.end();