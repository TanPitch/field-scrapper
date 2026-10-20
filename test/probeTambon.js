/* probeTambon.js — does TD hold our parcel's tambon under any district?
 *
 *   DATABASE_URL=... bun probeTambon.js
 *
 * For every parcel still unplaced with a district_mismatch verdict, ask TD for
 * its deed and look for a row whose TUMBON_NAME is the tambon LED gave us.
 *
 * The district filter can only ever work when TD indexes the land under the
 * same deed number we hold. This asks the other question: even if the district
 * is wrong, is the land itself there? If no row anywhere carries our tambon,
 * then TD does not know this parcel under this deed number, and no mapping can
 * recover it.
 */
import pg from "pg";
import { createTdLookup } from "./tdLookup.js";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT p.id, p.deed_number, p.tumbol, p.district_name,
         d.td_province_code, d.code AS led_district
    FROM parcels p
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
   WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.dol_verdict = 'district_mismatch'
   ORDER BY p.province_code, p.deed_number`);

const lookup = await createTdLookup({ delayMs: 250, log: () => {} });
let sameTambon = 0, sameDistrict = 0, noRows = 0, neither = 0;
const hits = [];

for (const [i, p] of rows.entries()) {
  lookup.setProvince(p.td_province_code);
  let res;
  try {
    res = await lookup({ deed_number: p.deed_number, province_code: p.td_province_code });
  } catch (e) {
    console.log(`  ${i + 1}/${rows.length}  deed ${p.deed_number}: request failed, ${String(e.message).slice(0, 50)}`);
    continue;
  }
  const list = res.found ? res.rows : [];
  if (!list.length) { noRows++; continue; }
  const want = (p.tumbol ?? "").trim();
  const tHit = list.filter((r) => (r.tambonName ?? "").trim() === want);
  const dHit = list.filter((r) => (r.amphurName ?? "").trim() === p.district_name);
  if (tHit.length) {
    sameTambon++;
    hits.push(`deed ${p.deed_number}: LED "${p.tumbol}" / ${p.district_name}  ->  TD ${tHit.map((r) => r.amphurName + "/" + r.tambonName).join(", ")}`);
  } else if (dHit.length) sameDistrict++;
  else neither++;
  if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${rows.length}`);
}

console.log(`\n  ${rows.length} district_mismatch parcels asked of TD:`);
console.log(`     TD has a row with the SAME TAMBON somewhere : ${sameTambon}`);
console.log(`     TD has a row in our district but not our tambon : ${sameDistrict}`);
console.log(`     TD returned no rows at all : ${noRows}`);
console.log(`     TD returned rows, none matching either : ${neither}`);
if (hits.length) {
  console.log("\n  the ones TD does have our tambon for:");
  hits.slice(0, 20).forEach((h) => console.log(`     ${h}`));
}
await lookup.close();
await client.end();