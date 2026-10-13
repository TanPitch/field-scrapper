/* tdCrs.js — apply the stored datum correction to กรมธนารักย์ coordinates.
 *
 *   node tdCrs.js            # print the calibration and its residuals
 *
 * assessprice serves SHAPE WKT in EPSG:24048. PostGIS's transformation of that
 * datum lands about 183 m from where กรมที่ดิน places the same parcel, in a
 * consistent direction, so a median offset fixes it — measured against 14
 * hand-verified points, see migration 010.
 *
 * This exists as a module rather than being inlined in the enrichment SQL
 * because of a specific near-miss: the dev database was corrected by a one-off
 * script, so tdEnrich.js still wrote UNcorrected coordinates. Any re-run would
 * have quietly undone the earlier correction for every parcel it touched.
 *
 * A database with no calibration row is not an error — it just means the
 * coordinates are uncorrected, and callers must say so rather than pretend.
 */
import pg from "pg";

const { Client } = pg;

/** Load the calibration for one source, preferring a province-specific row. */
export async function loadCalibration(client, { sourceKey = "td_assessprice", srid, provinceCode } = {}) {
    const { rows } = await client.query(
        `SELECT d_lat_m, d_lon_m, scope, basis_points, residual_max_m, notes
           FROM crs_calibration
          WHERE source_key = $1 AND ($2::int IS NULL OR srid = $2)
       ORDER BY (scope = $3) DESC NULLS LAST, basis_points DESC NULLS LAST
          LIMIT 1`,
        [sourceKey, srid ?? null, provinceCode != null ? String(provinceCode) : null]);
    return rows[0] ?? null;
}

/**
 * SQL expressions that apply the correction to a PostGIS geometry column.
 *
 * Longitude degrees shrink with latitude, so a metre shift in longitude is a
 * latitude-dependent number of degrees. Doing this properly is the whole reason
 * the offset is metres here and degrees only at the boundary.
 *
 * Returns the expressions unchanged when no calibration exists, and reports
 * `calibrated: false` so the caller can surface it.
 */
export function calibratedTransform(cal, geomExpr, extraOffsetM = 0) {
    const base = `ST_Transform(ST_SetSRID(${geomExpr}, ${cal?.srid ?? 24048}), 4326)`;
    if (!cal) return { latExpr: `ST_Y(${base})`, lonExpr: `ST_X(${base})`, calibrated: false, geomExpr: base };

    const dLat = cal.d_lat_m + extraOffsetM;
    const dLon = cal.d_lon_m + extraOffsetM;

    /* ST_YLatitude of the transformed point gives us the latitude at which to
       scale the longitude shift, so the metres stay metres. */
    const lat = `ST_Y(${base})`;
    const correctedLat = `(${lat} + ${dLat} / 111320.0)`;
    const correctedLon = `(ST_X(${base}) + ${dLon} / (111320.0 * greatest(cos(radians(${lat})), 0.01)))`;

    return {
        latExpr: correctedLat,
        lonExpr: correctedLon,
        calibrated: true,
        geomExpr: `ST_SetSRID(ST_MakePoint(${correctedLon}, ${correctedLat}), 4326)`,
    };
}

/* ---- CLI ------------------------------------------------------------------
 * Shows the calibration in force and how far the stored coordinates sit from it.
 *
 *   cd test; bun tdCrs.js
 */
if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is required");
        process.exit(1);
    }
    const client = new Client({ connectionString: url });
    await client.connect();

    const cal = await loadCalibration(client, { srid: 24048 });
    if (!cal) {
        console.error("no calibration row in crs_calibration — coordinates are uncorrected");
        console.error("run db/migrations/010_crs_calibration.sql");
        await client.end();
        process.exit(1);
    }

    console.log(`source        ${"td_assessprice"} EPSG:24048`);
    console.log(`scope         ${cal.scope ?? '(none)'}`);
    console.log(`offset        lat ${cal.d_lat_m} m, lon ${cal.d_lon_m} m`);
    console.log(`basis         ${cal.basis_points} verified points`);
    console.log(`max residual  ${cal.residual_max_m} m`);
    console.log(`note          ${cal.notes ?? ""}`);

    const { rows } = await client.query(`
        SELECT p.id, p.deed_number, p.td_utm_e, p.td_utm_n,
               p.td_lat, p.td_lon, ST_X(p.geom::geometry) AS gx, ST_Y(p.geom::geometry) AS gy
          FROM parcels p
         WHERE p.td_utm_e IS NOT NULL AND p.td_lat IS NOT NULL
      ORDER BY p.id`);

    /* How far is the stored coordinate from the uncalibrated transform? Anything
       near 0 means the row was never corrected. */
    let uncorrected = 0;
    for (const r of rows) {
        const { rows: [raw] } = await client.query(
            `SELECT ST_X(t)::double precision AS x, ST_Y(t)::double precision AS y
               FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2), 24048), 4326) AS t) q`,
            [r.td_utm_e, r.td_utm_n]);
        const d = Math.hypot((r.td_lon - raw.x) * 111320 * Math.cos((raw.y * Math.PI) / 180), (r.td_lat - raw.y) * 111320);
        if (d < 1) uncorrected++;
    }

    console.log(`\n${rows.length} parcel(s) with UTM source coordinates`);
    console.log(`${rows.length - uncorrected} carry the correction, ${uncorrected} do not`);
    if (uncorrected > 0) {
        console.log("run:  bun tdCrs.js --apply     (backfills td_lat / td_lon / geom)");
    }
    await client.end();
}
