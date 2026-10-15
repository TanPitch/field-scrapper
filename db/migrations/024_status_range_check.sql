-- 024_status_range_check.sql
--
-- Stop enumerating LED's status codes in the database.
--
-- The rounds_status check listed every code we happened to have seen, and LED
-- keeps introducing new ones: 22 turned up in ปราจีนบุรี, 19 in สระแก้ว, 8 in
-- บึงกาฬ. Each time the constraint rejected a row it aborted the whole province
-- ingest mid-run, and the scraped rows were lost even though the scrape itself
-- had succeeded.
--
-- LED prints "ไม่รู้จัก(รหัส N)" for most of these - the site does not document
-- them either. Only 22 has been confirmed by hand (งดขาย, ผบE.1648/2564).
-- Refusing to ingest a whole province because one round carries an
-- unrecognised code is the wrong trade: an unknown status should degrade to
-- an unknown label, not block the data.
--
-- The range check still does its real job, which is catching a garbage value
-- rather than curating a catalogue. pricing.js owns the label for each code and
-- falls back to a generic one for codes it has not seen.

ALTER TABLE auction_rounds DROP CONSTRAINT IF EXISTS rounds_status;

ALTER TABLE auction_rounds ADD CONSTRAINT rounds_status CHECK (
    status_code IS NULL OR status_code BETWEEN 0 AND 99
);