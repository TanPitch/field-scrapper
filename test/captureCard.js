/* captureCard.js — one deed, everything both services know about it.
 *
 *   DATABASE_URL=... bun captureCard.js <deedNumber> [provinceName]
 *
 * Prints a reference card: what LED published for the deed, what we stored and
 * the codes it maps through, and what TD answers for the same deed number. The
 * point is that all three can be read side by side, so a disagreement is
 * visible rather than inferred.
 */
import { LedClient } from "./ledClient.js";
import { createTdLookup } from "./tdLookup.js";
import { dictionaries } from "./tdDict.js";
import { Client } from "pg";

const deed = String(process.argv[2] ?? "8483");
const provArg = process.argv[3];
const line = (s) => console.log(s);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: ours } = await db.query(
  `SELECT l.case_no, l.case_year, l.court, l.plaintiff, l.defendant, l.start_price,
          l.order_label, p.deed_number, p.tumbol, p.district_name, p.province_name,
          p.land_title_raw, p.district_dol_code, d.code AS led_district_code, d.td_code,
          d.td_province_code, d.name AS districts_ref, p.td_lat, p.td_lon
     FROM auction_lots l JOIN parcels p ON p.id = l.parcel_id
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
    WHERE l.deed_number = $1 LIMIT 1`, [deed]);
const o = ours[0] ?? null;

line(`\n=============== DEED ${deed} — reference card ===============`);
if (!o) line("  (not in our database)");

/* ---- LED ---- */
const provName = provArg ?? o?.province_name ?? "";
line("\n-- what LED published (live, captured just now) --");
const led = new LedClient({ baseDelayMs: 1200 });
await led.open();
const fields = {
  province: provName, ampur: "", tumbol: "", asset_type: "", person1: "", bid_date: "",
  price_begin: "", price_end: "", rai_if: "1", rai: "", quaterrai_if: "1", quaterrai: "",
  wa_if: "1", wa: "", search: "ok", page: "1",
};
fields.oseckey = led.seckey;
fields.seckey = led.seckey;

let res = null;
let found = null;
let $ = null;
for (let pg = 1; pg <= 30 && !found; pg++) {
  fields.page = String(pg);
  res = await led.search(fields, { expectRows: false });
  if (!res.rowCount) break;
  $ = res.$;
  $("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).each((i, e) => {
    if (String($(e).find('input[name="deedno"]').attr("value")).trim() === deed && !found) found = $(e);
  });
  if (!found) await led.pace();
}

if (found) {
  const key = {};
  found.find("input[name]").each((i, e) => { key[$(e).attr("name")] = $(e).attr("value") ?? ""; });
  const cells = [];
  found.find("td").each((i, e) => { const t = $(e).text().replace(/\s+/g, " ").trim(); if (t) cells.push(t); });
  line(`   case number    ${key.law_suit_no} / ${key.law_suit_year}      (row shows "${cells[2]}")`);
  line(`   court          ${key.law_court_name}   (id ${key.law_court_id})`);
  line(`   city           ${key.deedcity}           (province_id ${key.province_id})`);
  line(`   ampur          ${key.deedampur}        (LED amphur code ${o?.led_district_code})`);
  line(`   tumbol         ${key.deedtumbol}`);
  line(`   land type      ${key.landtype}   /  ${key.landdesc}`);
  line(`   size           ${key.rai} ไร่  ${key.quaterrai} งาน  ${key.wa} ตร.วา`);
  line(`   asking price   ${key.assetprice3}`);
  line(`   order          ${key.str_bid_num}   (fbidnum ${key.fbidnum}, sub ${key.fsubbidnum})`);
  line(`   auction        ${cells[0]}`);
  line(`   plaintiff      ${key.person1}`);
  line(`   defendant      ${key.person2}`);
  line(`   owner          ${key.ownername}`);
  line(`   round dates    ${[1, 2, 3, 4, 5, 6].map((i) => `${key["biddate" + i]}`).filter(Boolean).join("  ")}`);
  line(`   (the contact fields tumbol/ampur/city are the owner's address, not the land's)`);
} else {
  line(`   LED does not list deed ${deed} under ${provName}`);
}

if (o) {
  line("\n-- what we stored, and the codes it maps through --");
  line(`   case           ${o.case_no} / ${o.case_year}      (${o.court})`);
  line(`   city           ${o.province_name}`);
  line(`   ampur          ${o.district_name}    (districts table name "${o.districts_ref}")`);
  line(`   tumbol         ${o.tumbol}`);
  line(`   global code    district_dol_code = ${o.district_dol_code}   (กรมที่ดิน 2-digit)`);
  line(`   TD code        ${o.td_province_code}-${o.td_code}`);
  line(`   our coord      ${Number(o.td_lat).toFixed(6)}, ${Number(o.td_lon).toFixed(6)}`);
}

/* ---- TD ---- */
const dict = dictionaries();
const dd = o ? dict.ledDistricts[String(o.led_district_code)] : null;
const tdProv = dd?.tdProvinceCode ?? null;
const tdProvName = dd?.tdProvinceName ?? null;
const tdDistName = dd?.tdDistrictName ?? null;

line("\n-- TD's answer --");
line(`   query: CHANOD_NO=${deed}  PROV_CODE=${tdProv}  PROV_DESCR=${tdProvName}  PARCEL_TYPE=CHANOD_NO  PARCEL_LAYER=PARCEL  END=200`);
const lookup = await createTdLookup({ delayMs: 400, log: () => {} });
if (tdProv) lookup.setProvince(tdProv);
const td = await lookup({ deed_number: deed, province_code: tdProv });
line(`   ${td.rows.length} row(s):`);
for (const r of td.rows) {
  line(`      AMPHUR_NAME=${(r.amphurName ?? "").padEnd(16)} TUMBON_NAME=${(r.tambonName ?? "").padEnd(12)} LAND_NO=${String(r.landNo ?? "").padEnd(5)} SURVEY_NO=${String(r.surveyNo ?? "").padEnd(6)} CHANOD_NO=${r.chanodNo}  RAWANG=${r.rawang}`);
  line(`         CHANGWAT_CODE=${r.raw.CHANGWAT_CODE}  BRANCH_CODE=${r.raw.BRANCH_CODE}  SRID=${r.raw.SRID}  LAYER_NAME=${r.raw.LAYER_NAME}`);
}
if (dd) line(`   our TD district name (from the map) : ${tdDistName}   (TD ${dd.tdProvinceCode}-${dd.tdDistrictCode})`);
if (o) line(`   the tambon we will filter on        : ${o.tumbol}`);

await lookup.close();
await led.close?.();
await db.end();