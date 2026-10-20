/* repairPlaced.js — re-place every parcel that is on the map, using today's rule.
 *
 *   DATABASE_URL=... bun repairPlaced.js [limit]
 *
 * The pipeline only ever worked on parcels with no coordinate, so a parcel placed
 * by an older rule kept that coordinate for ever. This asks TD about every placed
 * parcel, picks the row with the pipeline's own picker, and:
 *
 *   same land as we have   -> nothing to do
 *   a different piece of land -> the coordinate is corrected
 *   TD cannot place it      -> the coordinate is withdrawn, and the parcel goes
 *                              back on the queue to be looked at again
 *
 * TD has no daily allowance, so this costs nothing but time. The กรมที่ดิน
 * allowance is not touched.
 */
import { createResilientLookup, pickTdRow } from "./tdLookup.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";
import { dictionaries } from "./tdDict.js";
import { Client } from "pg";

const limit = Number(process.argv[2] || 0);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const dict = dictionaries();
const line = (s) => console.log(s);

const { rows } = await db.query(
  `SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.td_lat, p.td_lon,
          d.code AS led_code, d.td_code, d.td_province_code
     FROM parcels p
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
    WHERE p.td_lat IS NOT NULL
    ORDER BY p.id ${limit ? `LIMIT ${Number(limit)}` : ""}`);

line(`  ${rows.length} placed parcel(s) to check`);
const lookup = await createResilientLookup({ delayMs: 400, log: () => {} });
let same = 0, moved = 0, withdrawn = 0, noRow = 0, failed = 0;

for (const [i, p] of rows.entries()) {
  let td;
  try {
    lookup.setProvince(p.td_province_code);
    td = await lookup({ deed_number: p.deed_number, province_code: p.td_province_code });
  } catch (e) {
    failed++;
    line(`  ${p.id} ${p.deed_number}: TD request failed - ${String(e.message).slice(0, 60)}`);
    continue;
  }
  const dd = dict.ledDistricts[String(p.led_code)];
  const pick = pickTdRow(td.rows ?? [], { tumbol: p.tumbol, amphur: dd?.tdDistrictName ?? null });
  if (!pick.row || pick.row.utmEasting == null) {
    // TD cannot place this one. The coordinate we have cannot be justified.
    await db.query(
      `UPDATE parcels SET td_lat=NULL, td_lon=NULL, geom=NULL, td_verdict=NULL, td_status=NULL,
                         geo_status='unresolved', geo_precision=NULL
        WHERE id=$1`, [p.id]);
    withdrawn++;
    line(`  ${p.id} ${p.deed_number} ${p.district_name}/${p.tumbol}: TD cannot place it - coordinate withdrawn`);
    continue;
  }
  const r = pick.row;
  const cal = await loadCalibration(db, { srid: r.utmSrid });
  const tf = calibratedTransform(cal, `ST_MakePoint($1, $2)`);
  const { rows: pt } = await db.query(
    `SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`, [r.utmEasting, r.utmNorthing]);
  const lat = Number(pt[0].lat), lon = Number(pt[0].lon);
  const d = Math.hypot((lat - Number(p.td_lat)) * 111320,
                       (lon - Number(p.td_lon)) * 111320 * Math.cos((Number(p.td_lat) * Math.PI) / 180));
  if (d < 5) { same++; }
  else {
    await db.query(
      `UPDATE parcels SET td_lat=$2, td_lon=$3, td_srid=$4, td_utm_e=$5, td_utm_n=$6,
                         td_land_no=$7, td_survey_no=$8, td_rawang=$9, td_object_id=$10,
                         td_verdict='match', td_status='resolved_via_td', td_checked_at=now(),
                         geom=ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
                         geo_precision='parcel', geo_status='verified'
        WHERE id=$1`,
      [p.id, lat, lon, r.utmSrid, r.utmEasting, r.utmNorthing, r.landNo ?? null,
       r.surveyNo ?? null, r.rawang ?? null, r.raw?.OBJECTID != null ? Number(r.raw.OBJECTID) : null]);
    moved++;
    line(`  ${p.id} ${p.deed_number} ${p.district_name}/${p.tumbol}: moved ${d.toFixed(0)} m  ${Number(p.td_lat).toFixed(6)},${Number(p.td_lon).toFixed(6)} -> ${lat.toFixed(6)},${lon.toFixed(6)}`);
  }
  if ((i + 1) % 200 === 0) line(`  ...${i + 1}/${rows.length}  same ${same}  moved ${moved}  withdrawn ${withdrawn}`);
}

line(`\n  same ${same}   moved ${moved}   withdrawn ${withdrawn}   failed ${failed}`);
await lookup.close();
await db.end();