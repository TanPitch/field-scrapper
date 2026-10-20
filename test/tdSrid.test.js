/* tdSrid.test.js — a parcel's coordinate must come from its own SRID.
 *
 *   DATABASE_URL=... bun test tdSrid.test.js
 *
 * assessprice serves SHAPE in two SRIDs. A coordinate computed with the wrong
 * zone is not a few metres out, it is 6 degrees - 618 km - and 3,621 parcels
 * sat in the Andaman Sea while looking perfectly placed in the database.
 */
import { test, expect, afterAll } from "bun:test";
import pg from "pg";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

test("every SRID we hold has a calibration", async () => {
  const { rows } = await client.query(
    `SELECT DISTINCT td_srid FROM parcels WHERE td_utm_e IS NOT NULL AND td_srid IS NOT NULL`);
  expect(rows.length).toBeGreaterThan(0);
  for (const { td_srid } of rows) {
    const cal = await loadCalibration(client, { srid: td_srid });
    expect(cal).not.toBeNull();
    /* The SRID has to travel with the calibration, or the transform falls back
     * to 24048 and a 24047 row is projected as the wrong zone. */
    expect(Number(cal.srid)).toBe(Number(td_srid));
  }
});

test("no placed parcel is outside Thailand", async () => {
  const { rows } = await client.query(
    `SELECT count(*)::int n FROM parcels
      WHERE td_lat IS NOT NULL AND (td_lat < 5.6 OR td_lat > 20.5 OR td_lon < 97.3 OR td_lon > 105.7)`);
  expect(rows[0].n).toBe(0);
});

test("a stored coordinate agrees with the transform of its own UTM pair", async () => {
  /* The stored value must be reproducible from td_utm_e, td_utm_n and the
   * calibration. A row that was projected with the wrong zone is not. */
  const { rows: srids } = await client.query(
    `SELECT DISTINCT td_srid FROM parcels WHERE td_utm_e IS NOT NULL AND td_srid IS NOT NULL`);
  for (const { td_srid } of srids) {
    const cal = await loadCalibration(client, { srid: td_srid });
    const tf = calibratedTransform(cal, "ST_MakePoint(td_utm_e, td_utm_n)");
    const { rows } = await client.query(
      `SELECT count(*)::int n FROM parcels
        WHERE td_utm_e IS NOT NULL AND td_srid = $1
          AND (abs(td_lat - (${tf.latExpr})::float8) > 0.0002
            OR abs(td_lon - (${tf.lonExpr})::float8) > 0.0002)`, [td_srid]);
    expect(rows[0].n).toBe(0);
  }
});

test("the two SRIDs project to different longitudes for the same area", async () => {
  /* The whole bug in one assertion: a 24048 row projected as 24047 lands 6
   * degrees west. If the two ever agreed, the test above would pass while the
   * map was still wrong. */
  const { rows } = await client.query(
    `SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(281518, 1825129), 24048), 4326))::float8 AS a,
            ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(281518, 1825129), 24047), 4326))::float8 AS b`);
  expect(Math.abs(rows[0].a - rows[0].b)).toBeGreaterThan(5);
});

afterAll(async () => { await client.end(); });