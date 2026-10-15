/* applyLedTdMap.js - load test/research/led_to_td/led_to_td_map.json into districts.
 *
 * Dry-run by default. Pass --write to commit.
 *
 *   DATABASE_URL=... bun applyLedTdMap.js
 *   DATABASE_URL=... bun applyLedTdMap.js --write
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAP = resolve(import.meta.dir, "research", "led_to_td", "led_to_td_map.json");
const WRITE = process.argv.includes("--write");

/* Confirmed by hand against LED's own search: both return zero listings, so
 * there is nothing to resolve and the map's guesses for them are dropped.
 * 2412 "พนมสารคาม (กิ่งอำเภอราชสาส์น)" was pinned onto TD 24-06, colliding with
 * 2406; with 2412 unmatched, 24-06 is again the sole owner of พนมสารคาม. */
const FORCE_UNMATCHED = new Set(["2412", "2413"]);

const map = JSON.parse(readFileSync(MAP, "utf8")).entries;
const { SQL } = await import("bun");
const DB_URL =
    process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap";
if (!process.env.DATABASE_URL) {
    console.log(`  DATABASE_URL not set; using ${DB_URL.replace(/:[^:@]*@/, ":***@")}`);
}
const db = new SQL(DB_URL);

const rows = map.map((m) => {
    const skip = FORCE_UNMATCHED.has(m.led_district_code);
    return {
        led: m.led_district_code,
        name: m.led_district_name,
        tdProv: skip ? null : m.td_province_code ? Number(m.td_province_code) : null,
        td: skip ? null : m.td_district_code ? Number(m.td_district_code) : null,
        method: skip ? "unmatched_no_led_listings" : m.match_method,
        note: skip ? "no LED search results; verified by hand on asset.led.go.th" : m.note || null,
    };
});

const before = new Map(
    (await db.unsafe(`SELECT code, td_code FROM districts`)).map((r) => [
        String(r.code),
        r.td_code ?? null,
    ]),
);

const added = [];
const changed = [];
const cleared = [];
let same = 0;
for (const r of rows) {
    const had = before.has(r.led);
    const was = before.get(r.led) ?? null;
    if (!had) { added.push(r); continue; }
    if (was === r.td) same++;
    else if (r.td === null) cleared.push({ ...r, was });
    else changed.push({ ...r, was });
}

console.log(`  map entries            ${rows.length}`);
console.log(`  districts in DB        ${before.size}`);
console.log(`  led codes missing from DB  ${added.length}`);
console.log(`  unchanged              ${same}`);
console.log(`  changed                ${changed.length}`);
console.log(`  cleared to unmatched   ${cleared.length}`);
console.log(`  unmatched in map       ${rows.filter((r) => r.td === null).length}`);
console.log(`  write mode             ${WRITE}`);

const byMethod = {};
for (const r of rows) byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
console.log("\n  by match_method:");
for (const [k, v] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(28)} ${v}`);
}

console.log("\n  cleared:");
for (const r of cleared) console.log(`    LED ${r.led} ${r.name}  was TD ${r.was} -> unmatched`);

if (added.length) {
    console.log("\n  in map but not in DB:");
    for (const r of added.slice(0, 20)) console.log(`    LED ${r.led} ${r.name}`);
}

console.log("\n  changed (first 20):");
for (const c of changed.slice(0, 20)) {
    console.log(`    LED ${c.led} ${c.name.padEnd(24)} ${String(c.was).padEnd(4)} -> ${String(c.td).padEnd(4)} [${c.method}]`);
}

// many-to-one check: the index dropped in 020 exists because of these
const owner = new Map();
for (const r of rows) {
    if (r.td === null) continue;
    const k = `${r.tdProv}-${r.td}`;
    if (!owner.has(k)) owner.set(k, []);
    owner.get(k).push(r);
}
const shared = [...owner].filter(([, v]) => v.length > 1);
console.log(`\n  TD districts shared by >1 LED district: ${shared.length} (${shared.reduce((a, [, v]) => a + v.length, 0)} rows)`);

if (!WRITE) {
    console.log("\n  DRY RUN - nothing written. Re-run with --write to apply.");
    await db.close();
    process.exit(0);
}

await db.begin(async (tx) => {
    for (const r of rows) {
        await tx.unsafe(
            `UPDATE districts
                SET td_province_code = $2, td_code = $3, td_match_method = $4, td_note = $5
              WHERE code = $1`,
            [r.led, r.tdProv, r.td, r.method, r.note],
        );
    }
});

const chk = await db.unsafe(
    `SELECT count(*) FILTER (WHERE td_code IS NOT NULL) mapped,
            count(*) FILTER (WHERE td_code IS NULL)     unmatched,
            count(*) total
       FROM districts`,
);
console.log(`\n  WRITTEN. districts: ${chk[0].mapped} mapped, ${chk[0].unmatched} unmatched, ${chk[0].total} total`);
await db.close();