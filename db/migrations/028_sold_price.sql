-- 028_sold_price.sql
--
-- LED's reports.asp answer sheet is the sold-price source. A round's price
-- column holds the scheduled (ประกาศ) figure — ผบE.390/2568 shows 1,185,780 in
-- every round while LED's report prints the winning bid 1,540,000 — so the
-- real sale must come from the report, stored next to the ladder it corrects.
--
--   auction_rounds.sold_price  — the report's ราคาขายได้ for that (deed,date),
--                                NULL for rounds that never sold
--   auction_lots.sold_price    — the lot's winning bid (its latest sold round)
--   auction_lots.led_report_seen — when the report for this lot's case was last
--                                pulled & applied; NULL marks a case still to
--                                sync (bulk endpoint picks rows by this)
--
-- The sync itself (server/ledReport.js) also refreshes status_label from the
-- report's ผลการขาย and fills rounds the ingest never saw (the history rows of
-- suspend-and-relater cases like ผบ.2545/2562). Both write into existing
-- columns, so nothing here but the new ones.

ALTER TABLE auction_rounds
    ADD COLUMN IF NOT EXISTS sold_price numeric(14,2);

ALTER TABLE auction_lots
    ADD COLUMN IF NOT EXISTS sold_price numeric(14,2),
    ADD COLUMN IF NOT EXISTS led_report_seen timestamptz;

-- The stock admin sync scans this, repeatedly; the partial index keeps it
-- cheap while the lap fills.
CREATE INDEX IF NOT EXISTS auction_lots_report_pending_idx
    ON auction_lots (case_no, case_year)
    WHERE led_report_seen IS NULL;
