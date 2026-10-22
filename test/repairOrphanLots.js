/* repairOrphanLots.js — give the lotless parcels their lot back.
 *
 *   DATABASE_URL=... bun repairOrphanLots.js            # dry run
 *   DATABASE_URL=... bun repairOrphanLots.js --write
 *
 * A parcel is created for every deed number LED's row carried. One row can
 * carry several - "45722,45727-9" - and the lot's natural key was built from
 * the whole list, so all of them collapsed onto one lot row. The first parcel
 * kept it. Every other parcel was left with no lot at all, and so with no case
 * number, no size, no price and no date: a row on the map with nothing behind
 * it, and nothing on LED's site to search for either.
 *
 * The parent lot is still there, carrying the case number, the court, the
 * order and the price. This copies it onto each orphan, stamped with the
 * orphan's own deed number so the two are told apart.
 *
 * ingest.js now stamps each lot with its own parcel's number, so a re-scrape
 * produces the right shape on its own. This is the repair for the rows that
 * were already stored the wrong way.
 */
import { Client } from "pg";
import { parseDeedNumbers } from "./scrapeLED.js";

const WRITE = process.argv.includes("--write");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const line = (s) => console.log(s);

const { rows: orphans } = await db.query(`
  SELECT p.id, p.deed_number, p.tumbol, p.district_name, p.province_name, p.land_title_raw
    FROM parcels p
   WHERE NOT EXISTS (SELECT 1 FROM auction_lots l WHERE l.parcel_id = p.id)
   ORDER BY p.id`);

/* Every lot whose deed number names more than one deed is a parent. Its own
 * number list says which. */
const { rows: parents } = await db.query(`
  SELECT id, parcel_id, case_no, case_year, order_number, order_sub, deed_number, plot_no
    FROM auction_lots
   WHERE deed_number ~ '[,\\-]'`);
const index = new Map();
for (const p of parents) {
    for (const n of parseDeedNumbers(p.deed_number).numbers) {
        if (!index.has(n)) index.set(n, []);
        index.get(n).push(p);
    }
}

line(`  ${orphans.length} parcel(s) with no lot, ${parents.length} parent lot(s) to look in`);
let repaired = 0, unmatched = 0;
const misses = [];

for (const o of orphans) {
    const cands = index.get(o.deed_number) ?? [];
    /* Prefer a parent in the same district: the same deed number in another
     * province is a different piece of land. */
    const same = cands.filter((p) => p.parcel_id != null);
    const parent = same[0] ?? cands[0];
    if (!parent) {
        unmatched++;
        misses.push(o);
        line(`  ${String(o.id).padStart(5)} ${String(o.deed_number).padEnd(8)} ${o.district_name}/${o.tumbol}  no parent lot names this deed`);
        continue;
    }
    const { rows: src } = await db.query(`SELECT * FROM auction_lots WHERE id = $1`, [parent.id]);
    const s = src[0];
    repaired++;
    line(`  ${String(o.id).padStart(5)} ${String(o.deed_number).padEnd(8)} ${String(o.district_name).padEnd(14)}/${String(o.tumbol).padEnd(12)} <- lot ${parent.id}  case ${s.case_no}/${s.case_year} order ${s.order_number}-${s.order_sub} size ${s.size_rai}-${s.size_ngan}-${s.size_wa}`);
    if (WRITE) {
        await db.query(
            `INSERT INTO auction_lots
               (parcel_id, case_no, case_year, court, plaintiff, defendant, owner, department,
                first_round_date, order_number, order_sub, order_label, asset_type,
                size_unit, size_rai, size_ngan, size_wa, published_date, legal_exec_dept, remark,
                start_price, start_price_src, committee_price, led_price, officer_price,
                expert_price, bid_security, status, close_code, close_reason, closed_at,
                next_round_date, next_round_price, deed_number, plot_no,
                group_lot_count, group_total_price, first_seen, last_seen)
             SELECT $1, case_no, case_year, court, plaintiff, defendant, owner, department,
                    first_round_date, order_number, order_sub, order_label, asset_type,
                    size_unit, size_rai, size_ngan, size_wa, published_date, legal_exec_dept, remark,
                    start_price, start_price_src, committee_price, led_price, officer_price,
                    expert_price, bid_security, status, close_code, close_reason, closed_at,
                    next_round_date, next_round_price, $2, plot_no,
                    group_lot_count, group_total_price, now(), now()
               FROM auction_lots WHERE id = $3`,
            [o.id, o.deed_number, parent.id]);
    }
}

line(`\n  ${repaired} repaired, ${unmatched} with no parent lot to copy`);
if (misses.length) {
    line("  the ones with no parent - their deed number stands alone in LED's row:");
    for (const m of misses.slice(0, 20)) {
        line(`     ${String(m.id).padStart(5)} ${String(m.deed_number).padEnd(8)} ${m.province_name}/${m.district_name}/${m.tumbol}  "${m.land_title_raw}"`);
    }
}
if (!WRITE) line("  DRY RUN - nothing written. Re-run with --write.");
await db.end();
