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
import { createTdLookup, pickTdRow, normaliseTdRow } from "./tdLookup.js";
import { dictionaries } from "./tdDict.js";
import { raiNganWaToSqWa, compareArea } from "./provenance.js";
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
const lookup = await createTdLookup({ delayMs: 400, log: () => {} });
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
    const tdRows = (td.rows ?? []).map(normaliseTdRow);
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
      } else {
        verdict = "tambon_mismatch";
        detail = `TD has it in ${ourDistrict} but not in ${p.tumbol}`;
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