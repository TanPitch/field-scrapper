/* verifyPlaced.js — does each stored coordinate come from the right TD row?
 *
 *   DATABASE_URL=... bun verifyPlaced.js [sampleSize]
 *
 * For a sample of placed parcels, asks TD for the deed again, finds the row whose
 * subdistrict matches ours, projects that row's own SHAPE the way the pipeline
 * does, and compares it with the coordinate we stored. A parcel passes when the
 * two agree - which means the coordinate on the map belongs to the land LED
 * described, and not to another parcel that happens to share the deed number.
 */
import { createTdLookup, pickTdRow } from "./tdLookup.js";
import { dictionaries as dictionariesRef } from "./tdDict.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";
import { Client } from "pg";

const N = Number(process.argv[2] || 25);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

const { rows } = await db.query(
  `SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.td_lat, p.td_lon,
          d.td_code, d.td_province_code, p.province_code
     FROM parcels p
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
    WHERE p.td_lat IS NOT NULL AND p.td_verdict = 'match'
    ORDER BY random() LIMIT $1`, [N]);

const lookup = await createTdLookup({ delayMs: 400, log: () => {} });
const dictionaries = dictionariesRef;
let pass = 0, fail = 0, noRow = 0;
const failures = [];

for (const p of rows) {
  lookup.setProvince(p.td_province_code);
  const td = await lookup({ deed_number: p.deed_number, province_code: p.td_province_code });
  const tdRows = td.rows ?? [];
  /* The pipeline's own picker, on a live answer. This is the check that matters:
   * if the picker finds the same land the coordinate came from, the placement is
   * the one the pipeline would make today. */
  const dd = dictionaries().ledDistricts[String(p.led_code)];
  const pick = pickTdRow(tdRows, { tumbol: p.tumbol, amphur: dd?.tdDistrictName ?? null });
  if (!pick.row) {
    noRow++;
    line(`  ${p.id} ${p.deed_number}  ${p.district_name}/${p.tumbol}  -> the picker finds nothing (${tdRows.length} rows from TD)`);
    continue;
  }
  const r = pick.row;
  if (r.utmEasting == null) {
    noRow++;
    line(`  ${p.id} ${p.deed_number}  -> the picked row has no SHAPE`);
    continue;
  }
  const cal = await loadCalibration(db, { srid: r.utmSrid });
  const tf = calibratedTransform(cal, `ST_MakePoint($1, $2)`);
  const { rows: pt } = await db.query(
    `SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`, [r.utmEasting, r.utmNorthing]);
  const dLat = (Number(pt[0].lat) - Number(p.td_lat)) * 111320;
  const dLon = (Number(pt[0].lon) - Number(p.td_lon)) * 111320 * Math.cos((Number(p.td_lat) * Math.PI) / 180);
  const d = Math.hypot(dLat, dLon);
  if (d < 5) pass++;
  else { fail++; failures.push(`  ${p.id} ${p.deed_number} ${p.district_name}/${p.tumbol}: stored ${Number(p.td_lat).toFixed(6)},${Number(p.td_lon).toFixed(6)} vs the picked row ${Number(pt[0].lat).toFixed(6)},${Number(pt[0].lon).toFixed(6)}  off ${d.toFixed(0)} m`); }
}

line(`\n  ${rows.length} sampled:`);
line(`     the stored coordinate matches TD's subdistrict row : ${pass}`);
line(`     does not match                                    : ${fail}`);
line(`     TD had no row with our subdistrict, or no SHAPE   : ${noRow}`);
if (failures.length) { line("  the ones that do not match:"); failures.forEach((f) => line(f)); }

await lookup.close();
await db.end();