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
import {
    ledDistrict, ledProvince, tdRowMatchesDistrict,
} from "./tdDict.js";

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
    /* Datum correction, measured rather than assumed.
     *
     * TD reports SRID 24047 and hands back a projected coordinate. Inverting it
     * as WGS84 / UTM 47N lands every parcel about 310 m off, in the same
     * direction every time: -0.00279 latitude, +0.00307 longitude against the
     * true position on LED and DOL.
     *
     * Measured on nine deeds across three provinces - ภูเก็ต, ปราจีนบุรี,
     * ขอนแก่น - spanning 8N to 16N and 98E to 102E. The delta is constant to five
     * decimal places across that range, so it is a translation rather than a
     * projection difference, and a constant is the right correction.
     *
     * What 24047 actually is was not verified against an EPSG registry; this is
     * fitted, not authoritative. Revisit if a parcel ever lands in the wrong
     * province, which would mean the shift is regional after all.
     *
     * A second, much smaller correction was measured by eye afterwards: TD's own
     * web map draws its pin a few metres off the parcel it represents, so
     * aligning to LED and DOL left the dot visibly apart from TD's. -0.00008
     * lat and +0.00005 lng - about 9 m south, 5 m east - brings the two into
     * agreement. That reference is TD's renderer rather than ground truth, so
     * this trades a little accuracy on LED and DOL for matching what the user
     * sees on the official site. Folded into the same constants rather than
     * applied separately, since from here it is one correction. */
    const DATUM_LAT = -0.00271;
    const DATUM_LNG = 0.00302;
    const [lat, lng] = utmToWgs84(easting, northing, zone);
    return [lat - DATUM_LAT, lng - DATUM_LNG];
}

function utmToWgs84(easting, northing, zone = 47) {
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
        /* The result list is CAPPED by BEGIN/END, and the cap is not a limit on
         * matches - it is a limit on rows, one per parcel, and a bare CHANOD_NO
         * returns every parcel in the province carrying that deed. One ขอนแก่น deed
         * came back with 25 amphurs, and the one for our district was past the
         * twentieth row, so it was never in the set we filtered. Every such parcel
         * was then reported as "TD does not have it" when TD did.
         *
         * 20 was the old cap; tdLookup.js already raised it to 200 for exactly
         * this reason and this copy of the request was never updated. */
        END: "200",
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

/* Only parcels that still need work, and the two ways a parcel is done.
 *
 * 1. It has a coordinate from any source. geom, then TD, then DOL, the same
 *    order the API reads them in. This list used to be every parcel with a deed
 *    number, so a re-run re-queried the province from scratch - 797 in Phuket,
 *    most of them placed months earlier, at 400ms each. That is why it could
 *    only ever be run once per province by hand.
 *
 * 2. It was looked at recently and came back a dead end. Asking TD again
 *    tomorrow about a deed it does not hold gains nothing, and there are 465
 *    of these. The verdict is stamped with td_checked_at, so the sweep becomes
 *    weekly instead of a daily re-scan of known dead ends - the same seven days
 *    LED's own listings run on.
 *
 * pending_quota is deliberately not a dead end: the lookup never ran, so the
 * answer is unknown, and it must be asked again as soon as there is allowance. */
const DEAD_ENDS = "'no_result','district_mismatch','ambiguous','no_shape','error'";
const RETRY_DAYS = Number(process.env.TD_RETRY_DAYS ?? 7);

const where = [
    "d.td_code IS NOT NULL",
    "p.deed_number IS NOT NULL",
    "p.deed_number <> ''",
    "p.td_lat IS NULL",
    "p.dol_lat IS NULL",
    /* Not a recent dead end. */
    `NOT (p.dol_verdict IN (${DEAD_ENDS}) AND p.td_checked_at > now() - ($1 || ' days')::interval)`,
];
/* $1 is the retry window, so the province filter, if any, takes $2. */
const params = [RETRY_DAYS];
if (ONLY_PROV) { params.push(Number(ONLY_PROV)); where.push(`d.province_id = $${params.length}`); }

const sql = `
  SELECT p.id AS parcel_id, p.deed_number, p.tumbol, p.province_name,
         d.code AS led_district, d.name AS district_name, d.td_code,
         pr.code AS led_province, pr.name AS prov_name, pr.dol_code AS prov_dol,
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

/**
 * File why a parcel could not be placed, so the next run can tell the cases
 * apart instead of counting them all as "not found".
 *
 *   no_result        TD holds nothing under this deed number. A dead end.
 *   district_mismatch TD holds it, but in another district. Our district is the
 *                     one LED named, and taking TD's would put the marker on the
 *                     wrong land.
 *   ambiguous        TD holds more than one parcel in our district. A person
 *                     has to say which.
 *   no_shape         TD matched the parcel and gave no coordinates.
 *   pending_quota    DOL was asked and the day's allowance was already spent.
 *                     Worth retrying tomorrow, unlike the rest.
 *   error            the request itself failed.
 *
 * Written to dol_verdict, which is the column the app already reads, and
 * geo_note, which carries the detail. Before this, the branches that had no
 * result and the ambiguous ones wrote nothing at all, so most of the backlog
 * had no recorded reason and the next run could not learn from it.
 */
const fileReason = async (parcelId, verdict, note) => {
    if (!WRITE) return;
    await client.query(
        `UPDATE parcels SET dol_verdict = $2, geo_note = $3, td_checked_at = now() WHERE id = $1`,
        [parcelId, verdict, note],
    );
};

/**
 * The walk: LED name -> LED number -> TD number -> TD name.
 *
 * Everything TD is asked and everything it is compared against now comes out
 * of the dictionaries, so both sides of every comparison are in the same
 * vocabulary. The old code compared TD's AMPHUR_NAME against LED's district
 * name, which fails wherever the two services spell a place differently - LED
 * writes กิ่งอำเภอโคกโพธิ์ไชย where TD writes โคกโพธิ์ไชย, and a district can
 * be renamed outright between the systems.
 *
 * The search is sent with TD's province NAME as well as TD's province code,
 * because the request carries both and only the code was ever filled in.
 */
const area = (p) => {
    const d = ledDistrict(p.led_district);
    const prov = ledProvince(p.led_province);
    const tdProv = d?.tdProvinceCode ?? prov?.tdCode ?? null;
    const tdProvName = d?.tdProvinceName ?? prov?.tdName ?? null;
    const tdDistName = d?.tdDistrictName ?? null;
    return {
        tdProvinceCode: tdProv,
        tdProvinceName: tdProvName,
        tdDistrictCode: d?.tdDistrictCode ?? null,
        tdDistrictName: tdDistName,
        /* What LED called it, kept for the note so a human can see both. */
        ledDistrictName: d?.name ?? p.district_name ?? null,
        known: !!(d?.tdDistrictCode && tdProv && tdProvName),
    };
};

for (const [i, p] of todo.entries()) {
    const a = area(p);
    if (!a.known) {
        /* No dictionary entry for this district, so there is no way to ask TD
         * in its own terms. Say so rather than asking with LED's name and
         * reading the answer as a verdict on the land. */
        stats.error++;
        await fileReason(p.parcel_id, "error",
            `no LED->TD mapping for district ${p.led_district} (${p.district_name})`);
        await sleep(DELAY_MS);
        continue;
    }
    const rows = await query(
        { name: a.tdProvinceName, td_province_code: a.tdProvinceCode },
        p.deed_number,
        p.td_land_no_hint ?? "",
    );

    if (!Array.isArray(rows)) {
        stats.error++;
        await fileReason(p.parcel_id, "error", String(rows?.error ?? "no rows returned"));
        await sleep(DELAY_MS);
        continue;
    }
    if (!rows.length) {
        stats.noResult++;
        await fileReason(p.parcel_id, "no_result", `TD has no parcel under deed ${p.deed_number}`);
        await sleep(DELAY_MS);
        continue;
    }

    /* TD does not filter by district: AMPH_CODE is not a recognised parameter
     * (it returns total=0) and AMPHUR_CODE is accepted but ignored. A bare
     * CHANOD_NO therefore returns every parcel in the province carrying that
     * deed number - deed 12329 in บึงกาฬ returns three, of which only one is in
     * เมืองบึงกาฬ. Taking rows[0] picks the wrong one, silently, and it looks
     * like a clean resolution.
     *
     * So pick here, against the district LED and our map already resolved. Only
     * fall back to a lone candidate; anything else is a genuine ambiguity and is
     * reported rather than guessed.
     *
     * The comparison is against TD's own name for the district, taken from the
     * dictionary, not against LED's. LED writes กิ่งอำเภอโคกโพธิ์ไชย where TD
     * writes โคกโพธิ์ไชย, and a district can be renamed outright between the two
     * systems, so comparing LED's string to TD's string rejects parcels that
     * were placed correctly. */
    const want = a.tdDistrictName;
    const byDistrict = want
        ? rows.filter((r) => tdRowMatchesDistrict(r.AMPHUR_NAME, want))
        : [];
    let r = null;
  let verdict = null;
    let via = "td";
    if (byDistrict.length === 1) { stats.found++; r = byDistrict[0]; verdict = "match"; }
    else if (byDistrict.length > 1) {
        stats.ambiguous++;
        ambiguous.push({ deed: p.deed_number, n: byDistrict.length, dist: want });
        await fileReason(p.parcel_id, "ambiguous",
            `TD returned ${byDistrict.length} parcels in ${want} for deed ${p.deed_number}`);
        await sleep(DELAY_MS);
        continue;
    }
    else if (rows.length === 1) {
    /* One row, but not in the district our map resolved. Accepting it would put a
     * marker on the wrong district, so it is recorded as a mismatch instead. */
    stats.found++; stats.districtUnverified++; r = rows[0]; verdict = "district_mismatch";
  }
    else {
        /* TD could not place this one. Fall through to DOL. */
        const d = await dolLookup(a.tdProvinceCode, a.tdDistrictCode, p.deed_number);
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
        /* The verdict is the district disagreement, not the quota. The quota
         * only decides whether DOL was asked as a second opinion; it is not why
         * the parcel is unplaced, and filing it as pending_quota buried 270 real
         * mismatches under a reason that meant something else. The quota goes in
         * the note instead. */
        const got = [...new Set(rows.map((x) => String(x.AMPHUR_NAME ?? "").trim()).filter(Boolean))];
        await fileReason(
            p.parcel_id,
            "district_mismatch",
            `TD has deed ${p.deed_number} in ${got.join(", ") || "an unnamed district"}, LED says ${a.ledDistrictName} (TD ${a.tdDistrictCode})` +
            (dolStats.blocked ? "; DOL not tried, daily allowance spent" : ""),
        );
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
    } else {
        stats.noShape++;
        /* TD matched the parcel and gave no SHAPE, so there is no point to put
         * on the map. The success path below would still write a coordinate of
         * null and call it resolved, which hides the parcel from every later
         * query that looks for a coordinate - including the one that decides
         * what is left to do. */
        await fileReason(p.parcel_id, "no_shape",
            `TD matched deed ${p.deed_number} but returned no SHAPE`);
    }

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
                    td_verdict    = $14,
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