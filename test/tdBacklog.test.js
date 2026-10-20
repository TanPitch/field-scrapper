/* tdBacklog.test.js — the rule that decides what the TD pass still has to do.
 *
 *   DATABASE_URL=... bun test tdBacklog.test.js
 *
 * This predicate dropped a third of the backlog without saying so, because
 * `dol_verdict IN (...)` is NULL rather than false when dol_verdict is NULL,
 * and NOT(NULL AND anything) is NULL, and a WHERE clause keeps only rows that
 * are TRUE. Every parcel that had never been checked was therefore invisible to
 * the pass - 131 of them, never asked and never reported.
 */
import { test, expect, afterAll } from "bun:test";
import pg from "pg";
import { needsWork, DEAD_ENDS, RETRY_DAYS } from "./tdBacklog.js";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

/** The same shape the script uses, so the test exercises the real fragment. */
const backlog = async (days) => {
  const { rows } = await client.query(
    `SELECT p.id FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
       JOIN provinces pr ON pr.code = d.province_id
      WHERE ${needsWork}`,
    [days],
  );
  return rows.map((r) => Number(r.id));
};

test("a parcel that has never been checked is in the backlog", async () => {
  /* The regression. These have dol_verdict NULL - no lookup has ever run on
   * them - and the old predicate threw them away. */
  const { rows } = await client.query(
    `SELECT p.id FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
      WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.dol_verdict IS NULL
      LIMIT 50`);
  if (!rows.length) return; // nothing unchecked right now
  const ids = new Set(await backlog(0));
  const missing = rows.filter((r) => !ids.has(Number(r.id)));
  expect(missing.length).toBe(0);
});

test("every parcel with no coordinate from any source is either in the backlog or a recent dead end", async () => {
  const ids = new Set(await backlog(RETRY_DAYS));
  const { rows } = await client.query(
    `SELECT p.id, p.dol_verdict, p.td_checked_at FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
      WHERE p.td_lat IS NULL AND p.dol_lat IS NULL`);
  const strays = rows.filter((r) => {
    if (ids.has(Number(r.id))) return false;
    // not in the backlog means it is a recent dead end, and that is the only
    // other reason a parcel may be left alone
    return !(DEAD_ENDS.includes(r.dol_verdict) && r.td_checked_at);
  });
  expect(strays.length).toBe(0);
});

test("a dead end is left alone for a week and a never-checked parcel is not", async () => {
  const { rows: dead } = await client.query(
    `SELECT p.id FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
      WHERE p.td_lat IS NULL AND p.dol_lat IS NULL
        AND p.dol_verdict = 'district_mismatch' AND p.td_checked_at > now() - interval '1 day'
      LIMIT 20`);
  const { rows: fresh } = await client.query(
    `SELECT p.id FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
      WHERE p.td_lat IS NULL AND p.dol_lat IS NULL AND p.dol_verdict IS NULL
      LIMIT 20`);
  if (!dead.length || !fresh.length) return;
  const ids = new Set(await backlog(RETRY_DAYS));
  for (const d of dead) expect(ids.has(Number(d.id))).toBe(false);
  for (const f of fresh) expect(ids.has(Number(f.id))).toBe(true);
});

test("a parcel with a coordinate is never in the backlog", async () => {
  const ids = new Set(await backlog(0));
  const { rows } = await client.query(
    `SELECT id FROM parcels WHERE td_lat IS NOT NULL OR dol_lat IS NOT NULL LIMIT 100`);
  for (const r of rows) expect(ids.has(Number(r.id))).toBe(false);
});

afterAll(async () => { await client.end(); });