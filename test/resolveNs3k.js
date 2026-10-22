/* resolveNs3k.js — place the น.ส.3ก. parcels, for free.
 *
 *   DATABASE_URL=... bun resolveNs3k.js            # dry run
 *   DATABASE_URL=... bun resolveNs3k.js --write
 *   DATABASE_URL=... bun resolveNs3k.js --write --limit=20
 *
 * A น.ส.3ก. is a 3-3 title: a room or a shop on a piece of land someone else
 * holds. TD holds them on their own layer, NS3K, and they are searched by
 * NS3A_ID rather than by deed number. Sending a 3-3 number to the PARCEL layer
 * answers with rows, and every one of them is a different piece of land - which
 * is what happened: 134 parcels sat in the error group because the ordinary
 * resolver asked the wrong layer, got a parcel in some other district, and
 * filed the disagreement.
 *
 * So they are asked properly, and the answer is confirmed the same way every
 * other parcel is confirmed: the area.
 *
 *   - the map layer's NS3K rows carry LAND_AREA, the official area
 *   - LED publishes the size of the unit
 *   - the two must agree, or it is a different piece of land
 *
 * The layer holds no shape, so the shape comes from the NS3K search, which
 * gives it. Two requests a parcel, both free - TD has no daily allowance.
 *
 * A ห้องชุด is not touched here. LED publishes the unit's floor area and the
 * cadastre publishes the land under the building, so the two never agree and
 * the area test would reject every one of them.
 */
import { Client } from "pg";
import { createResilientLookup } from "./tdLookup.js";
import { ns3kRows, areaToSqWa } from "./tdCadastre.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";
import { raiNganWaToSqWa } from "./provenance.js";

const WRITE = process.argv.includes("--write");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").slice(8)) || 0;

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

const { rows: todo } = await db.query(`
  SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_name,
         p.land_title, d.td_province_code, d.td_code,
         l.size_rai, l.size_ngan, l.size_wa, l.asset_type, l.case_no, l.case_year
    FROM parcels p
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
    LEFT JOIN LATERAL (SELECT * FROM auction_lots WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
   WHERE p.td_lat IS NULL AND p.dol_lat IS NULL
     AND p.land_title LIKE 'น.ส.3ก%'
   ORDER BY p.id${LIMIT ? ` LIMIT ${LIMIT}` : ""}`);

line(`  ${todo.length} น.ส.3ก. parcel(s) to place, ${WRITE ? "WRITE" : "dry run"}`);
if (!todo.length) { await db.end(); process.exit(0); }

const lookup = await createResilientLookup({ delayMs: 400, log: () => {} });
const tally = {};
const note = async (id, verdict, detail) => {
    tally[verdict] = (tally[verdict] ?? 0) + 1;
    if (WRITE) {
        await db.query(
            `UPDATE parcels SET dol_verdict=$2, geo_note=$3, td_checked_at=now() WHERE id=$1`,
            [id, verdict, detail]);
    }
};

for (const [i, p] of todo.entries()) {
    const ledSqWa = raiNganWaToSqWa(p.size_rai, p.size_ngan, p.size_wa);

    /* The map layer: every parcel of this province carrying this 3-3 number,
     * each with its official area. */
    const layerRows = await ns3kRows(p.deed_number, p.td_province_code);
    const agree = layerRows.filter((r) => {
        const sq = areaToSqWa(r.LAND_AREA);
        if (sq == null || ledSqWa == null) return false;
        return Math.abs(sq - ledSqWa) <= Math.max(1, ledSqWa * 0.05);
    });

    if (!agree.length) {
        const all = layerRows.map((r) => `${r.AMPHUR_NAME}/${r.TUMBON_NAME} ${r.LAND_AREA ?? "-"}`);
        const verdict = layerRows.length ? "area_mismatch" : "no_result";
        await note(p.id, verdict,
            layerRows.length
                ? `no น.ส.3ก. parcel of ${p.deed_number} in ${p.province_name} has LED's area; the layer holds ${layerRows.length}: ${all.slice(0, 4).join(", ")}`
                : `TD holds no น.ส.3ก. parcel numbered ${p.deed_number} in province ${p.td_province_code}`);
        line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} -> ${verdict}`);
        continue;
    }

    /* More than one with the same area: the place breaks the tie. */
    let cand = agree[0];
    if (agree.length > 1) {
        const samePlace = agree.find((r) =>
            String(r.AMPHUR_NAME ?? "").trim() === String(p.district_name ?? "").trim() &&
            String(r.TUMBON_NAME ?? "").trim() === String(p.tumbol ?? "").trim());
        const sameDistrict = agree.find((r) =>
            String(r.AMPHUR_NAME ?? "").trim() === String(p.district_name ?? "").trim());
        cand = samePlace ?? sameDistrict ?? null;
        if (!cand) {
            await note(p.id, "ambiguous",
                `${agree.length} น.ส.3ก. parcels numbered ${p.deed_number} have LED's area ${ledSqWa} ตร.ว.: ` +
                agree.map((r) => `${r.AMPHUR_NAME}/${r.TUMBON_NAME} land_no ${r.LAND_NO}`).join(", "));
            line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} -> ambiguous`);
            continue;
        }
    }

    /* The shape, from the NS3K search. */
    const search = await lookup.ns3k(p.deed_number, p.td_province_code);
    const row = search.find((x) => String(x.landNo ?? "").trim() === String(cand.LAND_NO ?? "").trim())
        ?? search.find((x) =>
            String(x.amphurName ?? "").trim() === String(cand.AMPHUR_NAME ?? "").trim() &&
            String(x.tambonName ?? "").trim() === String(cand.TUMBON_NAME ?? "").trim());

    if (!row || row.utmEasting == null) {
        await note(p.id, "no_shape",
            `TD's NS3K search returned no shape for น.ส.3ก. ${p.deed_number} land_no ${cand.LAND_NO}` +
            (search.length ? ` (${search.length} row(s) came back)` : ""));
        line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} -> no_shape`);
        continue;
    }

    /* The coordinate is projected by PostGIS, with the calibration for this
     * row's own SRID. */
    const cal = await loadCalibration(db, { srid: row.utmSrid });
    const tf = calibratedTransform(cal, `ST_MakePoint($1::double precision, $2::double precision)`);
    const { rows: pt } = await db.query(
        `SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`,
        [row.utmEasting, row.utmNorthing]);
    const lat = Number(pt[0].lat), lon = Number(pt[0].lon);
    const detail = `placed from TD's NS3K layer: ${row.amphurName}/${row.tambonName} land_no ${cand.LAND_NO}, ` +
        `the cadastre area ${cand.LAND_AREA} (${areaToSqWa(cand.LAND_AREA)} ตร.ว.) against LED ${ledSqWa} ตร.ว.`;

    if (WRITE) {
        await db.query(
            `UPDATE parcels SET td_lat=$2, td_lon=$3, td_srid=$4, td_utm_e=$5, td_utm_n=$6,
                               td_land_no=$7, td_rawang=$8, td_verdict='match', td_status='resolved_via_td',
                               td_checked_at=now(), geo_precision='parcel', geo_status='verified',
                               dol_verdict='match', geo_note=$9,
                               geom=ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
              WHERE id=$1`,
            [p.id, lat, lon, row.utmSrid, row.utmEasting, row.utmNorthing,
             cand.LAND_NO ?? null, row.rawang ?? null, detail]);
    }

    tally.match = (tally.match ?? 0) + 1;
    line(`  ${String(p.id).padStart(5)} ${String(p.deed_number).padEnd(8)} ${String(p.district_name).padEnd(14)} ${String(p.tumbol ?? "-").padEnd(12)} -> placed  ${cand.LAND_AREA} (${areaToSqWa(cand.LAND_AREA)} ตร.ว.) vs LED ${ledSqWa}  land_no ${cand.LAND_NO}  srid ${row.utmSrid}`);
    if ((i + 1) % 20 === 0) line(`  ...${i + 1}/${todo.length}`);
}

line(`\n  ${JSON.stringify(tally)}`);
if (!WRITE) line("  DRY RUN - nothing written. Re-run with --write.");
await lookup.close();
await db.end();
