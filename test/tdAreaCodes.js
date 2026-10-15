/* tdAreaCodes.js - fill subdistricts.dol_code from TD's own dropdowns.
 *
 * District mapping is NOT done here. That work moved to
 * test/research/led_to_td/led_to_td_map.json and applyLedTdMap.js, which
 * cross-checks LED's and TD's dropdowns and records how each match was made.
 * Name-matching here produced 72 wrong districts and 6 invented ones before
 * being replaced.
 *
 * What is left is the subdistrict pass. LED publishes no numeric tambon id at
 * all - get_tambon.asp returns a postcode, and it repeats - so a tambon is
 * identified by (district, name), and all this can add is TD's own TUMB_CODE.
 *
 * Reads districts.td_province_code / td_code as written by the map, groups LED
 * districts by the TD district they resolve to (66 of them are shared, so this
 * is 928 API calls rather than 999), and writes each TD tambon list onto every
 * LED district behind it.
 *
 *   DATABASE_URL=... bun tdAreaCodes.js
 *   TD_SUBDISTRICTS=0 bun tdAreaCodes.js   # report only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DELAY_MS = Number(process.env.TD_AREA_DELAY_MS ?? 250);
const WRITE = !process.argv.includes("--dry-run");

const SNAPSHOT = resolve(import.meta.dir, "research", "assessprice_api_bundle", "provinces_districts.json");
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The snapshot is a cross-check on the province list, not the source of
 * tambons: it was exported without any subdistrict data. */
let snapshotProvinces = new Map();
try {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    snapshotProvinces = new Map((snap.provinces ?? []).map((p) => [String(p.CODE ?? p.code), p.DESCR ?? p.name]));
} catch {
    console.log("  [cfg] snapshot not readable; carrying on without it");
}

const { SQL } = await import("bun");
const DB_URL = process.env.DATABASE_URL;
let db = new SQL(DB_URL);

/* This run holds one connection open across ~930 HTTP calls and thousands of
 * small queries, with a sleep between each. Bun's pool reaps a connection that
 * has been idle long enough, and the next query fails with
 * ERR_POSTGRES_CONNECTION_CLOSED - which reads like the server went away when
 * it is only the socket. Reconnect once and retry rather than losing the run. */
async function q(sql, params) {
    try {
        return await db.unsafe(sql, params);
    } catch (e) {
        if (!/CONNECTION_CLOSED|Connection closed|ECONNREFUSED|terminating|socket/i.test(e.message)) throw e;
        console.warn(`    ! reconnecting after: ${e.message.split("\n")[0]}`);
        try { try { await db.close(); } catch {} } catch {}
        db = new SQL(DB_URL);
        return await db.unsafe(sql, params);
    }
}

async function call(params) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const r = await fetch(EP, {
                method: "POST",
                headers: HEADERS,
                body: new URLSearchParams({ SP: "LUT_Q_BND", SYS_ID: "GIS5", ...params }),
            });
            const j = await r.json();
            if (Array.isArray(j.data)) return j.data;
            throw new Error(`no data array (success=${j.success} message=${j.message})`);
        } catch (e) {
            if (attempt === 4) {
                console.warn(`    ! ${JSON.stringify(params)} failed after ${attempt}: ${e.message}`);
                return [];
            }
            await sleep(1500 * attempt);
        }
    }
    return [];
}

/* group LED districts by the TD district they resolve to */
const led = await q(
    `SELECT d.id, d.code, d.name, d.province_id, d.td_code, d.td_province_code, d.td_match_method,
            p.name AS province
       FROM districts d JOIN provinces p ON p.code = d.province_id
      WHERE d.td_code IS NOT NULL AND d.td_province_code IS NOT NULL
      ORDER BY d.td_province_code, d.td_code`,
);

/* Optional filters. The full pass is ~930 HTTP calls and takes a while, so it
 * is worth being able to re-run one province without paying for all of them. */
const ONLY_TD_PROV = process.env.TD_PROV ? process.env.TD_PROV.split(",").map(Number) : null;
const ONLY_LED_PROV = process.env.LED_PROV ? Number(process.env.LED_PROV) : null;
const groups0 = new Map();
for (const d of led) {
    if (ONLY_TD_PROV && !ONLY_TD_PROV.includes(Number(d.td_province_code))) continue;
    if (ONLY_LED_PROV && Number(d.province_id) !== ONLY_LED_PROV) continue;
    const k = `${d.td_province_code}|${d.td_code}`;
    if (!groups0.has(k)) groups0.set(k, { tdProv: d.td_province_code, tdCode: d.td_code, members: [] });
    groups0.get(k).members.push(d);
}
const groups = groups0;

console.log(`  [cfg] ${led.length} LED districts -> ${groups.size} TD districts, ${DELAY_MS}ms delay, write=${WRITE}`);
const shared = [...groups.values()].filter((g) => g.members.length > 1);
console.log(`  [cfg] ${shared.length} TD districts answer for more than one LED district`);

const stats = { tambons: 0, coded: 0, noLedTambon: [], tdUnknownTambon: [], districtsMissingSubs: [] };

let n = 0;
for (const g of groups.values()) {
    n++;
    const label = g.members.map((m) => `${m.name}${g.members.length > 1 ? ` (LED ${m.code})` : ""}`).join(" + ");
    const tdSubs = await call({ PROV_CODE: String(g.tdProv), AMPH_CODE: String(g.tdCode) });
    if (!tdSubs.length) continue;

    for (const m of g.members) {
        const subs = await q(
            `SELECT id, name, dol_code FROM subdistricts WHERE district_id = $1`,
            [m.id],
        );
        if (!subs.length) {
            stats.districtsMissingSubs.push(`${m.province} ${m.name}`);
            continue;
        }
        const byName = new Map(subs.map((s) => [String(s.name).trim(), s]));
        for (const ts of tdSubs) {
            const tname = String(ts.DESCR).trim();
            const hit = byName.get(tname);
            if (!hit) {
                stats.tdUnknownTambon.push(`${m.province} ${m.name}: TD ${ts.CODE} ${tname}`);
                continue;
            }
            if (WRITE) {
                await q(`UPDATE subdistricts SET dol_code = $1 WHERE id = $2`, [String(ts.CODE), hit.id]);
            }
            stats.coded++;
        }
        stats.tambons += tdSubs.length;
    }

    if (n % 50 === 0) console.log(`    ${n}/${groups.size} TD districts`);
    await sleep(DELAY_MS);
}

console.log(`\n  TD tambons fetched: ${stats.tambons}`);
console.log(`  subdistricts coded: ${stats.coded}${WRITE ? "" : "  (dry run)"}`);
console.log(`\n  LED districts with no subdistrict rows (${stats.districtsMissingSubs.length}):`);
for (const x of stats.districtsMissingSubs.slice(0, 15)) console.log(`    ${x}`);
console.log(`  TD tambons with no LED counterpart (${stats.tdUnknownTambon.length}):`);
for (const x of stats.tdUnknownTambon.slice(0, 15)) console.log(`    ${x}`);

const chk = await q(
    `SELECT count(*) total,
            count(*) FILTER (WHERE dol_code IS NOT NULL) coded
       FROM subdistricts`,
);
console.log(`\n  subdistricts: ${chk[0].coded} / ${chk[0].total} carry a TD code`);

try { await db.close(); } catch {}