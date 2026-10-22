/* errorGroup.js — the error group, printed for checking against the two sites.
 *
 *   DATABASE_URL=... bun errorGroup.js [perGroup]
 *
 * Two groupings, because they answer different questions.
 *
 * By reason: which check failed - the subdistrict, the district, or TD simply
 * holds more than one parcel. That is what went wrong.
 *
 * By how close the areas are: how far the cadastre's area is from LED's. A near
 * miss is a naming convention or a rounding; a far one is a different piece of
 * land under the same deed number. That is whether it can be recovered.
 *
 * Every row carries the case number and the deed number, which are the two
 * things to type into each site:
 *
 *   LED   https://asset.led.go.th/newbidreg/  - search the case number
 *   TD    https://assessprice.treasury.go.th/assessprice/  - search the deed number
 *
 * plus the land number and the cadastral sheet, which identify the parcel in
 * the cadastre.
 */
import { Client } from "pg";

const per = Number(process.argv[2] || 4);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

const { rows } = await db.query(`
  SELECT p.id, p.deed_number, l.case_no, l.case_year, l.asset_type, l.size_rai, l.size_ngan, l.size_wa,
         p.tumbol, p.district_name, p.province_name, p.district_dol_code,
         d.td_code, d.td_province_code, p.geo_note, p.dol_verdict,
         p.td_land_no, p.td_survey_no, p.td_rawang
    FROM parcels p
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
    LEFT JOIN LATERAL (SELECT case_no, case_year, asset_type, size_rai, size_ngan, size_wa FROM auction_lots
                         WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
   WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.td_utm_e IS NOT NULL
   ORDER BY p.id`);

/* the two areas out of the note, so the rows can be grouped by how close they are */
const areas = (note) => {
  const m = /cadastre area is ([0-9.-]+) \(([0-9.]+) ตร\.ว\.\) against LED ([0-9.]+) ตร\.ว\./.exec(note ?? "");
  if (!m) return null;
  const cad = Number(m[2]), led = Number(m[3]);
  return { cad, led, ratio: led ? Math.abs(cad - led) / led : null };
};

const show = (r) => {
  const a = areas(r.geo_note);
  line(`     parcel ${r.id}  deed ${r.deed_number}  case ${r.case_no ?? "-"}/${r.case_year ?? "-"}   ${r.asset_type ?? ""}`);
  line(`        LED   ${r.province_name} / ${r.district_name} / ${r.tumbol}   size ${r.size_rai ?? 0}-${r.size_ngan ?? 0}-${r.size_wa ?? 0} ตร.ว.`);
  line(`        TD    province ${r.td_province_code} district ${r.td_code}`);
  line(`        note  ${r.geo_note ?? ""}`);
  line(`        land  land_no ${r.td_land_no ?? "-"}  survey ${r.td_survey_no ?? "-"}  sheet ${r.td_rawang ?? "-"}`);
};

line(`\n================= BY REASON =================`);
for (const reason of ["tambon_mismatch", "district_mismatch", "ambiguous", "no_result"]) {
  const group = rows.filter((r) => r.dol_verdict === reason);
  if (!group.length) continue;
  line(`\n  --- ${reason}: ${group.length} ---`);
  for (const r of group.slice(0, per)) show(r);
  if (group.length > per) line(`     ...and ${group.length - per} more`);
}

line(`\n================= BY HOW CLOSE THE AREAS ARE =================`);
for (const [label, test] of [
  ["within a quarter", (a) => a && a.ratio !== null && a.ratio <= 0.25],
  ["further apart", (a) => a && a.ratio !== null && a.ratio > 0.25],
  ["could not be compared", (a) => !a || a.ratio === null],
]) {
  const group = rows.filter((r) => test(areas(r.geo_note)));
  if (!group.length) continue;
  line(`\n  --- ${label}: ${group.length} ---`);
  for (const r of group.slice(0, per)) show(r);
  if (group.length > per) line(`     ...and ${group.length - per} more`);
}

/* The ones with nothing to compare are a different failure, and they need a
 * different kind of looking at: LED published no size at all, or published a
 * size with its sub-parts zeroed. The first kind cannot be searched for by case
 * number at all - there is no case number - so it has to be found by browsing the
 * district on the LED site. */
line(`\n================= NOTHING TO COMPARE AGAINST =================`);
const { rows: bare } = await db.query(`
  SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_name, p.geo_note, p.dol_verdict,
         l.case_no, l.case_year, l.order_number, l.order_sub, l.asset_type, l.remark,
         l.size_rai, l.size_ngan, l.size_wa, l.start_price, l.published_date, l.first_round_date
    FROM parcels p
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
    LEFT JOIN LATERAL (SELECT * FROM auction_lots WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
   WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.td_utm_e IS NOT NULL
     AND (l.size_rai IS NULL OR l.size_wa IS NULL OR l.size_wa = 0 OR l.case_no IS NULL)
   ORDER BY (l.case_no IS NULL) DESC, p.id`);
for (const r of bare) {
  const noCase = !r.case_no;
  line(`     ${String(r.id).padStart(5)} ${String(r.deed_number).padEnd(8)} ` +
    `${noCase ? "NO CASE NUMBER - browse the district on the LED site" : `case ${r.case_no}/${r.case_year} order ${r.order_number}-${r.order_sub}`}` +
    `   ${r.province_name}/${r.district_name}/${r.tumbol ?? "-"}` +
    `   size ${r.size_rai ?? "-"}-${r.size_ngan ?? "-"}-${r.size_wa ?? "-"}` +
    `   ${r.asset_type ?? "-"}${r.remark ? `   remark: ${r.remark}` : ""}`);
}
line(`     ${bare.length} in total`);

await db.end();