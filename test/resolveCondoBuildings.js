/* resolveCondoBuildings.js — place a condominium whose deed list names several.
 *
 *   DATABASE_URL=... bun resolveCondoBuildings.js            # dry run
 *   DATABASE_URL=... bun resolveCondoBuildings.js --write
 *
 * LED sells a condominium as one auction. Its row names every โฉนด that touches
 * the unit - the building's, the land's, the unit's - and they all share one
 * plot number, because they are one unit. So the row's deed field holds a list:
 *
 *   32480, 32481, 54126, 57484, 88772
 *
 * The lot keeps that list, and the resolver works from it rather than from one
 * number. TD holds only some of them: for that Phuket building it holds 57484
 * and 88772 and not the other three, and the three it does not hold are unit
 * deeds of the same room.
 *
 * Which of them is the building? The one with the land's area. The unit's own
 * deed carries the room's floor area - 37.3 square metres against the
 * building's 858 square wah - and the building's carries the land. The largest
 * is the building, and every one of the unit's deeds points at it.
 *
 * The area test is not applied here, and deliberately so. LED publishes a
 * ห้องชุด's floor area and the cadastre publishes the land under the building,
 * so the two never agree: deed 44021 is 30.35 square metres in LED and
 * 3-0-15.50, some 1,215 square wah, in the cadastre. Here the area is the way
 * to tell the building from the room, not a test to pass.
 */
import { Client } from "pg";
import { createResilientLookup, normaliseTdRow } from "./tdLookup.js";
import { officialArea } from "./tdCadastre.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";

const WRITE = process.argv.includes("--write");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

const { rows: todo } = await db.query(`
  SELECT l.id AS lot_id, l.parcel_id, l.deed_number AS lot_deeds, l.case_no, l.case_year,
         l.order_number, l.order_sub, p.deed_number AS parcel_deed, p.tumbol, p.district_name,
         p.province_name, d.td_province_code, d.td_code
    FROM auction_lots l
    JOIN parcels p ON p.id = l.parcel_id
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
   WHERE l.asset_type = 'ห้องชุด'
     AND l.deed_number ~ ','
     AND p.td_lat IS NULL AND p.dol_lat IS NULL
   ORDER BY l.id`);

line(`  ${todo.length} ห้องชุด auction(s) naming several deeds, ${WRITE ? "WRITE" : "dry run"}`);
if (!todo.length) { await db.end(); process.exit(0); }

const lookup = await createResilientLookup({ delayMs: 400, log: () => {} });
const tally = {};

for (const [i, t] of todo.entries()) {
    const numbers = t.lot_deeds.split(",").map((n) => n.trim()).filter(Boolean);
    const prov = String(t.td_province_code).padStart(2, "0");

    /* Ask TD about each of them. The session is per province, so set it. */
    const cands = [];
    for (const n of numbers) {
        lookup.setProvince(prov);
        const res = await lookup({ deed_number: n, province_code: t.td_province_code });
        /* The lookup already normalises the rows it returns. Normalising them
         * again reads fields that are not there and leaves every one of them
         * null - a district of nothing, a shape of nothing. */
        for (const r of (res.rows ?? [])) {
            /* Only the district LED named. A deed number is not unique, and a
             * row in another district is a different piece of land. */
            if (String(r.amphurName ?? "").trim() !== String(t.district_name ?? "").trim()) continue;
            const cad = await officialArea({
                chanod: n, provinceCode: prov,
                amphurName: r.amphurName, tumbonName: r.tambonName,
            });
            cands.push({ n, r, sqWa: cad.sqWa, area: cad.area });
        }
    }

    if (!cands.length) {
        const v = "no_result";
        tally[v] = (tally[v] ?? 0) + 1;
        line(`  ${String(t.lot_id).padStart(6)} ${t.case_no}/${t.case_year} ${t.order_number}-${t.order_sub}  ${t.district_name}/${t.tumbol}  -> no_result: TD holds none of ${numbers.length} deeds in ${t.district_name}`);
        if (WRITE) {
            await db.query(
                `UPDATE parcels SET dol_verdict=$2, geo_note=$3, td_checked_at=now() WHERE id=$1`,
                [t.parcel_id, v,
                 `TD holds none of the ${numbers.length} deeds LED names for this ห้องชุด (${t.lot_deeds}) in ${t.district_name}`]);
        }
        continue;
    }

    /* The building is the one with the land's area. */
    cands.sort((a, b) => (b.sqWa ?? 0) - (a.sqWa ?? 0));
    const best = cands[0];

    if (best.r.utmEasting == null) {
        const v = "no_shape";
        tally[v] = (tally[v] ?? 0) + 1;
        line(`  ${String(t.lot_id).padStart(6)} ${t.case_no}/${t.case_year}  -> no_shape`);
        if (WRITE) {
            await db.query(
                `UPDATE parcels SET dol_verdict=$2, geo_note=$3, td_checked_at=now() WHERE id=$1`,
                [t.parcel_id, v, `TD holds ${best.n} for this ห้องชุด but gave no SHAPE`]);
        }
        continue;
    }

    const cal = await loadCalibration(db, { srid: best.r.utmSrid });
    const tf = calibratedTransform(cal, `ST_MakePoint($1::double precision, $2::double precision)`);
    const { rows: pt } = await db.query(
        `SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`,
        [best.r.utmEasting, best.r.utmNorthing]);
    const lat = Number(pt[0].lat), lon = Number(pt[0].lon);

    const detail = `placed on the building: LED names ${numbers.length} deeds for this ห้องชุด (${t.lot_deeds}); ` +
        `TD holds ${cands.length} of them and ${best.n} has the land's area, ${best.area} (${best.sqWa} ตร.ว.)`;

    tally.match = (tally.match ?? 0) + 1;
    line(`  ${String(t.lot_id).padStart(6)} ${t.case_no}/${t.case_year} ${t.order_number}-${t.order_sub}  ${t.district_name}/${t.tumbol}  -> placed on ${best.n}  ${best.area} (${best.sqWa} ตร.ว.)  ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

    if (WRITE) {
        await db.query(
            `UPDATE parcels SET td_lat=$2, td_lon=$3, td_srid=$4, td_utm_e=$5, td_utm_n=$6,
                               td_land_no=$7, td_rawang=$8, td_verdict='match', td_status='resolved_via_td',
                               td_checked_at=now(), geo_precision='parcel', geo_status='verified',
                               dol_verdict='match', geo_note=$9,
                               geom=ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
              WHERE id=$1`,
            [t.parcel_id, lat, lon, best.r.utmSrid, best.r.utmEasting, best.r.utmNorthing,
             best.r.landNo ?? null, best.r.rawang ?? null, detail]);
    }
    if ((i + 1) % 10 === 0) line(`  ...${i + 1}/${todo.length}`);
}

line(`\n  ${JSON.stringify(tally)}`);
if (!WRITE) line("  DRY RUN - nothing written. Re-run with --write.");
await lookup.close();
await db.end();
