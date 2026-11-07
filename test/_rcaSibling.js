/* _rcaSibling.js — RCA recon for ผบ.754/2562 (deeds 24653 ↔ 161371).
 *
 * Prints both parcels' auction_rounds side by side, exactly as stored, so we
 * can verify the sibling-share bug's real shape before and after the fix:
 *   - which sibling's row carries the code-3 งดขายไม่มีผู้สู้ราคา verdict
 *   - whether the other sibling's row for the SAME date is the silent
 *     placeholder (status_code 0, ยังไม่มีการเปิดประมูล) or missing entirely
 *   - what discount_pct the ingest stored per round (expected: 0 everywhere
 *     for the silent sibling even after the shared no-bid — that is the bug)
 *
 * Scratch script (underscore prefix = repo convention). Safe: SELECT only.
 *
 *   cd test
 *   $env:DATABASE_URL="postgres://postgres:landmap@192.168.1.137:33200/landmap"
 *   cmd /c "bun _rcaSibling.js > out\sibling-rca.txt 2>&1"
 *   Get-Content -Encoding utf8 out\sibling-rca.txt
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
    SELECT p.id            AS parcel_id,
           p.deed_number,
           l.id            AS lot_id,
           l.case_no       || '/' || l.case_year AS "case",
           l.group_lot_count,
           left(l.remark, 90)                   AS remark_head,
           r.round_date,
           r.idx,
           r.status_code,
           r.status_label,
           r.led_label,
           r.price,
           r.discount_pct
      FROM parcels p
      JOIN auction_lots l ON l.parcel_id = p.id
      LEFT JOIN auction_rounds r ON r.lot_id = l.id
     WHERE p.deed_number IN ('24653', '161371')
     ORDER BY p.deed_number, r.round_date NULLS LAST, r.idx NULLS LAST`);

console.log(`rows: ${rows.length}`);
for (const r of rows) {
    console.log(
        `deed ${r.deed_number} | ${r.case} | lot ${r.lot_id} | group=${r.group_lot_count ?? '-'} | ` +
        `${r.round_date ?? '----------'} | idx=${String(r.idx ?? '-').padStart(2)} | ` +
        `code=${String(r.status_code ?? '-').padStart(2)} | ` +
        `label=${(r.status_label ?? '-').padEnd(28)} | led=${(r.led_label ?? '-').padEnd(28)} | ` +
        `price=${r.price ?? '-'} | disc=${r.discount_pct ?? '-'}%`
    );
}
console.log(`\nremark 24653: ${rows.find(r => r.deed_number === '24653')?.remark_head ?? '(no lot row)'}`);
console.log(`remark 161371: ${rows.find(r => r.deed_number === '161371')?.remark_head ?? '(no lot row)'}`);

await client.end();
