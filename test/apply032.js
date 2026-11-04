/* One-shot: apply db/migrations/032_report_edits.sql and verify the tables. */
import { readFileSync } from "node:fs";
import pg from "pg";

const sql = readFileSync(
  new URL("../db/migrations/032_report_edits.sql", import.meta.url),
  "utf8",
);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(sql);
console.log("migration OK");

const { rows } = await pool.query(`
  SELECT table_name FROM information_schema.tables
   WHERE table_name IN ('parcel_reports', 'parcel_edits') ORDER BY 1`);
console.log("tables:", rows.map(r => r.table_name).join(", "));
for (const t of ['parcel_reports', 'parcel_edits']) {
  const { rows: c } = await pool.query(`SELECT count(*)::int n FROM ${t}`);
  console.log(t, "rows:", c[0].n);
}
await pool.end();
