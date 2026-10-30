/* One-shot: apply db/migrations/029_rounds_rekey.sql to the canonical DB and
   verify what actually landed. Read-only after the migration; rerunnable. */
import { readFileSync } from "node:fs";
import pg from "pg";

const sql = readFileSync(
  new URL("../db/migrations/029_rounds_rekey.sql", import.meta.url),
  "utf8",
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/* pg's simple query protocol applies the file whole — multi-statement SQL
   with $$ blocks cannot be naively split on ';' (the DO block contains some
   and semicolons inside its comments). */
const r = await pool.query(sql);
console.log("migration OK, command results:", r?.length ?? "n/a");

const checks = [
  [`SELECT count(*)::int n FROM information_schema.columns
      WHERE table_name='auction_rounds' AND column_name IN ('led_label','source')`, "new columns"],
  [`SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename='auction_rounds' ORDER BY indexname`, "round indexes"],
  [`SELECT (SELECT count(*)::int FROM auction_lots WHERE led_report_seen IS NULL) AS pending_cases,
          (SELECT count(*)::int FROM auction_rounds WHERE source='lists') AS lists_rows,
          (SELECT count(*)::int FROM auction_rounds WHERE source='report') AS report_rows`,
    "heal + sources"],
];
for (const [q, label] of checks) {
  const res = await pool.query(q);
  console.log(label, "=>", JSON.stringify(res.rows));
}
await pool.end();
