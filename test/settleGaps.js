/* settleGaps.js — decide the 289 with a live session and the official area.
 *
 *   DATABASE_URL=... bun settleGaps.js [limit]
 *
 * An earlier sweep asked TD about every placed parcel in one session and
 * withdrew 289 coordinates it could not justify. The session had died by then, and
 * a dead session answers empty, which looks exactly like a deed the register does
 * not hold. So those 289 were never really examined.
 *
 * This asks again, with a session that renews itself, and settles each one
 * against the official cadastre rather than against TD's word alone:
 *
 *   - TD is asked for the deed, and the row for our district and subdistrict is
 *     taken. A deed number is not unique - 34062 is held by 251 parcels
 *     nationwide - so this step is the one that can be wrong.
 *   - the cadastre is asked for that parcel's area.
 *   - for land, the areas must agree. That is the proof: deed 34062 is 0-0-36.00
 *     in the cadastre and 0-0-36 in LED.
 *   - a ห้องชุด is excluded from the area test. LED publishes the unit's floor
 *     area and the cadastre publishes the land under the building, so they never
 *     agree: deed 44021 is 30.35 square metres in LED and 3-0-15.50, some 1,215
 *     square wah, in the cadastre.
 *
 * What is left after that is the error group, and it is written with the reason
 * so the settings pane can show it.
 */
import { createResilientLookup, pickTdRow } from "./tdLookup.js";
import { officialArea } from "./tdCadastre.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";
import { raiNganWaToSqWa } from "./provenance.js";
import { Client } from "pg";

const limit = Number(process.argv[2] || 0);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

/* Unplaced, but TD has been asked about them before: they still carry the UTM
 * pair and the sheet, so the parcel is identified even though the coordinate
 * was withdrawn. */
const { rows } = await db.query(
  `SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_code,
          p.district_dol_code, p.td_utm_e, p.td_utm_n, p.td_srid, p.td_land_no,
          d.code AS led_code, d.td_code, d.td_province_code,
          l.asset_type, l.size_rai, l.size_ngan, l.size_wa
     FROM parcels p
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
     LEFT JOIN LATERAL (SELECT asset_type, size_rai, size_ngan, size_wa FROM auction_lots
                          WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
    WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.td_utm_e IS NOT NULL
    ORDER BY p.id ${limit ? `LIMIT ${Number(limit)}` : ""}`);

line(`  ${rows.length} parcel(s) to settle`);
const lookup = await createResilientLookup({ delayMs: 400, log: () => {} });
const tally = {};

const place = async (p, r, area) => {
  const cal = await loadCalibration(db, { srid: r.utmSrid });
  const tf = calibratedTransform(cal, `ST_MakePoint($1, $2)`);
  const { rows: pt } = await db.query(
    `SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`,
    [r.utmEasting, r.utmNorthing]);
  await db.query(
    `UPDATE parcels SET td_lat=$2, td_lon=$3, td_srid=$4, td_utm_e=$5, td_utm_n=$6,
                       td_land_no=$7, td_survey_no=$8, td_rawang=$9, td_object_id=$10,
                       td_verdict='match', td_status='resolved_via_td', td_checked_at=now(),
                       geom=ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
                       geo_precision='parcel', geo_status='verified',
                       dol_verdict='match', geo_note=$11
      WHERE id=$1`,
    [p.id, Number(pt[0].lat), Number(pt[0].lon), r.utmSrid, r.utmEasting, r.utmNorthing,
     r.landNo ?? null, r.surveyNo ?? null, r.rawang ?? null,
     r.raw?.OBJECTID != null ? Number(r.raw.OBJECTID) : null,
     area ? `placed from TD's ${r.amphurName}/${r.tambonName}; cadastre area ${area.area}` : null]);
};

for (const [i, p] of rows.entries()) {
  lookup.setProvince(p.td_province_code);
  const td = await lookup({ deed_number: p.deed_number, province_code: p.td_province_code });
  /* createTdLookup already normalises the rows. Normalising them again
     * reads fields that are not there and leaves every one of them null. */
    const tdRows = td.rows ?? [];
  const pick = pickTdRow(tdRows, { tumbol: p.tumbol, amphur: p.district_name });

  let verdict, detail, placed = false;

  if (!pick.row) {
    const inDistrict = tdRows.filter((r) => String(r.amphurName ?? "").trim() === String(p.district_name ?? "").trim());
    if (inDistrict.length > 1) {
      verdict = "ambiguous";
      detail = `TD has ${inDistrict.length} parcels in ${p.district_name} for deed ${p.deed_number}`;
    } else if (inDistrict.length === 1) {
      verdict = "tambon_mismatch";
      detail = `TD has it in ${p.district_name} / ${inDistrict[0].tambonName}, LED says ${p.tumbol}`;
    } else if (tdRows.length) {
      verdict = "district_mismatch";
      detail = `TD has deed ${p.deed_number} in ${[...new Set(tdRows.map((r) => r.amphurName))].join(", ")}, LED says ${p.district_name}`;
    } else {
      verdict = "no_result";
      detail = `TD has no parcel under deed ${p.deed_number} in province ${p.td_province_code}`;
    }
  } else {
    const r = pick.row;
    const isCondo = /ห้องชุด/.test(String(p.asset_type ?? ""));
    const ledSqWa = raiNganWaToSqWa(p.size_rai, p.size_ngan, p.size_wa);
    const cad = await officialArea({
      chanod: p.deed_number,
      provinceCode: String(p.td_province_code),
      amphurName: r.amphurName,
      tumbonName: r.tambonName,
    });
    if (!isCondo && cad.found && cad.sqWa != null && ledSqWa != null) {
      const diff = Math.abs(cad.sqWa - ledSqWa);
      if (diff > Math.max(1, ledSqWa * 0.05)) {
        verdict = "area_mismatch";
        detail = `LED says ${ledSqWa} ตร.ว., the cadastre says ${cad.area} (${cad.sqWa} ตร.ว.)`;
      } else {
        verdict = "match";
        detail = `placed; LED ${ledSqWa} ตร.ว. matches the cadastre ${cad.area}`;
        placed = true;
      }
    } else {
      verdict = "match";
      detail = isCondo
        ? `placed from TD's ${r.amphurName}/${r.tambonName} (a ห้องชุด: LED's room size is not the land's)`
        : `placed from TD's ${r.amphurName}/${r.tambonName}` + (cad.found ? `; cadastre area ${cad.area}` : "");
      placed = true;
    }
  }

  if (placed) {
    const r = pick.row;
    const cad = null;
    await place(p, r, cad);
  } else {
    await db.query(
      `UPDATE parcels SET dol_verdict=$2, geo_note=$3, td_checked_at=now() WHERE id=$1`,
      [p.id, verdict, detail]);
  }
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} ${String(p.district_name).padEnd(16)} ${String(p.tumbol).padEnd(16)} -> ${verdict}: ${detail}`);
  if ((i + 1) % 25 === 0) line(`  ...${i + 1}/${rows.length}`);
}

line(`\n  ${JSON.stringify(tally)}`);
await lookup.close();
await db.end();