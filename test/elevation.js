/* elevation.js — height above sea level per parcel, from AWS Terrain Tiles.
 *
 *   cd test; bun elevation.js            # fill what it can
 *   cd test; bun elevation.js --dry      # report only, write nothing
 *   cd test; bun elevation.js --z 15     # finer, ~4.6 m/px
 *
 * Source: Mapzen/AWS "terrarium" PNG tiles on the public elevation-tiles-prod
 * bucket. No key, no account, OGC-ish tiling that matches the web map, and the
 * tiles are already cached by every CDN in front of them.
 *
 * Terrarium encoding: metres = (R * 256 + G + B / 256) - 32768, which is what
 * lets a single PNG carry negative elevations (below sea level) as well as
 * positive ones.
 *
 * Resolution, because this drives the uncertainty column and the UI wording:
 *   z12 ~ 37 m/px   z14 ~ 9.2 m/px (default)   z15 ~ 4.6 m/px
 * A single pixel is sampled, so the error is roughly the DEM's own vertical
 * accuracy plus whatever the terrain does inside that pixel — not a survey.
 *
 * Only parcels whose coordinate is genuinely the parcel's are sampled. A
 * subdistrict centroid is a fallback for showing the map at all, and its
 * elevation says nothing about the land being auctioned, so those stay NULL.
 */
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { PNG } from "pngjs";
import { withRun } from "./runs.js";

const { Client } = pg;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const Z = Number(args[args.indexOf("--z") + 1]) || 14;
const DELAY_MS = Number(process.env.ELEV_TILE_DELAY_MS ?? 250);
const TILE_DIR = process.env.ELEV_TILE_DIR ?? "./data/elevation-tiles";

/* Ground resolution at this latitude, used only to state what we sampled. */
const metresPerPixel = (lat, z) =>
    156543.03392 * Math.cos((lat * Math.PI) / 180) / 2 ** z;

const tileOf = (lat, lon, z) => {
    const n = 2 ** z;
    const latRad = (lat * Math.PI) / 180;
    return {
        x: Math.floor(((lon + 180) / 360) * n),
        y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
        /* Fractional position inside the tile, 0..1. */
        fx: ((lon + 180) / 360) * n % 1,
        fy: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n % 1,
    };
};

const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Fetch one tile, cached on disk so repeated runs cost nothing and S3 is not
 *  hammered for the same Khon Kaen tiles over and over. */
async function tile(z, x, y) {
    const file = path.join(TILE_DIR, String(z), String(x), `${y}.png`);
    try {
        return await fs.readFile(file);
    } catch { /* not cached yet */ }

    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y} -> HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------- main */

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

const results = [];

const { rows: targets } = await client.query(`
    SELECT id, deed_number, province_code, tumbol,
           ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
      FROM parcels
     WHERE geo_precision = 'parcel'
       AND ST_Y(geom::geometry) IS NOT NULL
       AND ST_X(geom::geometry) IS NOT NULL
     ORDER BY id`);

const skipped = await client.query(`
    SELECT count(*)::int AS n FROM parcels
     WHERE geo_precision IS DISTINCT FROM 'parcel' OR geom IS NULL`);

/* Elevation is reference data, so it records itself as a 'reference' run and
 * shows on the same status page as the scrapers. */
await withRun(client, {
    stage: "reference",
    runKey: process.env.RUN_KEY ?? `elevation-z${Z}`,
    notes: `aws terrarium z${Z} (~${metresPerPixel(16, Z).toFixed(1)} m/px)`,
}, async (tick) => {
    console.log(`${targets.length} parcel(s) with a real coordinate, z=${Z} (~${metresPerPixel(16, Z).toFixed(1)} m/px)`);
    console.log(`${skipped.rows[0].n} parcel(s) skipped — no parcel-level point, so no height claimed`);
    if (DRY) console.log("(dry run: nothing written)");

    const cache = new Map();
    let fetched = 0;

    for (const [n, p] of targets.entries()) {
        const t = tileOf(p.lat, p.lon, Z);
        const key = `${Z}/${t.x}/${t.y}`;
        let buf = cache.get(key);
        if (!buf) {
            buf = await tile(Z, t.x, t.y);
            cache.set(key, buf);
            fetched++;
            await sleep(DELAY_MS);
        }

        const png = PNG.sync.read(buf);
        /* Clamp: a parcel exactly on a tile edge would otherwise read off-image. */
        const px = Math.min(255, Math.max(0, Math.floor(t.fx * 256)));
        const py = Math.min(255, Math.max(0, Math.floor(t.fy * 256)));
        const i = (py * png.width + px) * 4;

        const m = terrarium(png.data[i], png.data[i + 1], png.data[i + 2]);
        /* The per-pixel error of a 1-pixel sample at this zoom. Stated, not
         * hidden: the UI shows this beside the number so nobody reads it as
         * surveyed. */
        const uncertainty = Math.round(metresPerPixel(p.lat, Z) * 10) / 10;

        results.push({ ...p, elev: Math.round(m * 10) / 10, uncertainty, px, py, tile: key });

        if (!DRY) {
            await client.query(
                `UPDATE parcels
                    SET elevation_m = $2,
                        elevation_source = $3,
                        elevation_uncertainty_m = $4
                  WHERE id = $1`,
                [p.id, results.at(-1).elev, `aws-terrarium-z${Z}`, uncertainty]);
        }

        /* Progress every few parcels, so a national run is not a silent wait. */
        if ((n + 1) % 25 === 0 || n + 1 === targets.length) {
            await tick(`sampled ${n + 1}/${targets.length}`);
        }
    }

    const elevs = results.map((r) => r.elev).sort((a, b) => a - b);
    if (elevs.length) {
        console.log(`\nheight range ${elevs[0]} – ${elevs.at(-1)} m (median ${elevs[Math.floor(elevs.length / 2)]} m)`);
        console.log(`tiles fetched ${fetched}, distinct ${cache.size}`);
        console.log(`uncertainty ~${metresPerPixel(16, Z).toFixed(1)} m`);
    }

    return {
        parcels: targets.length,
        tilesFetched: fetched,
        tilesDistinct: cache.size,
        z: Z,
        metresPerPx: Math.round(metresPerPixel(16, Z) * 10) / 10,
        wrote: DRY ? 0 : results.length,
    };
});

await client.end();
console.log(DRY ? "\ndry run complete" : `\nwrote ${results.length} elevation value(s)`);
