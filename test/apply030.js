/* One-shot: apply db/migrations/030_parcel_error_review.sql to the canonical DB
 * and verify what landed. Read-only after the migration; rerunnable. */
import { readFileSync } from "node:fs";
import pg from "pg";

const sql = readFileSync(
  new URL("../db/migrations/030_parcel_error_review.sql", import.meta.url),
  "utf8",
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(sql);
console.log("migration OK");

const checks = [[
  `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_name='parcels' AND column_name IN ('reviewed_error')`, "new column",
]];
for (const [q, label] of checks) {
  const res = await pool.query(q);
  console.log(label, "=>", JSON.stringify(res.rows));
}
await pool.end();
