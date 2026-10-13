/* Store the raw UTM pair for every TD-enriched parcel, then apply the datum
 * calibration using a MEDIAN rather than a mean — one parcel (35089) sits ~12 m
 * off the rest, which drags a mean but barely moves a median. Robustness
 * matters here because this correction is applied to the whole national set. */
import pg from "pg";
import { createTdLookup } from "./tdLookup.js";

const TRUTH = {
    "32880": [16.42274720, 102.83357846], "256592": [16.45198528, 102.83737089],
    "79626": [16.39314045, 102.82443020], "79625": [16.39307974, 102.82443189],
    "130935": [16.50219634, 102.82899916], "81864": [16.40263201, 102.86235993],
    "40": [16.12713873, 102.53867803], "72928": [16.42237805, 102.80137869],
    "72927": [16.42251643, 102.80143629], "39486": [16.48915792, 102.82765427],
    "173559": [16.49754268, 102.86273200], "66383": [16.71934171, 102.81768469],
    "35089": [16.68805495, 103.13536974], "11093": [16.26741841, 102.71330087],
};
const SRID = 24048, M_LAT = 111320, M_LON = 103000;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS td_utm_e double precision,
    ADD COLUMN IF NOT EXISTS td_utm_n double precision,
    ADD COLUMN IF NOT EXISTS td_utm_srid integer`);

// ---- 1. backfill the UTM pair for every TD-enriched parcel ---------------
const { rows: need } = await client.query(
    `SELECT id, deed_number, tumbol, district_name FROM parcels
      WHERE td_checked_at IS NOT NULL AND td_utm_e IS NULL`);

const lookup = await createTdLookup({ delayMs: 500, log: () => {} });
let filled = 0;
for (const p of need) {
    const res = await lookup({ deed_number: p.deed_number, province_code: 40 });
    if (!res.found) continue;
    const row = res.rows.find((x) => x.tambonName === p.tumbol);
    if (!row) continue;
    await client.query(
        `UPDATE parcels SET td_utm_e=$2, td_utm_n=$3, td_utm_srid=$4 WHERE id=$1`,
        [p.id, row.utmEasting, row.utmNorthing, row.utmSrid]);
    filled++;
}
console.log(`UTM stored for ${filled} further parcel(s)`);

// ---- 2. median calibration ----------------------------------------------
const { rows: raw } = await client.query(
    `SELECT deed_number,
            ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) AS lat,
            ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) AS lon
       FROM parcels WHERE td_utm_e IS NOT NULL`, [SRID]);

const dLat = [], dLon = [];
for (const r of raw) {
    const t = TRUTH[r.deed_number];
    if (!t) continue;
    dLat.push(t[0] - Number(r.lat));
    dLon.push(t[1] - Number(r.lon));
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const cLat = median(dLat), cLon = median(dLon);

console.log(`\nmedian correction: lat ${(cLat * M_LAT).toFixed(1)} m, lon ${(cLon * M_LON).toFixed(1)} m`);

// ---- 3. apply everywhere, recomputing from UTM (idempotent) --------------
const { rowCount } = await client.query(
    `UPDATE parcels SET
        td_lat = ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) + $2,
        td_lon = ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) + $3,
        geom  = ST_SetSRID(ST_MakePoint(
                   ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) + $3,
                   ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(td_utm_e, td_utm_n), $1), 4326)) + $2), 4326)::geography
      WHERE td_utm_e IS NOT NULL`, [SRID, cLat, cLon]);
console.log(`recomputed ${rowCount} parcel(s)`);

// ---- 4. verify -------------------------------------------------------------
const { rows: after } = await client.query(
    `SELECT deed_number, td_lat, td_lon FROM parcels
      WHERE deed_number = ANY($1) AND td_lat IS NOT NULL`, [Object.keys(TRUTH)]);
const errs = after.map((r) => {
    const t = TRUTH[r.deed_number];
    return Math.hypot((Number(r.td_lat) - t[0]) * M_LAT, (Number(r.td_lon) - t[1]) * M_LON);
}).sort((a, b) => a - b);
console.log(`\nresidual vs กรมที่ดิน: min ${errs[0].toFixed(1)}m  ` +
    `median ${errs[Math.floor(errs.length / 2)].toFixed(1)}m  max ${errs[errs.length - 1].toFixed(1)}m`);

lookup.close();
await client.end();
