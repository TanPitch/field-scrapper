/* coordQueue.scope.test.js — what "unresolved" means.
 *
 *   DATABASE_URL=... bun test coordQueue.scope.test.js
 *
 * The queue's WHERE clause decides what bot 2 spends its DOL quota on. It used to
 * test dol_lat alone, which queued 5,186 parcels that TD had already placed. This
 * pins the rule: a parcel needs coordinates from *no* source.
 */
import { test, expect, afterAll } from "bun:test";
import pg from "pg";
import { enqueueUnresolved } from "./coordQueue.js";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
/* One connection for the whole file — a pg Client cannot connect twice. */
await client.connect();

/* Everything below runs inside a transaction, so the file's footprint is undone
 * when it ends.
 *
 * It used to reach for the highest parcel id and wipe its coordinates. That is
 * a real parcel: parcel 14509 lost its coordinate that way, and because the
 * restore put back only the coordinates and not the note, the row was left
 * half-erased. Two files doing it at once made it worse — one could read the
 * other's wiped state and put back nothing at all. */
await client.query("BEGIN");

/* Snapshot the columns the predicate reads, so each test puts back what it found. */
const park = async (id) => {
  const { rows } = await client.query(
    `SELECT td_lat, td_lon, dol_lat, dol_lon FROM parcels WHERE id=$1`, [id]);
  return rows[0];
};
const restore = (id, was) => client.query(
  `UPDATE parcels SET td_lat=$2, td_lon=$3, dol_lat=$4, dol_lon=$5 WHERE id=$1`,
  [id, was.td_lat, was.td_lon, was.dol_lat, was.dol_lon]);

/* The highest parcel id, wiped of every coordinate, and handed back. */
const anUnresolvedParcel = async () => {
  const { rows } = await client.query(
    `UPDATE parcels SET td_lat=NULL, td_lon=NULL, dol_lat=NULL, dol_lon=NULL
      WHERE id = (SELECT id FROM parcels ORDER BY id DESC LIMIT 1)
      RETURNING id`);
  return rows[0].id;
};

const queued = async (id) => {
  const { rows } = await client.query(
    `SELECT 1 FROM coord_queue WHERE parcel_id=$1`, [id]);
  return rows.length;
};

test("a parcel with no coordinate at all is queued", async () => {
  const id = await anUnresolvedParcel();
  const was = await park(id);
  try {
    await enqueueUnresolved(client, { only: [id] });
    expect(await queued(id)).toBe(1);
  } finally {
    await client.query(`DELETE FROM coord_queue WHERE parcel_id=$1`, [id]);
    await restore(id, was);
  }
});

test("a parcel TD already placed is NOT queued", async () => {
  /* The regression. dol_lat is still null here — only td_lat is set — and the
     old predicate queued it anyway, which is how 5,186 placed parcels came to
     look like backlog. */
  const id = await anUnresolvedParcel();
  const was = await park(id);
  try {
    await client.query(`UPDATE parcels SET td_lat=7.8, td_lon=98.5 WHERE id=$1`, [id]);
    await enqueueUnresolved(client, { only: [id] });
    expect(await queued(id)).toBe(0);
  } finally {
    await client.query(`DELETE FROM coord_queue WHERE parcel_id=$1`, [id]);
    await restore(id, was);
  }
});

test("a parcel DOL already placed is NOT queued", async () => {
  const id = await anUnresolvedParcel();
  const was = await park(id);
  try {
    await client.query(`UPDATE parcels SET dol_lat=7.8, dol_lon=98.5 WHERE id=$1`, [id]);
    await enqueueUnresolved(client, { only: [id] });
    expect(await queued(id)).toBe(0);
  } finally {
    await client.query(`DELETE FROM coord_queue WHERE parcel_id=$1`, [id]);
    await restore(id, was);
  }
});

afterAll(async () => {
  /* Undo the file's footprint: the parcel it emptied, the queue rows it made.
   * Nothing it did outlives it. */
  await client.query("ROLLBACK");
  await client.end();
});