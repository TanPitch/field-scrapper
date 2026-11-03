/* One-shot: apply db/migrations/031_ns3k_drop.sql to the canonical DB.
 * Prints what it is about to delete, runs the migration, verifies nothing is
 * left. Destructive by design — rerunning deletes nothing (idempotent). */
import { readFileSync } from "node:fs";
import pg from "pg";

const sql = readFileSync(
  new URL("../db/migrations/031_ns3k_drop.sql", import.meta.url),
  "utf8",
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

for (const [q, label] of [
  [`SELECT count(*)::int n FROM parcels WHERE land_title ILIKE 'น.ส.3ก%'`, "parcels to delete"],
  [`SELECT count(*)::int n FROM auction_lots l JOIN parcels p ON l.parcel_id = p.id WHERE p.land_title ILIKE 'น.ส.3ก%'`, "lots to delete"],
]) {
  const res = await pool.query(q);
  console.log(label, "=>", res.rows[0].n);
}

await pool.query(sql);
console.log("migration OK");

const left = await pool.query(
  `SELECT count(*)::int n FROM parcels WHERE land_title ILIKE 'น.ส.3ก%'`);
console.log("NS3K parcels remaining =>", left.rows[0].n);
const { rows: lots } = await pool.query(`SELECT count(*)::int n FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id WHERE p.land_title ILIKE 'น.ส.3ก%'`);
console.log("NS3K lots remaining =>", lots[0].n);
await pool.end();
