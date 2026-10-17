/* Integration tests for the coordinate queue against a real PostGIS database.
 *
 * The property that matters most here is negative: we must NEVER exceed a
 * public agency's 20/day limit. A fake DOL transport is injected so the quota,
 * ordering and verification rules can be exercised exhaustively without
 * spending a single real request.
 *
 *   DATABASE_URL=postgres://... bun test coordQueue.integration.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { enqueueUnresolved, claim, spendQuota, getQuota } from "./coordQueue.js";
import { run, classify } from "./resolveCoords.js";

const { Client } = pg;
const url = process.env.DATABASE_URL;

let client;
/** ids created by this file, so cleanup is precise */
const made = { parcels: [], lots: [] };

const ok = (over = {}) => ({
    found: true, status: "ok", lat: 16.4, lon: 102.8,
    areaSqWa: 400, landPrice: 5000, rai: 1, ngan: 0, wa: 0,
    landType: "ที่ดิน", office: "สำนักงานที่ดินขอนแก่น", ...over,
});

/** Deterministic fixture: only this file's parcels are ever in the queue, and
 *  the day's quota starts empty. Keeps a run from stamping fake coordinates
 *  onto the real ingested parcels. */
async function freshQueue() {
    await client.query(`DELETE FROM coord_queue`);
    await enqueueUnresolved(client, { only: made.parcels });
    await client.query(
        `DELETE FROM coord_queue WHERE parcel_id NOT IN (SELECT unnest($1::bigint[]))`,
        [made.parcels]);
    await client.query(`UPDATE dol_quota_ledger SET used=0, calls_ok=0, calls_failed=0`);
}

before(async () => {
    assert.ok(url, "DATABASE_URL must be set to run the integration tests");
    client = new Client({ connectionString: url });
    await client.connect();

    /* A previous interrupted run must not poison this one.
     *
     * Children before parents. This only ever held coord_queue, so it worked
     * until an interrupted run left its auction_lots behind - and then the
     * parcels delete raised a foreign key violation from auction_lots, the
     * before hook threw, and every test below then timed out at 5000 ms waiting
     * on a client that had already failed. All eleven failures were one missing
     * DELETE, not eleven bugs.
     *
     * Scoped to the 9900% fixture namespace, which is what this file owns. */
    const FIXTURE = `deed_number LIKE '9900%'`;
    await client.query(`DELETE FROM coord_queue WHERE parcel_id IN (SELECT id FROM parcels WHERE ${FIXTURE})`);
    await client.query(
        `DELETE FROM auction_rounds
          WHERE lot_id IN (SELECT l.id FROM auction_lots l
                             JOIN parcels p ON p.id = l.parcel_id WHERE p.${FIXTURE})`);
    await client.query(
        `DELETE FROM lot_images
          WHERE lot_id IN (SELECT l.id FROM auction_lots l
                             JOIN parcels p ON p.id = l.parcel_id WHERE p.${FIXTURE})`);
    await client.query(
        `DELETE FROM auction_lots
          WHERE parcel_id IN (SELECT id FROM parcels WHERE ${FIXTURE})`);
    await client.query(`DELETE FROM parcels WHERE ${FIXTURE}`);

    await client.query(`INSERT INTO provinces (code, name, dol_code)
                       VALUES (40, 'ขอนแก่น', 40) ON CONFLICT (code) DO NOTHING`);
    await client.query(`INSERT INTO districts (province_id, code, dol_code, name)
                       VALUES (40, 4016, 16, 'ภูเวียง')
                       ON CONFLICT (province_id, dol_code) DO NOTHING`);

    /* 25 parcels at three urgencies, plus:
         - one condo          -> must be skipped, never coordinate-resolved
         - one area mismatch  -> must be flagged mismatch, never verified */
    const day = 86_400_000;
    const iso = (d) => new Date(Date.now() + d * day).toISOString().slice(0, 10);
    const urgent = iso(3), medium = iso(20), far = iso(90);

    for (let i = 0; i < 25; i++) {
        const isCondo = i === 0;
        const isMismatch = i === 1;
        const round = i < 5 ? urgent : i < 15 ? medium : far;
        const { rows: [p] } = await client.query(
            `INSERT INTO parcels (province_code, district_dol_code, deed_number,
                                  land_title, land_title_raw, tumbol, district_name, province_name)
             VALUES (40, 16, $1, $2, $2, 'ภูเวียง', 'ภูเวียง', 'ขอนแก่น')
             RETURNING id`,
            [`9900${String(i).padStart(2, "0")}`, isCondo ? "น.ส.3ก." : "โฉนด"],
        );
        made.parcels.push(p.id);
        const { rows: [l] } = await client.query(
            `INSERT INTO auction_lots (parcel_id, case_no, case_year, first_round_date,
                                       order_number, order_sub, order_label, asset_type,
                                       size_unit, size_rai, size_ngan, size_wa, status)
             VALUES ($1, 'ผบTEST', 2569, $2, $3, 0, $4, $5, 'wa', $6, 0, 0, 'active')
             RETURNING id`,
            [p.id, round, 900 + i, String(900 + i),
             isCondo ? "ห้องชุด" : "ที่ดินว่างเปล่า",
             isMismatch ? 2 : 1],
        );
        made.lots.push(l.id);
        await client.query(
            `INSERT INTO auction_rounds (lot_id, idx, round_date, status_code)
             VALUES ($1, 1, $2, 0)`, [l.id, round]);
    }
});

after(async () => {
    if (!client) return;
    await client.query(
        `DELETE FROM field_provenance
          WHERE entity_type='parcel' AND entity_id = ANY($1)`, [made.parcels]);
    await client.query(`DELETE FROM coord_queue WHERE parcel_id = ANY($1)`, [made.parcels]);
    await client.query(`DELETE FROM auction_lots WHERE id = ANY($1)`, [made.lots]);
    await client.query(`DELETE FROM parcels WHERE id = ANY($1)`, [made.parcels]);
    await client.query(`UPDATE dol_quota_ledger SET used=0, calls_ok=0, calls_failed=0`);
    await client.end();
});

/* ------------------------------------------------------------- classify */

test("classify rejects condo and น.ส.3ก. outright", () => {
    const v = classify({ land_title: "น.ส.3ก.", asset_type: "ห้องชุด" }, ok());
    assert.equal(v.state, "skip");
    assert.equal(v.geoStatus, "mismatch");
});

test("classify verifies when areas agree", () => {
    const v = classify({ land_title: "โฉนด", size_unit: "wa", size_rai: 1 }, ok({ areaSqWa: 400 }));
    assert.equal(v.state, "resolve");
    assert.equal(v.geoStatus, "verified");
});

test("classify flags an area mismatch instead of verifying it", () => {
    const v = classify({ land_title: "โฉนด", size_unit: "wa", size_rai: 2 }, ok({ areaSqWa: 400 }));
    assert.equal(v.geoStatus, "mismatch");
    assert.match(v.note, /area differs/);
});

test("classify does not compare condo square metres against square wa", () => {
    const v = classify({ land_title: "โฉนด", size_unit: "sqm", size_wa: 35 }, ok({ areaSqWa: 400 }));
    assert.equal(v.geoStatus, "verified");
    assert.match(v.note, /not comparable/);
});

test("classify handles a not-found response", () => {
    const v = classify({ land_title: "โฉนด" }, { found: false, reason: "no such parcel" });
    assert.equal(v.state, "skip");
    assert.equal(v.geoStatus, "unresolved");
});

/* ---------------------------------------------------------------- queue */

test("enqueueUnresolved only queues parcels without coordinates", async () => {
    await client.query(`DELETE FROM coord_queue`);
    const rows = await enqueueUnresolved(client, { only: made.parcels });
    assert.ok(rows.length >= 25, `expected at least 25 queued, got ${rows.length}`);

    const { rows: done } = await client.query(
        `SELECT count(*)::int AS n FROM coord_queue WHERE state='done'`);
    assert.equal(done[0].n, 0);
});

test("claim respects the daily quota and never exceeds it", async () => {
    await freshQueue();

    const first = await claim(client, { max: 1000 });   // ask for far more than allowed
    assert.ok(first.claimed.length <= 20,
        `claimed ${first.claimed.length} — exceeded the 20/day limit`);
    assert.equal(first.claimed.length, 20);

    const second = await claim(client, { max: 20 });
    assert.equal(second.claimed.length, 0, "must not claim again once the quota is spent");
    assert.equal(second.stopped, "quota_exhausted");
});

test("claiming reserves quota so a concurrent run cannot over-claim", async () => {
    await freshQueue();
    await claim(client, { max: 1000 });
    const quota = await getQuota(client);
    assert.equal(Number(quota.used), 20,
        "the ledger must be debited at claim time, not at call time");
});

test("claim orders by soonest auction round", async () => {
    await freshQueue();

    const { claimed } = await claim(client, { max: 20 });
    const priorities = claimed.map((c) => c.priority);
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b),
        "claims must come back most-urgent-first");
    assert.ok(priorities[0] < 10, "the urgent parcels should lead the queue");
});

test("a parcel that already has coordinates is never re-queried", async () => {
    await freshQueue();
    const [target] = made.parcels;
    await client.query(`UPDATE parcels SET dol_lat=16.4, dol_lon=102.8 WHERE id=$1`, [target]);

    await client.query(`DELETE FROM coord_queue`);
    await enqueueUnresolved(client, { only: made.parcels });
    const { rows } = await client.query(
        `SELECT parcel_id FROM coord_queue WHERE parcel_id=$1`, [target]);
    assert.equal(rows.length, 0, "a parcel with coordinates must not be queued");

    await client.query(`UPDATE parcels SET dol_lat=NULL, dol_lon=NULL WHERE id=$1`, [target]);
});

test("spendQuota refuses to go past the limit", async () => {
    await client.query(`UPDATE dol_quota_ledger SET used=20`);
    await assert.rejects(
        () => spendQuota(client, { ok: true }),
        /dol_quota_within_limit|violates check constraint/i,
        "the ledger CHECK must reject an over-quota write",
    );
    await freshQueue();
});

/* ------------------------------------------------------------ end-to-end */

test("run() spends exactly the quota, then stops cleanly", async () => {
    await freshQueue();
    const stats = await run(client, async () => ok(), { max: 1000, delayMs: 0 });

    assert.ok(stats.attempted <= 20, `attempted ${stats.attempted} — over quota`);
    const quota = await getQuota(client);
    assert.equal(Number(quota.used), stats.attempted,
        "ledger must count every request actually made");
    assert.ok(Number(quota.used) <= 20);

    const { rows: [geom] } = await client.query(
        `SELECT count(*)::int AS n FROM parcels
          WHERE id = ANY($1) AND geom IS NOT NULL`, [made.parcels]);
    assert.ok(geom.n > 0, "successful lookups must store a geometry");
});

test("run() stops immediately when the service reports the quota is gone", async () => {
    await freshQueue();
    let calls = 0;
    const stats = await run(client, async () => {
        calls++;
        return { status: "quota_exhausted", message: "เกินจำกัด 20 /วัน" };
    }, { max: 20, delayMs: 0 });

    // One request was made — unavoidable, the service only reveals the limit by
    // refusing. Nothing may be resolved and no further request may follow.
    assert.equal(stats.attempted, 1, "the refusing call still counts as attempted");
    assert.equal(stats.resolved, 0, "nothing may be resolved from a refusal");
    assert.equal(stats.stopped, "quota_exhausted");
    assert.equal(calls, 1, "must stop after the first refusal, not keep calling");
});

test("run() records provenance for every coordinate it stores", async () => {
    const { rows } = await client.query(
        `SELECT field_name FROM field_provenance
          WHERE entity_type='parcel' AND entity_id = ANY($1) AND source_key='dol'
          GROUP BY 1`, [made.parcels]);
    const fields = rows.map((r) => r.field_name);
    assert.ok(fields.includes("dol_lat"), "dol_lat must be attributed to กรมที่ดิน");
    assert.ok(fields.includes("dol_lon"), "dol_lon must be attributed to กรมที่ดิน");
});

test("run() never coordinates a condo parcel", async () => {
    await freshQueue();
    const condoIds = made.parcels.filter((_, i) => i === 0);
    await run(client, async () => ok(), { max: 1000, delayMs: 0 });
    const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM parcels
          WHERE id = ANY($1) AND geo_status = 'verified'`, [condoIds]);
    assert.equal(rows[0].n, 0, "a condo unit number must never be marked verified");
});
