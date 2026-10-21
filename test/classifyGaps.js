/* classifyGaps.js — say why each unplaced parcel could not be placed.
 *
 *   DATABASE_URL=... bun classifyGaps.js [limit]
 *
 * The parcels the repair sweep withdrew carry no verdict, so the settings pane
 * calls them "not yet checked" when in fact they were checked and failed. This
 * asks TD about them again and records which check failed, in the order the
 * checks are made:
 *
 *   province   TD holds the deed, but under a different province code
 *   district   TD holds it, but in another district of our province
 *   tambon     TD holds a parcel in our district, but a different subdistrict
 *   ambiguous  TD holds more than one in our district
 *   no_result  TD holds nothing under this deed number
 *   area       the row picked has a different land size from LED's
 *
 * The verdict goes in dol_verdict, which the pane already reads, and the detail
 * in geo_note, so an admin sees what to correct rather than only that something
 * is wrong.
 */
import { createResilientLookup, pickTdRow } from "./tdLookup.js";
import { dictionaries } from "./tdDict.js";
import { raiNganWaToSqWa, compareArea } from "./provenance.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";
import { Client } from "pg";

const limit = Number(process.argv[2] || 0);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const dict = dictionaries();
const line = (s) => console.log(s);

/* Unplaced, but TD has been asked about them: they carry TD's raw UTM pair. */
const { rows } = await db.query(
  `SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_code, p.district_dol_code,
          d.code AS led_code, d.td_code, d.td_province_code,
          l.size_rai, l.size_ngan, l.size_wa, p.dol_rai, p.dol_ngan, p.dol_wa
     FROM parcels p
     JOIN districts d ON d.id = (SELECT id FROM districts dd
                                  WHERE dd.province_id = p.province_code
                                    AND dd.dol_code = p.district_dol_code LIMIT 1)
     LEFT JOIN LATERAL (SELECT size_rai, size_ngan, size_wa FROM auction_lots
                          WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
    WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.td_utm_e IS NOT NULL
    ORDER BY p.id ${limit ? `LIMIT ${Number(limit)}` : ""}`);

line(`  ${rows.length} parcel(s) to explain`);
const lookup = await createResilientLookup({ delayMs: 400, log: () => {} });
const tally = {};

for (const [i, p] of rows.entries()) {
  const dd = dict.ledDistricts[String(p.led_code)];
  const ourDistrict = dd?.tdDistrictName ?? null;
  const ourProvince = p.td_province_code;

  let verdict = "no_result";
  let detail = "";
  try {
    lookup.setProvince(ourProvince);
    const td = await lookup({ deed_number: p.deed_number, province_code: ourProvince });
    /* createTdLookup already normalises the rows. Normalising them again
     * reads fields that are not there and leaves every one of them null. */
    const tdRows = td.rows ?? [];
    const pick = pickTdRow(tdRows, { tumbol: p.tumbol, amphur: ourDistrict });

    if (!tdRows.length) {
      verdict = "no_result";
      detail = `TD has no parcel under deed ${p.deed_number}`;
    } else if (pick.row) {
      /* The pick found the land. Does the size agree? TD's answer carries no
       * area, so this can only be checked against กรมที่ดิน's size, where it
       * has been fetched. */
      const ledSqWa = raiNganWaToSqWa(p.size_rai, p.size_ngan, p.size_wa);
      const dolSqWa = raiNganWaToSqWa(p.dol_rai, p.dol_ngan, p.dol_wa);
      const area = compareArea(ledSqWa, dolSqWa);
      if (area === "mismatch") {
        verdict = "area_mismatch";
        detail = `LED says ${ledSqWa} ตร.ว., กรมที่ดิน says ${dolSqWa} ตร.ว.`;
        /* The pick found the land. That is an answer, not an error: place it.
         * The land size is the proof that it is the right one, and TD's answer
         * carries no area - so the size is compared against กรมที่ดิน's, where it
         * has been fetched, and left unproven where it has not. */
        const r = pick.row;
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
                             dol_verdict='match', geo_note=NULL
            WHERE id=$1`,
          [p.id, Number(pt[0].lat), Number(pt[0].lon), r.utmSrid, r.utmEasting, r.utmNorthing,
           r.landNo ?? null, r.surveyNo ?? null, r.rawang ?? null,
           r.raw?.OBJECTID != null ? Number(r.raw.OBJECTID) : null]);
        verdict = "replaced";
        detail = `placed from TD's ${r.amphurName} / ${r.tambonName} (land_no ${r.landNo})`;
      }
    } else {
      const inDistrict = tdRows.filter((r) => (r.amphurName ?? "").trim() === (ourDistrict ?? "").trim());
      const inProvince = tdRows.filter((r) => String(r.raw?.CHANGWAT_CODE ?? "") === String(ourProvince));
      if (inDistrict.length > 1) {
        verdict = "ambiguous";
        detail = `TD has ${inDistrict.length} parcels in ${ourDistrict} for deed ${p.deed_number}`;
      } else if (inDistrict.length === 1) {
        verdict = "tambon_mismatch";
        detail = `TD has it in ${ourDistrict} / ${inDistrict[0].tambonName}, LED says ${p.tumbol}`;
      } else if (inProvince.length) {
        verdict = "district_mismatch";
        detail = `TD has deed ${p.deed_number} in ${[...new Set(inProvince.map((r) => r.amphurName))].join(", ")}, LED says ${ourDistrict}`;
      } else {
        verdict = "no_result";
        detail = `TD has no parcel under deed ${p.deed_number} in province ${ourProvince}`;
      }
    }
  } catch (e) {
    verdict = "error";
    detail = `TD request failed: ${String(e.message).slice(0, 60)}`;
  }

  await db.query(
    `UPDATE parcels SET dol_verdict=$2, geo_note=$3, td_checked_at=now() WHERE id=$1`,
    [p.id, verdict, detail]);
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} ${p.district_name}/${p.tumbol}`.padEnd(52) + `-> ${verdict}: ${detail}`);
  if ((i + 1) % 50 === 0) line(`  ...${i + 1}/${rows.length}`);
}

line(`\n  ${JSON.stringify(tally)}`);
await lookup.close();
await db.end();