/* tdEnrich.js — attach กรมธนารักย์ coordinates and per-parcel ราคาประเมิน
 * to LED parcels, selecting the right parcel when a deed number is ambiguous.
 *
 * Writes only what TD is authoritative for: the map point and บาท/ตร.วา.
 * LED's own selling price is never touched.
 *
 *   DATABASE_URL=... bun tdEnrich.js [provinceCode] [limit]
 */
import pg from "pg";
import { createTdLookup, pickTdRow, layerForTitle } from "./tdLookup.js";
import { calibratedTransform, loadCalibration } from "./tdCrs.js";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

const province = process.argv[2] ? Number(process.argv[2]) : null;
const limit = Number(process.argv[3] || 500);

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
    INSERT INTO data_sources (key, name, agency, url, license, quota_per_day, notes) VALUES
    ('td_assessprice', 'ระบบค้นหาราคาประเมิน (assessprice)', 'กรมธนารักย์',
     'https://assessprice.treasury.go.th/', NULL, NULL,
     'Per-parcel ราคาประเมิน + coordinates. Shared with กรมที่ดิน. Returns every parcel sharing a deed number, so rows are selected by location.')
    ON CONFLICT (key) DO UPDATE SET notes = EXCLUDED.notes`);

/* Every parcel, not only unenriched ones, so title dispatch is decided from
 * LED's own land_title rather than guessed from what happened to work.
 *
 * Already-decided parcels are excluded: a น.ส.3ก. is not retried forever, and a
 * parcel that already has coordinates is not fetched again. */
const { rows: targets } = await client.query(
    `SELECT p.id, p.deed_number, p.province_code, p.tumbol, p.district_name,
            p.land_title, p.td_checked_at, l.asset_type
       FROM parcels p
       JOIN LATERAL (SELECT asset_type FROM auction_lots
                       WHERE parcel_id = p.id ORDER BY id LIMIT 1) l ON true
      WHERE ($1::int IS NULL OR p.province_code = $1)
        AND (p.td_status IS NULL OR p.td_status NOT LIKE 'skipped:%')
        AND (p.td_checked_at IS NULL
             OR EXISTS (SELECT 1 FROM field_provenance f
                         WHERE f.entity_type='parcel' AND f.entity_id=p.id
                           AND f.source_key='td_assessprice' AND f.field_name='td_eva_price'))
      ORDER BY p.id
      LIMIT $2`,
    [province, limit],
);
console.log(`targets: ${targets.length}`);

const lookup = await createTdLookup({
    delayMs: Number(process.env.TD_DELAY_MS || 700),
    log: (m) => console.log(`  ${m}`),
});

const stats = {
    matched: 0, notFound: 0, ambiguous: 0, noLocation: 0, error: 0,
    skippedByDesign: 0,
};

for (const t of targets) {
    /* Route by land title.
     *
     * น.ส.3ก. and ห้องชุด are SKIPPED by design, not blocked. TD's โฉนด layer
     * does not carry them — verified: searching 2771 returns 21-23 unrelated
     * โฉนด parcels and never the น.ส.3ก. one, so a match would be confidently
     * wrong. Forcing them through would attach another ตำบล's coordinates.
     *
     * The LED record is kept intact either way; only the enrichment is
     * skipped, and geo_precision stays 'subdistrict'. One decision, not
     * retried on every run. */
    const route = layerForTitle(t.land_title, t.asset_type);
    if (!route.supported) {
        stats.skippedByDesign++;
        await client.query(
            `UPDATE parcels
                SET td_status = $2,
                    geo_precision = COALESCE(geo_precision, 'subdistrict')
              WHERE id = $1`,
            [t.id, `skipped: ${route.layer} not on TD's โฉนด layer (${t.land_title})`]);
        continue;
    }
    if (t.td_checked_at !== null && t.td_eva_price !== null) continue;   // done

    let res;
    try {
        res = await lookup({ deed_number: t.deed_number, province_code: t.province_code });
    } catch (e) {
        stats.error++;
        console.log(`  ${t.deed_number} ERROR ${e.message}`);
        continue;
    }

    if (!res.found) {
        stats.notFound++;
        await client.query(
            `UPDATE parcels SET td_status='unresolved: TD returned nothing'
              WHERE id=$1 AND td_status IS NULL`, [t.id]);
        continue;
    }

    const pick = pickTdRow(res.rows, { tumbol: t.tumbol, amphur: t.district_name });
    if (!pick.row) {
        stats[pick.status === "ambiguous" ? "ambiguous" : "noLocation"]++;
        /* Searched the correct layer and the parcel is genuinely not there.
           Recorded so the gap stays visible instead of looking like an oversight —
           NOT marked 'skipped:', because it is a real miss we would retry if TD
           later gains the record. */
        await client.query(
            `UPDATE parcels SET td_status=$2 WHERE id=$1 AND td_status IS NULL`,
            [t.id, `unresolved: ${pick.status} (${res.rows.length} rows, want ${t.tumbol})`]);
        console.log(`  ${t.deed_number} ${pick.status} (${res.rows.length} rows, want ${t.tumbol}/${t.district_name})`);
        continue;
    }

    const r = pick.row;
    /* Datum correction from crs_calibration (migration 010). This MUST happen
       on every write, not once by a repair script: writing raw ST_Transform here
       would place new parcels ~183 m off and quietly undo the correction the
       existing rows already carry. */
    const cal = await loadCalibration(client, { srid: r.utmSrid });
    const pt = `ST_MakePoint($7::double precision, $8::double precision)`;
    const tf = calibratedTransform(cal, pt);
    if (!tf.calibrated) {
        console.warn(`  ! no crs_calibration row for srid ${r.utmSrid} — writing UNCORRECTED coordinates`);
    }

    const { rows: [upd] } = await client.query(
        `UPDATE parcels p SET
            td_eva_price = $2,
            td_land_no   = $3,
            td_rawang    = $4,
            td_survey_no = $5,
            td_office    = $6,
            td_utm_e     = $7,
            td_utm_n     = $8,
            td_utm_srid  = $9,
            td_lat = CASE WHEN $7::double precision IS NULL THEN p.td_lat
                          ELSE ${tf.latExpr} END,
            td_lon = CASE WHEN $7::double precision IS NULL THEN p.td_lon
                          ELSE ${tf.lonExpr} END,
            td_checked_at = now(),
            geom = CASE WHEN p.geo_precision = 'parcel' THEN p.geom
                        WHEN $7::double precision IS NOT NULL
                        THEN (${tf.geomExpr})::geography
                        ELSE p.geom END,
            geo_precision = CASE WHEN $7::double precision IS NOT NULL THEN 'parcel'
                                 ELSE p.geo_precision END
          WHERE p.id = $1
        RETURNING td_lat, td_lon`,
        [t.id, r.evaPrice, r.landNo, r.rawang, r.surveyNo, r.landOffice,
         r.utmEasting, r.utmNorthing, r.utmSrid],
    );

    for (const [f, v] of [
        ["td_eva_price", r.evaPrice], ["td_land_no", r.landNo],
        ["td_rawang", r.rawang], ["td_survey_no", r.surveyNo],
        ["td_lat", upd?.td_lat], ["td_lon", upd?.td_lon],
    ]) {
        if (v === null || v === undefined) continue;
        await client.query(
            `INSERT INTO field_provenance
               (entity_type, entity_id, field_name, source_key, observed_on, value_num, value_text)
             VALUES ('parcel',$1,$2,'td_assessprice',CURRENT_DATE,$3,$4)
             ON CONFLICT (entity_type, entity_id, field_name, source_key, observed_on)
             DO UPDATE SET value_num=EXCLUDED.value_num, value_text=EXCLUDED.value_text`,
            [t.id, f, typeof v === "number" ? v : null, typeof v === "string" ? v : null],
        );
    }

    stats.matched++;
    console.log(
        `  ${t.deed_number.padEnd(8)} ${String(t.tumbol).padEnd(14)} ` +
        `eva=${String(r.evaPrice).padEnd(9)} rawang=${String(r.rawang).padEnd(18)} ` +
        `lat=${upd?.td_lat?.toFixed(5) ?? "—"} lon=${upd?.td_lon?.toFixed(5) ?? "—"}`,
    );
}

console.log("\n=== TD enrichment ===");
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(12)} ${v}`);
await client.end();
