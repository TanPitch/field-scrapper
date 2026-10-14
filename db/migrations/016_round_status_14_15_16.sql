-- 016_round_status_14_15_16.sql
--
-- Codes 14, 15 and 16 are all plain งดขาย - confirmed by hand against the LED
-- listing after it printed "ไม่รู้จัก(รหัส N)" for each. They are distinct from
-- code 3 (งดขายไม่มีผู้สู้ราคา): no discount attaches to them, so only the
-- constraint had to learn they exist. The labels live in pricing.js.
--
-- The second half renames code 6's close_reason from 'seizure_revoked' to
-- 'withdrawn'. ถอนการยึด is not a failed sale, it is a listing LED takes down,
-- and 'withdrawn' is already the word the API, the layers and the UI use for
-- exactly that state - only pricing.js disagreed. Renaming the value (rather
-- than the column or the enum) keeps the old rows readable and makes the next
-- query agree with the frontend.

ALTER TABLE auction_rounds
    DROP CONSTRAINT IF EXISTS rounds_status;
ALTER TABLE auction_rounds
    ADD CONSTRAINT rounds_status
    CHECK (status_code IS NULL OR status_code IN (0,1,3,4,6,7,10,12,13,14,15,16,23,26));

UPDATE auction_rounds SET status_label = 'งดขาย' WHERE status_code IN (14,15,16);

UPDATE auction_lots SET close_reason = 'withdrawn' WHERE close_reason = 'seizure_revoked';

-- Lets the UI ask "which lots came off LED, and when" without scanning codes.
CREATE INDEX IF NOT EXISTS auction_lots_withdrawn_idx
    ON auction_lots (closed_at DESC)
    WHERE close_reason = 'withdrawn';