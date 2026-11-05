// _apply.mjs — exercise server/ledReport.js against the local database.
import pg from "pg";
import { syncCaseReport } from "../../../server/ledReport.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
    ?? "postgres://postgres:landmap@localhost:5433/landmap",
});

const CASES = [
  ["ผบE.390", 2568],
  ["ผบE.2311", 2566],
  ["ผบ.2545", 2562],
];
for (const [no, yr] of CASES) {
  try {
    const out = await syncCaseReport(pool, no, yr);
    console.log("ok ", out);
  } catch (e) {
    console.error("ERR", no, e?.message ?? e);
  }
}
const check = await pool.query(`
  SELECT l.case_no, l.deed_number, to_char(l.led_report_seen,'HH24:MI:SS') seen,
         to_char(l.sold_price,'9999999') sold,
         (SELECT string_agg(r.round_date::text || ' ' || r.status_label || ' p=' || round(r.price::numeric,0) || ' sp=' || coalesce(to_char(r.sold_price,'9999999'), '-'),
                            ' ;; ' ORDER BY r.idx)
            FROM auction_rounds r WHERE r.lot_id = l.id) rounds
    FROM auction_lots l
   WHERE (l.case_no, l.case_year, l.deed_number) IN
         (('ผบE.390',2568,'63718'), ('ผบE.2311',2566,'168661'),
          ('ผบ.2545',2562,'2345'), ('ผบ.2545',2562,'2346'), ('ผบ.2545',2562,'628'))
`);
for (const r of check.rows) {
  console.log(`\n${r.case_no} ${r.deed_number} seen=${r.seen} lotSold=${r.sold}`);
  console.log("  ", r.rounds.slice(0, 2000));
}
await pool.end();
