/* tdAreaCodes.js - populate TD's own admin codes and match them to LED's.
 *
 * TD publishes everything through ONE endpoint (verified against
 * test/research/assessprice_api_bundle):
 *
 *   POST /assessprice/ashx/Proxy.ashx?<DataService.svc/DS_TRANSIT>?
 *     SP=LUT_Q_BND & SYS_ID=GIS5                      -> provinces  {CODE,DESCR}
 *     ... & PROV_CODE=<pc>                            -> districts
 *     ... & AMPH_CODE=<dc>                            -> subdistricts
 *
 * No session, no CSRF, no key. Three details matter and cost a 400 each:
 * Accept must be application/json, Referer is the SITE ROOT (not /assessprice/),
 * and the URL ends in a bare "?" which is the proxy's preventCache marker.
 *
 * LED and TD renumber districts independently, so nothing is joined on code.
 * Everything is joined on NAME within a province, and unmatched rows are
 * reported rather than guessed - a wrong merge silently reassigns every parcel
 * in that district.
 *
 *   bun tdAreaCodes.js              # all provinces
 *   bun tdAreaCodes.js 83 22        # just these
 */

import { SQL } from "bun";

const DB_URL = process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap";
const SVC = "https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT";
const ENDPOINT = `https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?${SVC}?`;
const DELAY_MS = Number(process.env.TD_AREA_DELAY_MS ?? 250);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://assessprice.treasury.go.th",
    Referer: "https://assessprice.treasury.go.th/",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

async function call(params) {
    const body = new URLSearchParams({ SP: "LUT_Q_BND", SYS_ID: "GIS5", ...params }).toString();
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const r = await fetch(ENDPOINT, { method: "POST", headers: HEADERS, body });
            const j = await r.json();
            if (j?.success === true) return j.data ?? [];
            throw new Error(`success=${j?.success} ${j?.message ?? ""}`);
        } catch (e) {
            if (attempt === 3) throw e;
            await sleep(800 * attempt);
        }
    }
    return [];
}

/** LED prefixes islands with อำเภอ and Bangkok with แขวง, and writes เมืองN;
 *  TD writes neither. Strip all of it so both sides reduce to the bare name. */
function normalise(name) {
    return (name ?? "")
        .trim()
        .replace(/^(อำเภอ|เขต|แขวง)\s*/u, "")
        .replace(/^เมือง(?=[ก-๙])/u, "")
        .replace(/\s+/gu, "");
}

function similarity(a, b) {
    const A = normalise(a);
    const B = normalise(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.length < 2 || B.length < 2) return 0;
    const grams = (s) => {
        const g = new Map();
        for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1);
        return g;
    };
    const ga = grams(A);
    const gb = grams(B);
    let shared = 0;
    for (const [k, n] of ga) shared += Math.min(n, gb.get(k) ?? 0);
    return (2 * shared) / ((A.length - 1) + (B.length - 1));
}

async function main() {
    const wanted = process.argv.slice(2).map(Number).filter(Boolean);
    const db = new SQL(DB_URL);

    const ledProvinces = await db.unsafe(`SELECT code, name, dol_code FROM provinces ORDER BY code`);
    const list = wanted.length ? ledProvinces.filter((p) => wanted.includes(Number(p.code))) : ledProvinces;

    /* Fetched ONCE. Calling it per-province re-downloaded the same 77-row list
     * 77 times, which is ~76 wasted round trips to a government service. */
    const tdProvinces = await call({});
    const stats = { districts: 0, subdistricts: 0, matched: 0, unmatchedLed: [], unmatchedTd: [] };
    const WITH_SUBDISTRICTS = process.env.TD_SUBDISTRICTS !== "0";

    for (const prov of list) {
        const pc = String(prov.code);
        const tdProv = tdProvinces.find((p) => String(p.CODE) === pc);
        if (!tdProv) console.log(`\n${prov.name} (${pc})  *** no such province in TD ***`);
        /* Query TD with TD's OWN province code, not LED's. They agree for 76 of 77
         * provinces; บึงกาฬ is LED 97 but TD 38, and asking TD for "97" returns
         * zero districts - which silently left all 8 of its districts unmatched. */
        const tdProvCode = String(prov.dol_code ?? pc);
        const tdDistricts = await call({ PROV_CODE: tdProvCode });

        console.log(`\n${prov.name} (${pc})  LED dol_code ${prov.dol_code} | TD ${tdProv ? tdProv.CODE : "?"} ${tdProv?.DESCR ?? ""}`);

        const byName = new Map();
        for (const d of tdDistricts) {
            const key = normalise(d.DESCR);
            if (!byName.has(key)) byName.set(key, d);
        }
        const used = new Set();
        const claimed = new Set();

        /* Which TD code each LED district already holds. districts.dol_code is
         * NOT NULL and UNIQUE (province_id, dol_code), so it cannot be blanked
         * to force a clean rebuild - two unmatched rows would collide on ''.
         * Instead, an existing holder is released explicitly before reuse. */
        const holders = new Map(
            (
                await db.unsafe(
                    `SELECT dol_code, id FROM districts WHERE province_id = $1`,
                    [Number(pc)],
                )
            ).map((r) => [Number(r.dol_code), r.id]),
        );

        /* LED districts of this province, loaded once and matched in JS. */
        const ledDistricts = await db.unsafe(
            `SELECT id, name, dol_code FROM districts WHERE province_id = $1 ORDER BY dol_code, name`,
            [Number(pc)],
        );

        for (const td of tdDistricts) {
            /* Resolve in JS, not SQL: the join is on the NORMALISED name, and a
             * SQL LIKE '%name%' was far too loose - in Bangkok it matched two
             * LED khet to one TD district and died on the unique index. */
            const want = normalise(td.DESCR);
            const cands = ledDistricts.filter((d) => !claimed.has(d.id));
            let hit =
                cands.find((d) => normalise(d.name) === want) ??
                cands.find((d) => similarity(d.name, td.DESCR) >= 0.75);

            /* One TD code may map to exactly one LED district. If everything in
             * range is already claimed, say so instead of overwriting - two LED
             * districts sharing one TD code would silently merge them. */
            if (!hit) {
                stats.unmatchedTd.push({
                    province: prov.name,
                    provCode: pc,
                    tdCode: td.CODE,
                    tdName: td.DESCR,
                });
                continue;
            }
            claimed.add(hit.id);
            /* Release whoever holds this TD code before handing it over, unless
             * that is this very district (re-running must not churn). */
            const tdNum = Number(td.CODE);
            const holder = holders.get(tdNum);
            if (holder !== undefined && holder !== hit.id) {
                /* Released to NULL rather than a sentinel: UNIQUE
                 * (province_id, dol_code) permits any number of NULLs, so
                 * unmatched districts coexist instead of colliding. */
                await db.unsafe(`UPDATE districts SET dol_code = NULL WHERE id = $1`, [holder]);
                claimed.delete(holder);
            }
            await db.unsafe(`UPDATE districts SET dol_code = $1 WHERE id = $2`, [tdNum, hit.id]);
            holders.set(tdNum, hit.id);
            stats.matched++;
            stats.districts++;
            used.add(hit.id);

            /* subdistricts under the district we just matched */
            if (!WITH_SUBDISTRICTS) continue;
            const tdSubs = await call({ PROV_CODE: pc, AMPH_CODE: String(td.CODE) });
            for (const ts of tdSubs) {
                const s = await db.unsafe(
                    `SELECT id FROM subdistricts WHERE district_id = $1 AND name = $2 LIMIT 1`,
                    [hit.id, String(ts.DESCR).trim()],
                );
                if (!s.length) continue;
                await db.unsafe(`UPDATE subdistricts SET dol_code = $1 WHERE id = $2`, [
                    String(ts.CODE),
                    s[0].id,
                ]);
                stats.subdistricts++;
            }
            await sleep(DELAY_MS);
        }

        /* LED districts TD does not know about - these need a human */
        for (const ld of ledDistricts) {
            if (!used.has(ld.id)) {
                stats.unmatchedLed.push({ province: prov.name, provCode: pc, ledName: ld.name, ledDol: ld.dol_code });
            }
        }
        console.log(`    TD ${tdDistricts.length} districts -> matched ${stats.matched} cumulative`);
        await sleep(DELAY_MS);
    }

    console.log(`\ndone: ${stats.districts} districts matched, ${stats.subdistricts} subdistricts coded`);
    console.log(`  LED districts TD does not know (${stats.unmatchedLed.length}):`);
    for (const u of stats.unmatchedLed) console.log(`    ${u.province.padEnd(16)} ${u.ledName}  (LED ${u.ledDol})`);
    console.log(`  TD districts LED does not know (${stats.unmatchedTd.length}):`);
    for (const u of stats.unmatchedTd) console.log(`    ${u.province.padEnd(16)} ${u.tdName}  (TD ${u.tdCode})`);

    await db.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});