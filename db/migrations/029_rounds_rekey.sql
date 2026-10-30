-- 029_rounds_rekey.sql
--
-- One round row, one owner.
--
-- auction_rounds was upserted by the ingest keyed on (lot_id, idx), while the
-- LED report sync appended rows at a scratch idx and then renumbered EVERY
-- round chronologically (applyCase's two-pass negated/ranked UPDATE). The
-- renumbering destroyed the ingest key: the next nightly run re-upserted
-- slots 1..8 over whatever the renumber had parked there — cross-cycle rounds
-- of a different sale order, report outcomes stamped over the lists labels —
-- and any row pushed past idx 8 was orphaned until the next renumber moved it
-- again. ผบ.2255/2562 (deed 166919: two lots, 20 rounds each, both orders'
-- 2026 dates interleaved with codes and labels from the other cycle) and the
-- date accumulation behind it are this one bug.
--
-- After this migration:
--
--   * the ingest is the lot's schedule owner. Dated rounds are keyed on
--     (lot_id, round_date); undated slot rows stay keyed on (lot_id, idx).
--     idx stops being display order — it is the lists slot number the row
--     came from, or NULL for report-inserted history. Readers order by
--     round_date, which is the timeline.
--   * the report sync only ever refreshes a date the lot already has (its
--     UPDATE keeps the lists label and code untouched) or inserts history
--     rows dated before the lot's first round — never renumbering.
--   * the ingest deletes its own source's rows whose date/slot is no longer
--     in the current lists payload (stale and cross-cycle rows die here).
--
-- led_label — the report's ผลการขาย for that (deed, date), next to rather
--   than instead of status_label: the lists page's SELL_STATUS[code] wording
--   stays what the schedule says, and the panel can pair the two lines.
-- source — which writer owns the row: 'lists' (the ingest; cleanupable) or
--   'report' (history the ingest's payload never carries; never deleted by it).

ALTER TABLE auction_rounds ADD COLUMN IF NOT EXISTS led_label text;

-- The backfill marks every legacy row 'lists': scraped_at defaulted to now()
-- for BOTH writers, so existing rows cannot be told apart after the fact —
-- the cross-cycle junk AND some genuine report-inserted history with it.
-- Resetting led_report_seen (heal, below) makes the per-case sync run again
-- the next time that case is browsed and re-add the history with
-- source='report' set. Junk rows are deleted by the ingest's cleanup, which
-- is the point.
DO $$
DECLARE had_source boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'auction_rounds' AND column_name = 'source')
      INTO had_source;
    IF NOT had_source THEN
        ALTER TABLE auction_rounds
            ADD COLUMN source text NOT NULL DEFAULT 'lists';
        UPDATE auction_lots SET led_report_seen = NULL;
    END IF;
END $$;

ALTER TABLE auction_rounds DROP CONSTRAINT IF EXISTS auction_rounds_lot_id_idx_key;
-- Report-inserted history rows carry no slot number.
ALTER TABLE auction_rounds ALTER COLUMN idx DROP NOT NULL;

-- The report's UPDATE-in-place works on this key, so a history row inserted
-- today is refreshed, never duplicated, if the same sheet is synced again.
CREATE UNIQUE INDEX IF NOT EXISTS rounds_dated_key
    ON auction_rounds (lot_id, round_date)
    WHERE round_date IS NOT NULL;

-- Undated slot rows only (verified: no duplicate (lot_id, round_date) rows
-- existed before this index, so it was never enforcing anything real).
CREATE UNIQUE INDEX IF NOT EXISTS rounds_undated_key
    ON auction_rounds (lot_id, idx)
    WHERE round_date IS NULL AND idx IS NOT NULL;

ALTER TABLE auction_rounds DROP CONSTRAINT IF EXISTS rounds_source_check;
ALTER TABLE auction_rounds
    ADD CONSTRAINT rounds_source_check CHECK (source IN ('lists', 'report'));
