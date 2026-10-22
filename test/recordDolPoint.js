/* recordDolPoint.js — record a coordinate that was checked by hand.
 *
 *   DATABASE_URL=... bun recordDolPoint.js <parcelId> <lat> <lon> [rai ngan wa] [note]
 *
 * Some parcels are found by hand on กรมที่ดิน's site, which holds twenty lookups
 * a day and so cannot be asked about everything. When a person has found one,
 * the answer is written here with the same columns the automated leg writes, so
 * the app cannot tell the two apart and nothing downstream has to care which.
 *
 * The size is checked against LED's before it is stored: the two sites have to
 * show the same area, and a size that disagrees means a different piece of
 * land. A size that is left out is not checked, and the note says so.
 */
import { Client } from "pg";
import { raiNganWaToSqWa } from "./provenance.js";

const [idArg, latArg, lonArg, raiArg, nganArg, waArg, ...noteParts] = process.argv.slice(2);
if (!idArg || !latArg || !lonArg) {
    console.error("usage: bun recordDolPoint.js <parcelId> <lat> <lon> [rai ngan wa] [note]");
    process.exit(1);
}
const parcelId = Number(idArg);
const lat = Number(latArg), lon = Number(lonArg);
const rai = raiArg != null ? Number(raiArg) : null;
const ngan = nganArg != null ? Number(nganArg) : null;
const wa = waArg != null ? Number(waArg) : null;
const note = noteParts.join(" ") || "found by hand on กรมที่ดิน's site";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(`
  SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_name,
         l.size_rai, l.size_ngan, l.size_wa, l.case_no, l.case_year
    FROM parcels p
    LEFT JOIN LATERAL (SELECT * FROM auction_lots WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
   WHERE p.id = $1`, [parcelId]);
const p = rows[0];
if (!p) { console.error(`  no parcel ${parcelId}`); await db.end(); process.exit(1); }

const ledSqWa = raiNganWaToSqWa(p.size_rai, p.size_ngan, p.size_wa);
const dolSqWa = raiNganWaToSqWa(rai, ngan, wa);
const agree = ledSqWa != null && dolSqWa != null &&
    Math.abs(ledSqWa - dolSqWa) <= Math.max(1, ledSqWa * 0.05);

console.log(`  parcel ${p.id}  deed ${p.deed_number}  ${p.province_name}/${p.district_name}/${p.tumbol}`);
console.log(`     case        ${p.case_no ?? "-"}/${p.case_year ?? "-"}`);
console.log(`     LED size    ${p.size_rai ?? "-"}-${p.size_ngan ?? "-"}-${p.size_wa ?? "-"} ตร.ว.${ledSqWa != null ? ` (${ledSqWa})` : ""}`);
console.log(`     กรมที่ดิน size ${rai ?? "-"}-${ngan ?? "-"}-${wa ?? "-"} ตร.ว.${dolSqWa != null ? ` (${dolSqWa})` : ""}`);
console.log(`     point       ${lat}, ${lon}`);
console.log(`     the two areas ${agree ? "AGREE" : ledSqWa == null || dolSqWa == null ? "not compared" : "DISAGREE"}`);

if (!agree && ledSqWa != null && dolSqWa != null) {
    console.error("  refusing to store: the areas disagree, so it is a different piece of land");
    await db.end();
    process.exit(1);
}

await db.query(
    `UPDATE parcels
        SET dol_lat = $2, dol_lon = $3,
            dol_rai = COALESCE($4, dol_rai),
            dol_ngan = COALESCE($5, dol_ngan),
            dol_wa = COALESCE($6, dol_wa),
            dol_status = 'resolved',
            dol_checked_at = now(),
            dol_verdict = 'match',
            geo_status = 'verified',
            geo_precision = 'parcel',
            geo_note = $7,
            geom = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
      WHERE id = $1`,
    [parcelId, lat, lon, rai, ngan, wa, note]);

console.log("  written");
await db.end();
