/* resolveTdParcels.js - resolve LED deed numbers to TD parcels.
 *
 * TD is addressed by deed number plus province, and its province code is not
 * always LED's: บึงกาฬ is 97 on LED and 38 on TD, ปราจีนบุรี's สระแก้ว districts
 * are 25 on LED and 27 on TD. districts.td_province_code carries that mapping,
 * written by applyLedTdMap.js from the researched map. This script never
 * re-derives it and never matches names.
 *
 * Two things this deliberately does NOT do:
 *
 * - It never reads DOL_SHAPE. That field is the land office pin, and it came
 *   back byte-identical (98.397726, 7.887292) for every Phuket deed checked.
 *   Using it would stack a whole province on one dot in the sea.
 * - It never groups by deed number. TD resolves a deed to a LAND parcel, and
 *   two rooms in one condo share it - ผบ.778/2565 and ผบE.1941/2566 are both
 *   rooms 8/26 and 8/105 on deed 100683 and both return OBJECTID 55789310. The
 *   rooms are assets on sale (auction_lots.order_label), not places, and the map
 *   wants one marker for the building.
 *
 * td_object_id carries UNIQUE, so re-running is safe: a parcel already holding
 * the same OBJECTID is skipped.
 *
 *   DATABASE_URL=... bun resolveTdParcels.js                    # dry run
 *   DATABASE_URL=... bun resolveTdParcels.js --write            # commit
 *   DATABASE_URL=... bun resolveTdParcels.js --province=97      # one province
 *   DATABASE_URL=... bun resolveTdParcels.js --limit=50 --write # small batch
 */
import pg from "pg";

const EP =
    "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?" +
    "https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?";

const HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://assessprice.treasury.go.th",
    Referer: "https://assessprice.treasury.go.th/",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

const DELAY_MS = Number(process.env.TD_RESOLVE_DELAY_MS ?? 400);
const WRITE = process.argv.includes("--write");
const arg = (k, d = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : d;
};
const LIMIT = Number(arg("limit", 0)) || 0;
const ONLY_PROV = arg("province");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inverse WGS84 / UTM zone 47N, which is what TD reports as SRID 24047.
 * Verified against live Phuket results: TD's SHAPE POINT (430452.96 870052.40)
 * lands at 7.870667, 98.369107.
 */
function utmToLatLng(easting, northing, zone = 47) {
    const a = 6378137;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e2 = f * (2 - f);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M = northing / k0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
    const phi1 =
        mu +
        ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
        ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
        ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
        ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const ep2 = e2 / (1 - e2);
    const C1 = ep2 * Math.cos(phi1) ** 2;
    const T1 = Math.tan(phi1) ** 2;
    const Nn = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
    const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
    const D = (easting - 500000) / (Nn * k0);
    const lat =
        phi1 -
        (Nn * Math.tan(phi1)) / R1 *
            (D ** 2 / 2 -
                ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
                ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
    const lon =
        (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 +
            ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) /
        Math.cos(phi1);
    return [lat * 180 / Math.PI, (zone * 6 - 183) + lon * 180 / Math.PI];
}

const parseShape = (shape) => {
    const m = /POINT\s*\(\s*([-\d.]+)[\s,]+([-\d.]+)/i.exec(String(shape ?? ""));
    return m ? [Number(m[1]), Number(m[2])] : null;
};

/* ------------------------------------------------------------ DOL fallback
 *
 * TD does not carry every parcel. Anything it does not return, or returns
 * outside the district LED named, goes to LandsMaps (กรมการถือกรรมที่ดิน).
 *
 * DOL numbers provinces like TD, not LED: Bueng Kan is 97 on LED and 38 on both
 * TD and DOL. districts.td_province_code therefore serves both without change.
 * DOL also wants the 2-digit district, which is districts.td_code.
 *
 * The route is /{prov}/{amphur}/{parcelno} - three segments. The research note
 * documents two and 404s.
 *
 * DOL allows 20 lookups per day, server side, and returns
 *   {"status":500,"message":"เกินจำกัด 20 /วัน"}
 * The quota is per day, not per token: minting a fresh JWT does not reset it.
 * The research bundle asserts there is no quota; the live service disagrees, so
 * dol_quota_ledger stays authoritative and this leg is rate-limited to match.
 */
const DOL = "https://landsmaps.dol.go.th/apiService";
const DOL_DAILY_LIMIT = Number(process.env.DOL_DAILY_LIMIT ?? 20);

let dolToken = null;
async function dolHeaders() {
    if (!dolToken) {
        const r = await fetch(`${DOL}/JWT/GetJWTAccessToken`, { headers: { Accept: "application/json" } });
        dolToken = (await r.json())?.result?.[0]?.access_token ?? null;
        if (!dolToken) throw new Error("could not mint anonymous DOL token");
    }
    return { Authorization: `Bearer ${dolToken}`, Accept: "application/json" };
}

const dolStats = { tried: 0, resolved: 0, quota: 0, none: 0, error: 0, blocked: false };

async function dolLookup(tdProv, tdAmphur, parcelNo) {
    if (dolStats.tried >= DOL_DAILY_LIMIT) { dolStats.blocked = true; return null; }
    dolStats.tried++;
    try {
        const r = await fetch(`${DOL}/LandsMaps/GetParcelByParcelNo/${tdProv}/${tdAmphur}/${parcelNo}`, {
            headers: await dolHeaders(),
        });
        const j = await r.json();
        if (j?.status === 500 && /เกินจำกัด/.test(String(j.message ?? ""))) {
            dolStats.quota++;
            dolStats.blocked = true;
            return null;
        }
        const rows = Array.isArray(j?.result) ? j.result : [];
        if (!rows.length) { dolStats.none++; return null; }
        dolStats.resolved++;
        return rows[0];
    } catch (e) {
        dolStats.error++;
        return null;
    }
}

async function query(prov, deed, survey = "", tries = 3) {
    const body = new URLSearchParams({
        SP: "GIS5_Q_PARCEL",
        PERIODS: "7",
        CHANOD_NO: String(deed),
        SURVEY_NO: survey ?? "",
        PARCEL_TYPE: "CHANOD_NO",
        PROV_DESCR: prov.name,
        PROV_CODE: String(prov.td_province_code),
        PARCEL_LAYER: "PARCEL",
        LANGUAGE: "TH",
        USER_ID: "2",
        BEGIN: "1",
        END: "20",
        VISITOR_UUID: "0123456789abcdef0123456789abcdef",
        FLAG_DVALUE: "1",
    });
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            const r = await fetch(EP, { method: "POST", headers: HEADERS, body });
            const j = await r.json();
            if (Array.isArray(j.data)) return j.data;
            throw new Error(`no data (success=${j.success} ${j.message ?? ""})`);
        } catch (e) {
            if (attempt === tries) return { error: e.message };
            await sleep(1200 * attempt);
        }
    }
    return [];
}

const client = new pg.Client({
    connectionString:
        process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap",
});
await client.connect();

const where = ["d.td_code IS NOT NULL", "p.deed_number IS NOT NULL", "p.deed_number <> ''"];
const params = [];
if (ONLY_PROV) { params.push(Number(ONLY_PROV)); where.push(`d.province_id = $${params.length}`); }

const sql = `
  SELECT p.id AS parcel_id, p.deed_number, p.tumbol, p.province_name,
         d.code AS led_district, d.name AS district_name, d.td_code,
         pr.name AS prov_name, pr.dol_code AS prov_dol,
         d.td_province_code, p.td_object_id
    FROM parcels p
    JOIN districts d ON d.id = (SELECT id FROM districts dd
                                 WHERE dd.province_id = p.province_code
                                   AND dd.dol_code = p.district_dol_code LIMIT 1)
    JOIN provinces pr ON pr.code = d.province_id
   WHERE ${where.join(" AND ")}
   ORDER BY d.province_id, d.td_code, p.deed_number`;

let todo = (await client.query(sql, params)).rows;
if (LIMIT) todo = todo.slice(0, LIMIT);

const stats = { found: 0, noResult: 0, shared: 0, error: 0, noShape: 0, multiCandidate: 0, ambiguous: 0, districtMismatch: 0, districtUnverified: 0 };
const ambiguous = [];
const districtMismatch = [];
const t0 = Date.now();

console.log(`  [cfg] ${todo.length} parcels, ${WRITE ? "WRITE" : "dry run"}, ${DELAY_MS}ms delay`);
if (!todo.length) { console.log("  nothing to do"); await client.end(); process.exit(0); }

const seenObjectId = new Set();
for (const [i, p] of todo.entries()) {
    const rows = await query(
        { name: p.prov_name, td_province_code: p.td_province_code },
        p.deed_number,
        p.td_land_no_hint ?? "",
    );

    if (!Array.isArray(rows)) { stats.error++; continue; }
    if (!rows.length) { stats.noResult++; await sleep(DELAY_MS); continue; }

    /* TD does not filter by district: AMPH_CODE is not a recognised parameter
     * (it returns total=0) and AMPHUR_CODE is accepted but ignored. A bare
     * CHANOD_NO therefore returns every parcel in the province carrying that
     * deed number - deed 12329 in บึงกาฬ returns three, of which only one is in
     * เมืองบึงกาฬ. Taking rows[0] picks the wrong one, silently, and it looks
     * like a clean resolution.
     *
     * So pick here, against the district LED and our map already resolved. Only
     * fall back to a lone candidate; anything else is a genuine ambiguity and is
     * reported rather than guessed. */
    const want = String(p.district_name ?? "").trim();
    const byDistrict = want
        ? rows.filter((r) => String(r.AMPHUR_NAME ?? "").trim() === want)
        : [];
    let r = null;
  let verdict = null;
    let via = "td";
    if (byDistrict.length === 1) { stats.found++; r = byDistrict[0]; verdict = "match"; }
    else if (byDistrict.length > 1) { stats.ambiguous++; ambiguous.push({ deed: p.deed_number, n: byDistrict.length, dist: want }); await sleep(DELAY_MS); continue; }
    else if (rows.length === 1) {
    /* One row, but not in the district our map resolved. Accepting it would put a
     * marker on the wrong district, so it is recorded as a mismatch instead. */
    stats.found++; stats.districtUnverified++; r = rows[0]; verdict = "district_mismatch";
  }
    else {
        /* TD could not place this one. Fall through to DOL. */
        const d = await dolLookup(p.td_province_code, p.td_code, p.deed_number);
        if (d) {
            via = "dol";
            stats.found++;
            console.log(`    ${String(i + 1).padStart(4)}/${todo.length}  ${p.prov_name}/${p.district_name}  deed ${String(p.deed_number).padEnd(10)} DOL fallback -> amphur ${d.amphurid ?? "?"} tambol ${d.tambol_id ?? "?"}`);
            if (WRITE) {
                await client.query(
                    `UPDATE parcels
                        SET td_office     = COALESCE($2, td_office),
                            td_eva_price  = COALESCE($3, td_eva_price),
                            td_status     = 'resolved_via_dol',
                            td_checked_at = now()
                      WHERE id = $1`,
                    [p.parcel_id, d.landoffice_id ?? null, Number(d.landprice) || null],
                );
            }
            await sleep(DELAY_MS);
            continue;
        }
        stats.districtMismatch++;
        districtMismatch.push({ deed: p.deed_number, want, got: rows.map((x) => x.AMPHUR_NAME) });
        await sleep(DELAY_MS);
        continue;
    }

    if (rows.length > 1) stats.multiCandidate++;

    const objId = r.OBJECTID != null ? Number(r.OBJECTID) : null;
    const pt = parseShape(r.SHAPE);
    let lat = null, lng = null, utmE = null, utmN = null;
    if (pt) {
        utmE = pt[0]; utmN = pt[1];
        [lat, lng] = utmToLatLng(pt[0], pt[1]);
    } else stats.noShape++;

    if (objId != null) {
        if (seenObjectId.has(objId)) stats.shared++;
        seenObjectId.add(objId);
    }

    const mismatched =
        p.tumbol && r.TUMBON_NAME && p.tumbol.trim() !== String(r.TUMBON_NAME).trim();

    if (mismatched) {
        console.log(`  ! tambon mismatch: deed ${p.deed_number} ${p.district_name} LED "${p.tumbol}" vs TD "${r.TUMBON_NAME}"`);
    }
    console.log(
        `    ${String(i + 1).padStart(4)}/${todo.length}  ${p.prov_name}/${p.district_name}  deed ${String(p.deed_number).padEnd(10)}` +
        ` obj=${objId}  ${r.RAWANG ?? ""}  ${Number.isFinite(lat) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "no shape"}`,
    );

    if (WRITE) {
        await client.query(
            `UPDATE parcels
                SET td_object_id = COALESCE($2, td_object_id),
                    td_rawang     = COALESCE($3, td_rawang),
                    td_land_no    = COALESCE($4, td_land_no),
                    td_survey_no  = COALESCE($5, td_survey_no),
                    td_office     = COALESCE($6, td_office),
                    td_eva_price  = COALESCE($7, td_eva_price),
                    td_utm_e      = COALESCE($8, td_utm_e),
                    td_utm_n      = COALESCE($9, td_utm_n),
                    td_srid       = COALESCE($10, td_srid),
                    td_lat        = COALESCE($11, td_lat),
                    td_lon        = COALESCE($12, td_lon),
                    td_status     = $13,
                    td_checked_at = now()
              WHERE id = $1`,
            [p.parcel_id, objId, r.RAWANG ?? null, r.LAND_NO ?? null, r.SURVEY_NO ?? null,
             r.DOL_NAME ?? null, Number(String(r.CURR_EVAPRICE ?? "").replace(/,/g, "")) || null,
             utmE, utmN, r.SRID ?? null, lat, lng, `resolved_via_${via}`, verdict],
        );
    }
    await sleep(DELAY_MS);
}

const el = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n  resolved       ${stats.found}`);
console.log(`  no TD result   ${stats.noResult}`);
console.log(`  errors         ${stats.error}`);
console.log(`  shared OBJECTID (rooms in one building) ${stats.shared}`);
console.log(`  multiple candidates, disambiguated by district ${stats.multiCandidate}`);
console.log(`  lone candidate, district not verified        ${stats.districtUnverified}`);
console.log(`  AMBIGUOUS: >1 candidate in the right district ${stats.ambiguous}`);
console.log(`  NO MATCH in any candidate's district          ${stats.districtMismatch}`);
console.log(`\n  DOL fallback: tried ${dolStats.tried} (limit ${DOL_DAILY_LIMIT}/day), resolved ${dolStats.resolved}, none ${dolStats.none}, quota-stopped ${dolStats.quota}, errors ${dolStats.error}`);
if (dolStats.blocked) console.log("  DOL quota exhausted - remaining failures stay unresolved until the daily limit resets");
console.log(`  no SHAPE (no coordinates) ${stats.noShape}`);
console.log(`  tambon mismatches logged above`);
console.log(`  elapsed        ${el}s`);
if (ambiguous.length) {
    console.log(`\n  deeds returning more than one parcel (${ambiguous.length}):`);
    for (const a of ambiguous.slice(0, 10)) console.log(`    deed ${a.deed} -> ${a.n} rows, ${a.dist}`);
}
if (!WRITE) console.log("\n  DRY RUN - nothing written. Re-run with --write.");

/* Persist the outcome so the admin pane can see what the bot did.
 * scrape_runs already has the columns - stage, province_code, lots_seen,
 * lots_new, error_count, notes, detail - and /api/status already serves them;
 * the scrapers write rows there and the resolvers only printed to stdout, so
 * from the frontend a resolve looked identical to nothing happening. */
if (WRITE) {
    await client.query(
        `INSERT INTO scrape_runs
            (stage, province_code, started_at, finished_at,
             lots_seen, lots_new, error_count, notes, detail, last_step)
         VALUES ('enrich_td', $1, $2, now(), $3, $4, $5, $6, $7::jsonb, $8)`,
        [Number(ONLY_PROV) || null, new Date(t0).toISOString(),
         stats.found + stats.noResult + stats.districtMismatch + stats.ambiguous + stats.error,
         stats.found, stats.error,
         `${dolStats.tried} DOL tried, ${dolStats.resolved} resolved, ${dolStats.quota} quota-stopped`,
         JSON.stringify({ ...stats, dol: dolStats }),
         dolStats.blocked ? "DOL quota exhausted; rest wait for tomorrow" : "done"],
    );
}

await client.end();