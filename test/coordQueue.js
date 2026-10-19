/* coordQueue.js — resolve LED parcels to map coordinates within a public quota.
 *
 * กรมที่ดิน's anonymous tier allows 20 lookups/day. That is a limit we respect,
 * not route around. So the job is to spend those 20 well:
 *
 *   1. never look up a parcel we already hold coordinates for
 *   2. order by soonest upcoming auction round — a coordinate is only worth
 *      having while the lot is still sellable
 *   3. stop when the day's quota is spent rather than retry into a wall
 *   4. back off on failure instead of hammering a public service
 *
 * The decision logic is pure and separately tested; the DB calls are thin
 * wrappers, so the rules can be verified without a database.
 */

const DAY_MS = 86_400_000;

/**
 * Accept either a bare date or a full timestamp and return that instant.
 * Appending "T00:00:00Z" blindly to a value that already carries a time
 * yields an invalid Date, which silently collapsed into the 9999 sentinel — so
 * the two shapes are distinguished rather than assumed.
 */
function asDate(value) {
    if (!value) return null;
    const s = String(value).trim();
    const d = new Date(/[T ]\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : `${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

const midnightUTC = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/* ------------------------------------------------------------ pure helpers */

/**
 * Urgency in days until the parcel's next auction round.
 * 0 = today, negative = the round has passed, 9999 = nothing scheduled.
 *
 * Ranked by DAY, so the time of day is normalised away — otherwise a round at
 * 23:30 on the 13th scored as "2 days away" when the 13th is 1 day away, and
 * the most urgent lots would sort behind less urgent ones.
 */
export function computePriority(nextRoundDate, today = new Date()) {
    const t = asDate(nextRoundDate);
    if (!t) return 9999;
    return Math.round((midnightUTC(t) - midnightUTC(today)) / DAY_MS);
}

/** Soonest upcoming round across all active lots for a parcel. */
export function pickNextRound(rounds, { today = new Date() } = {}) {
    const base = midnightUTC(today);
    const future = (rounds ?? [])
        .map((r) => asDate(r))
        .filter((d) => d && midnightUTC(d) >= base)
        .sort((a, b) => midnightUTC(a) - midnightUTC(b));
    return future.length ? future[0].toISOString().slice(0, 10) : null;
}

/**
 * How many lookups we may still make today.
 * The ledger CHECK also enforces this, so a bug here cannot over-call — it
 * would fail the insert rather than exceed the quota.
 */
export function quotaRemaining(status = {}) {
    const u = Number(status?.used) || 0;
    const l = Number(status?.limit_value ?? status?.limit) || 0;
    return Math.max(0, l - u);
}

/** Exponential backoff, capped, so a failing parcel stops consuming attempts. */
export function backoffMs(attempts, { base = 60_000, cap = 6 * 3_600_000 } = {}) {
    const n = Math.max(1, Number(attempts) || 1);
    return Math.min(cap, base * 2 ** (n - 1));
}

export function isQuotaExhausted(status) {
    return status === "quota_exhausted" || status === "limit";
}

/* -------------------------------------------------------------- DB helpers */

/** Read (or create) today's ledger row. */
export async function getQuota(client, { date, limit = 20 } = {}) {
    const r = await client.query(
        `INSERT INTO dol_quota_ledger (quota_date, limit_value)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2)
         ON CONFLICT (quota_date) DO UPDATE SET quota_date = EXCLUDED.quota_date
         RETURNING quota_date, used, limit_value, first_call_at, last_call_at,
                   calls_ok, calls_failed`,
        [date ?? null, limit],
    );
    return r.rows[0];
}

/**
 * Queue every parcel that has no coordinates yet, prioritised by its soonest
 * upcoming round. Idempotent: re-running updates priority and leaves done rows
 * alone.
 *
 * "No coordinates" means none from *any* source - td_lat IS NULL AND dol_lat IS
 * NULL, the same order the API reads them in (geom, then TD, then DOL). It used
 * to test dol_lat alone, on the assumption that only DOL placed a point. TD does
 * most of the work: 5,192 of 5,657 parcels carry a td_lat and six carry a
 * dol_lat, so that predicate queued 5,651 parcels of which 5,186 already stood
 * on the map. A queue that size is not a backlog, it is the whole database, and
 * a worker would spend DOL's 20 calls a day re-resolving land that was never
 * missing.
 *
 * `only` narrows it to a set of parcel ids. It exists for the integration
 * tests, which run against the real dev database and would otherwise enqueue
 * every unresolved parcel in it - 5000 rows, 8.5 seconds, past bun's 5s default,
 * so all of them reported as timeouts. Scoping to the fixture is both faster
 * and what the test file says it wanted.
 */
export async function enqueueUnresolved(client, { limit = 5000, only = null } = {}) {
    /* $2 is a bigint[]; passing null means "no filter", and `id = ANY(null)`
       is null for every row, which would queue nothing at all. */
    const scope = only == null ? '' : 'AND p.id = ANY($2::bigint[])';
    const { rows } = await client.query(
        `
        WITH urgency AS (
            SELECT p.id AS parcel_id,
                   CASE WHEN (
                       SELECT min(r.round_date)
                         FROM auction_lots l
                         JOIN auction_rounds r ON r.lot_id = l.id
                        WHERE l.parcel_id = p.id
                          AND l.status = 'active'
                          AND r.round_date >= CURRENT_DATE
                   ) IS NULL THEN 9999
                   ELSE (
                       SELECT min(r.round_date)
                         FROM auction_lots l
                         JOIN auction_rounds r ON r.lot_id = l.id
                        WHERE l.parcel_id = p.id
                          AND l.status = 'active'
                          AND r.round_date >= CURRENT_DATE
                   ) - CURRENT_DATE END AS priority
              FROM parcels p
             WHERE p.td_lat IS NULL AND p.dol_lat IS NULL
              ${scope}
              LIMIT $1
        )
        INSERT INTO coord_queue (parcel_id, state, priority, priority_at)
        SELECT parcel_id, 'pending', priority, now() FROM urgency
        ON CONFLICT (parcel_id) DO UPDATE
            SET priority = EXCLUDED.priority,
                priority_at = EXCLUDED.priority_at,
                -- a resolved parcel is never reopened; one that failed goes
                -- back to pending only once its backoff has elapsed
                state = CASE WHEN coord_queue.state = 'done' THEN 'done'
                             WHEN coord_queue.state IN ('failed','skipped')
                                  AND coord_queue.next_attempt_at <= now() THEN 'pending'
                             ELSE coord_queue.state END,
                next_attempt_at = CASE WHEN coord_queue.state IN ('failed','skipped')
                                           AND coord_queue.next_attempt_at <= now()
                                      THEN now() ELSE coord_queue.next_attempt_at END
        RETURNING parcel_id, priority, state`,
        /* Postgres rejects a bind message with more values than the statement
           has placeholders: 08P01, "bind message supplies 2 parameters, but
           prepared statement requires 1". So the scope parameter only travels
           when the scope clause is actually in the SQL. */
        scope ? [limit, only] : [limit],
    );
    return rows;
}

/**
 * Claim at most `quotaRemaining` parcels, most urgent first, AND RESERVE that
 * much of today's quota in the same call.
 *
 * The reservation matters. An earlier version only *read* the ledger here, so a
 * second worker — or a second call before the first had spent anything — could
 * claim another full day of lookups. Reserving at claim time means the only
 * failure direction is under-using the quota, which is the safe one.
 */
export async function claim(client, { max = 20 } = {}) {
    const quota = await getQuota(client);
    const allowed = Math.min(max, quotaRemaining(quota));
    if (allowed <= 0) return { claimed: [], quota, stopped: "quota_exhausted" };

    const { rows } = await client.query(
        `UPDATE coord_queue q
            SET state = 'inflight',
                attempts = q.attempts + 1
           FROM (SELECT c.parcel_id FROM coord_queue c
                  WHERE c.state = 'pending' AND c.next_attempt_at <= now()
                  ORDER BY c.priority ASC, c.parcel_id ASC
                  LIMIT $1
                  FOR UPDATE SKIP LOCKED) pick
          WHERE q.parcel_id = pick.parcel_id
        RETURNING q.parcel_id, q.attempts, q.priority`,
        [allowed],
    );

    /* Only reserve what was actually claimed — a queue shorter than the quota
       must not burn the difference. */
    if (rows.length) {
        await client.query(
            `UPDATE dol_quota_ledger
                SET used = used + $1,
                    first_call_at = COALESCE(first_call_at, now())
              WHERE quota_date = CURRENT_DATE`,
            [rows.length],
        );
    }

    /* Hydrate the claims with what the lookup needs. Done after the claim so
       the FOR UPDATE SKIP LOCKED window stays short — holding row locks across
       a join against four tables would serialise the workers.
           *
           * province_code is the กรมที่ดิน code, not LED's: the two agree for
           * all but one province, where LED says 97 and กรมที่ดิน says 38, and
           * asking for 97 returns nothing for every deed in it. It pairs with
           * district_dol_code, which is already a กรมที่ดิน code. */
    if (rows.length) {
        const ids = rows.map((r) => r.parcel_id);
        const { rows: detail } = await client.query(
            `SELECT p.id AS parcel_id, pr.dol_code AS province_code, p.district_dol_code,
                    p.deed_number, p.land_title, p.tumbol,
                    l.size_unit, l.size_rai, l.size_ngan, l.size_wa, l.asset_type
               FROM parcels p
               JOIN provinces pr ON pr.code = p.province_code
               LEFT JOIN LATERAL (
                    SELECT size_unit, size_rai, size_ngan, size_wa, asset_type
                      FROM auction_lots
                     WHERE parcel_id = p.id AND status = 'active'
                     ORDER BY next_round_date ASC NULLS LAST, id DESC
                     LIMIT 1
               ) l ON true
              WHERE p.id = ANY($1)`,
            [ids],
        );
        const byId = new Map(detail.map((d) => [d.parcel_id, d]));
        for (const r of rows) Object.assign(r, byId.get(r.parcel_id) ?? {});
    }

    /* UPDATE ... RETURNING does not preserve the subquery's ORDER BY, so the
       rows come back in whatever order the update touched them. Re-sorting
       matters functionally: if the day's quota runs out partway through, the
       lots already resolved must be the most urgent ones. */
    rows.sort((a, b) => a.priority - b.priority || a.parcel_id - b.parcel_id);

    const after = await getQuota(client);
    return { claimed: rows, quota: after, stopped: rows.length < allowed ? "queue_empty" : null };
}

/** Record a successful lookup and store what it produced. */
export async function resolve(client, parcelId, dol, { geoStatus = "verified", note = null } = {}) {
    await client.query(
        `UPDATE parcels SET
            dol_status = $2, dol_land_type = $3, dol_office = $4, dol_land_price = $5,
            dol_rai = $6, dol_ngan = $7, dol_wa = $8,
            dol_lat = $9::double precision, dol_lon = $10::double precision,
            dol_checked_at = now(),
            geo_status = $11, geo_note = $12,
            geom = CASE
                     WHEN $9::double precision IS NOT NULL AND $10::double precision IS NOT NULL
                     THEN ST_SetSRID(
                              ST_MakePoint($10::double precision, $9::double precision),
                              4326
                          )::geography
                     ELSE parcels.geom
                   END
          WHERE id = $1`,
        [parcelId, dol.status ?? "ok", dol.landType ?? null, dol.office ?? null,
         dol.landPrice ?? null, dol.rai ?? null, dol.ngan ?? null, dol.wa ?? null,
         dol.lat ?? null, dol.lon ?? null, geoStatus, note],
    );
    await client.query(
        `UPDATE coord_queue SET state = 'done', resolved_at = now(),
                last_error = NULL, next_attempt_at = now()
          WHERE parcel_id = $1`,
        [parcelId],
    );
}

/** Record a failed lookup and schedule the retry. */
export async function fail(client, parcelId, error, { maxAttempts = 5 } = {}) {
    const { rows } = await client.query(
        `UPDATE coord_queue
            SET state = CASE WHEN attempts >= $3 THEN 'skipped' ELSE 'failed' END,
                last_error = $2,
                next_attempt_at = now() + ($4 || 'milliseconds')::interval
          WHERE parcel_id = $1
        RETURNING state, attempts, next_attempt_at`,
        [parcelId, String(error).slice(0, 500), maxAttempts, String(backoffMs(1))],
    );
    return rows[0] ?? null;
}

/**
 * Spend one unit of today's quota. The ledger's CHECK constraint makes an
 * over-count impossible: the INSERT raises instead of letting a caller exceed
 * 20/day by accident.
 */
export async function spendQuota(client, { ok = true } = {}) {
    const { rows } = await client.query(
        `UPDATE dol_quota_ledger
            SET used = used + 1,
                last_call_at = now(),
                first_call_at = COALESCE(first_call_at, now()),
                calls_ok = calls_ok + CASE WHEN $1 THEN 1 ELSE 0 END,
                calls_failed = calls_failed + CASE WHEN $1 THEN 0 ELSE 1 END
          WHERE quota_date = CURRENT_DATE
        RETURNING used, limit_value, calls_ok, calls_failed`,
        [ok],
    );
    return rows[0] ?? null;
}

export async function startRun(client) {
    const quota = await getQuota(client);
    const { rows: q } = await client.query(
        `SELECT count(*)::int AS queued_before FROM coord_queue WHERE state IN ('pending','failed')`,
    );
    const { rows } = await client.query(
        `INSERT INTO coord_runs (quota_date, quota_used, quota_limit, queued_before)
         VALUES (CURRENT_DATE, $1, $2, $3) RETURNING id`,
        [quota.used, quota.limit_value, q[0].queued_before],
    );
    return rows[0].id;
}

export async function finishRun(client, runId, stats) {
    await client.query(
        `UPDATE coord_runs SET finished_at = now(), attempted = $2, resolved = $3,
                mismatched = $4, failed = $5, skipped = $6, stopped_reason = $7
          WHERE id = $1`,
        [runId, stats.attempted ?? 0, stats.resolved ?? 0, stats.mismatched ?? 0,
         stats.failed ?? 0, stats.skipped ?? 0, stats.stopped ?? null],
    );
}
