-- 008_bot_activity.sql — what the scraper is doing, for the frontend status page.
--
-- The bots run out of band (nightly cron, a manual province run, an enrichment
-- pass). Nothing about them is visible over HTTP unless it is written down
-- first, so each pass records itself here and the API serves the result.
--
-- A run row is created when work starts and completed in place when it ends. A
-- row whose finished_at is still null therefore means "running", which is the
-- one thing the status page most needs to say, and it must not be filtered out.

BEGIN;

-- Which pass this is. scrape_runs was named for scraping but now also records
-- enrichment, image fetches and reference loads.
ALTER TABLE scrape_runs
    ADD COLUMN IF NOT EXISTS stage       text NOT NULL DEFAULT 'scrape',
    ADD COLUMN IF NOT EXISTS run_key     text,
    ADD COLUMN IF NOT EXISTS detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_step   text,
    ADD COLUMN IF NOT EXISTS started_at_t timestamptz DEFAULT now();

-- started_at_t is set when work begins and left alone. started_at is kept for
-- the original history; where they disagree, started_at_t is the true start.

-- Dropped first so re-applying this migration is a no-op rather than an error.
ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_stage_check;
ALTER TABLE scrape_runs
    ADD CONSTRAINT scrape_runs_stage_check
    CHECK (stage IN ('scrape', 'enrich_td', 'enrich_coord', 'images', 'reference', 'other'));

-- The scheduler may start the same province twice (nightly run overlapping a
-- manual one). run_key identifies one logical pass so the UI can show that,
-- rather than silently presenting two passes as one.
CREATE UNIQUE INDEX IF NOT EXISTS scrape_runs_run_key_idx
    ON scrape_runs (run_key)
    WHERE run_key IS NOT NULL;

-- Drives the "running now" query and the per-province history list.
CREATE INDEX IF NOT EXISTS scrape_runs_activity_idx
    ON scrape_runs (stage, started_at_t DESC);

COMMENT ON TABLE scrape_runs IS
    'One row per bot pass. finished_at IS NULL means the pass is still running (or crashed mid-pass).';
COMMENT ON COLUMN scrape_runs.detail IS
    'Free-form per-pass payload: rows written, images stored, match counts, error samples.';
COMMENT ON COLUMN scrape_runs.last_step IS
    'Human-readable current step, e.g. ''page 41/112'' or ''TD lookup โคกงาม''. Shown live in the UI.';

COMMIT;
