-- 005: coordinate resolution queue + กรมที่ดิน quota ledger.
--
-- The last quota-bound step. กรมที่ดิน's anonymous tier allows 20 lookups/day
-- and that is a hard limit we respect, not work around. So the job here is to
-- spend those 20 well:
--
--   * never look up a parcel we already have coordinates for
--   * order the queue by the soonest upcoming auction round, because a
--     coordinate is only worth having while the lot is still sellable
--   * stop for the day when the quota is spent, rather than burning requests on
--     retries that will fail anyway
--
-- This is ordinary respectful use of a public service: 20 requests/day,
-- sequential, never re-querying.

BEGIN;

-- ------------------------------------------------------------- quota ledger

CREATE TABLE dol_quota_ledger (
    quota_date    date PRIMARY KEY DEFAULT CURRENT_DATE,
    used          integer NOT NULL DEFAULT 0,
    limit_value   integer NOT NULL DEFAULT 20,
    first_call_at timestamptz,
    last_call_at  timestamptz,
    calls_ok      integer NOT NULL DEFAULT 0,
    calls_failed  integer NOT NULL DEFAULT 0,
    notes         text,
    CONSTRAINT dol_quota_nonneg CHECK (used >= 0 AND calls_ok >= 0 AND calls_failed >= 0),
    CONSTRAINT dol_quota_within_limit CHECK (used <= limit_value)
);

COMMENT ON TABLE dol_quota_ledger IS
    'One row per day. The CHECK is the point: an over-quota write fails loudly instead of quietly hammering a public service.';

-- ------------------------------------------------------------- resolve queue

CREATE TABLE coord_queue (
    parcel_id        bigint PRIMARY KEY REFERENCES parcels(id) ON DELETE CASCADE,
    state            text NOT NULL DEFAULT 'pending',
    -- days until the parcel's soonest upcoming auction round; 0 = today,
    -- negative = already finished. Recomputed when the queue is claimed, because
    -- a lot's urgency changes every day as rounds are held.
    priority         integer NOT NULL DEFAULT 9999,
    priority_at      timestamptz,
    attempts         integer NOT NULL DEFAULT 0,
    last_error       text,
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    queued_at        timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,
    CONSTRAINT coord_state CHECK (state IN ('pending','inflight','done','failed','skipped'))
);

-- The claim query: pending, not backed off, ordered by urgency.
CREATE INDEX coord_queue_claim_idx ON coord_queue (priority, parcel_id)
    WHERE state = 'pending';
CREATE INDEX coord_queue_retry_idx ON coord_queue (next_attempt_at)
    WHERE state IN ('failed','pending');

COMMENT ON COLUMN coord_queue.state IS
    'pending=waiting, inflight=claimed by a worker, done=coordinates stored, failed=retry with backoff, skipped=condo or unresolvable.';

-- What the last run achieved, so a daily run is auditable at a glance.
CREATE TABLE coord_runs (
    id            bigserial PRIMARY KEY,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    quota_date    date NOT NULL DEFAULT CURRENT_DATE,
    quota_used    integer,
    quota_limit   integer,
    queued_before integer,
    attempted     integer NOT NULL DEFAULT 0,
    resolved      integer NOT NULL DEFAULT 0,
    mismatched    integer NOT NULL DEFAULT 0,
    failed        integer NOT NULL DEFAULT 0,
    skipped       integer NOT NULL DEFAULT 0,
    stopped_reason text,
    notes         text
);

CREATE INDEX coord_runs_date_idx ON coord_runs (quota_date DESC);

COMMIT;
