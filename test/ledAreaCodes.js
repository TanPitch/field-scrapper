/* ledAreaCodes.js - populate provinces / districts / subdistricts from LED.
 *
 * LED exposes the authoritative admin hierarchy as two plain ASP endpoints, so
 * there is no need to hand-transcribe codes and no reason to let them drift:
 *
 *   get_amphur.asp?provinceId=<2-digit province code>  -> districts
 *   get_tambon.asp?amphurId=<provinceCode><districtCode> -> subdistricts
 *
 * amphurId is the concatenation, not an autoincrement: 83 + 01 -> 8301. The
 * option value already carries the concatenation, so it is used verbatim rather
 * than rebuilt, which keeps letter-suffixed district codes such as ท่าใหม่
 * (จันทบุรี "ท1") intact instead of producing a non-numeric "50ท1".
 *
 * The dropdowns also carry a province-wide aggregate row, code `<prov>00`, with
 * an empty label. It is not a district, so it is skipped.
 *
 * TD publishes no subdistrict level, which is why districts are stored with
 * both `code` (LED amphurId) and `dol_code` (TD 2-digit AMPH_CODE) while
 * subdistricts carry only `code`.
 *
 *   bun ledAreaCodes.js            # all provinces in the reference list
 *   bun ledAreaCodes.js 83 40      # just these
 */

import { readFileSync } from "node:fs";

const DB_URL =
    process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap";

const LED = "https://asset.led.go.th/newbidreg";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const HEADERS = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": UA,
    Referer: `${LED}/default.asp`,
};

/** LED and TD province codes agree everywhere except บึงกาฬ: LED 97, TD 38. */
const PROVINCE_DOL_CODE = { 97: 38 };

const DELAY_MS = Number(process.env.LED_AREA_DELAY_MS ?? 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
    s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

/**
 * LED emits `value='8302'` with single quotes; the earlier double-quote-only
 * parser silently returned zero options and made a working endpoint look dead.
 * Both quote styles are accepted.
 */
function parseOptions(html) {
    const out = [];
    const re = /<option[^>]*value=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(html))) {
        const value = decode(m[2]).replace(/^﻿/, "").trim();
        const label = decode(m[3]).replace(/^﻿/, "").replace(/<[^>]*>/g, "").trim();
        if (value) out.push({ value, label });
    }
    return out;
}

async function get(url) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const r = await fetch(url, { headers: HEADERS });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return parseOptions(await r.text());
        } catch (e) {
            if (attempt === 3) throw e;
            await sleep(1000 * attempt);
        }
    }
    return [];
}

/** Reference list of provinces: [{"value":"83","text":"ภูเก็ต"}, ...] */
function provinceList() {
    return JSON.parse(readFileSync("./data/provinces.json", "utf8"));
}

async function main() {
    const wanted = process.argv.slice(2).map(Number).filter(Boolean);
    const all = provinceList();
    const list = wanted.length
        ? all.filter((p) => wanted.includes(Number(p.value)))
        : all;
    if (!list.length) {
        console.error("no matching provinces; pass LED province codes, e.g. `bun ledAreaCodes.js 83`");
        process.exit(1);
    }

    const { SQL } = await import("bun");
    const db = new SQL(DB_URL);
    const stats = { provinces: 0, districts: 0, subdistricts: 0, aggregateSkipped: 0 };

    console.log(`[cfg] ${list.length} province(s), ${DELAY_MS}ms between requests\n`);

    for (const prov of list) {
        const pc = String(prov.value).padStart(2, "0");
        const pname = prov.text ?? prov.label;
        const pdol = PROVINCE_DOL_CODE[Number(pc)] ?? Number(pc);

        const pr = await db.unsafe(
            `INSERT INTO provinces (code, name, dol_code) VALUES ($1, $2, $3)
             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, dol_code = EXCLUDED.dol_code
             RETURNING code`,
            [Number(pc), pname, pdol],
        );
        if (pr.length) stats.provinces++;
        const dolNote = pdol === Number(pc) ? "" : `  (TD ${pdol})`;
        console.log(`${pname} (${pc})${dolNote}`);

        const districts = await get(`${LED}/get_amphur.asp?provinceId=${pc}`);
        for (const d of districts) {
            if (d.value === `${pc}00` || !d.label) {
                stats.aggregateSkipped++;
                console.log(`    -- skip province-wide aggregate "${d.value}"`);
                continue;
            }
            /* The 2-digit suffix only exists for the ordinary 4-digit amphurId.
             * LED also publishes six-digit codes for the pre-2013 provinces
             * (252505 วังน้ำเย็น, under what was then ปราจีนบุรี), where slicing
             * off the province gave "2505" - not a district code at all, and not
             * something the districts table holds. Those keep a NULL dol_code;
             * `code` is LED's own identifier and is the reliable key either way. */
            const dolCode = d.value.length === 4 ? d.value.slice(2) : null;
            if (d.value.length !== 4) {
                console.log(`    -- ${d.value} ${d.label}: non-standard ${d.value.length}-digit code, no dol_code`);
            }
            await db.unsafe(
                `INSERT INTO districts (province_id, code, dol_code, name)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (province_id, code) DO UPDATE SET name = EXCLUDED.name, dol_code = EXCLUDED.dol_code`,
                [Number(pc), d.value, dolCode, d.label],
            );
            stats.districts++;
            console.log(`    ${d.value}  ${String(dolCode ?? "-").padEnd(3)} ${d.label}`);

            const tambons = await get(`${LED}/get_tambon.asp?amphurId=${d.value}`);
            const drow = await db.unsafe(
                `SELECT id FROM districts WHERE province_id = $1 AND code = $2`,
                [Number(pc), d.value],
            );
            const districtId = drow[0]?.id;
            for (const t of tambons) {
                if (!districtId || !t.label) continue;
                /* LED publishes no numeric tambon id. get_tambon.asp's option
                   value is a postcode, and it repeats - 83000 stands in for "no
                   postcode" across five different Phuket tambons - so it cannot
                   be an identity column. LED is searched by name and answers in
                   text, so the tambon name is the whole of what LED knows here. */
                const known = await db.unsafe(
                    `SELECT id FROM subdistricts
                      WHERE district_id = $1 AND name = $2 LIMIT 1`,
                    [districtId, t.label],
                );
                if (known.length) continue;
                const s = await db.unsafe(
                    `INSERT INTO subdistricts (district_id, name) VALUES ($1, $2) RETURNING id`,
                    [districtId, t.label],
                );
                if (s.length) stats.subdistricts++;
                await sleep(DELAY_MS);
            }
            await sleep(DELAY_MS);
        }
        console.log("");
        await sleep(DELAY_MS);
    }

    console.log(
        `done: ${stats.provinces} provinces, ${stats.districts} districts, ` +
            `${stats.subdistricts} new subdistricts, ${stats.aggregateSkipped} aggregate rows skipped`,
    );
    await db.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});