-- 017_td_area_codes.sql
--
-- TD (assessprice.treasury.go.th) publishes its own admin codes through
-- SP=LUT_Q_BND on DataService.svc, and they are NOT the same as LED's:
--
--   * province codes agree everywhere except บึงกาฬ (LED 97, TD 38)
--   * district codes are renumbered independently, and can be letter-suffixed
--     or missing entirely - LED omits พลอยแหวน, TD never had it
--   * TD DOES publish subdistricts, which we had assumed it did not
--
-- districts already carries dol_code; subdistricts did not, because until now
-- we only had LED's numbering for that level. Both now hold their own system's
-- code so a lot can be looked up in either place without guessing.
--
-- The join is on NAME within a province, never on code - the numbers are not
-- comparable, and a code join would silently file live lots under a district
-- that no longer exists.

ALTER TABLE subdistricts ADD COLUMN IF NOT EXISTS dol_code text;

-- districts.dol_code was NOT NULL, which makes a rebuild impossible: clearing it
-- to '' collides on UNIQUE (province_id, dol_code) the moment two districts are
-- unmatched (Bangkok has 64 LED districts against ~50 in TD). NULL means "LED
-- has this, TD does not", and Postgres permits any number of NULLs under a
-- unique index, so the whole match can be re-derived from TD on every run.
ALTER TABLE districts ALTER COLUMN dol_code DROP NOT NULL;

COMMENT ON COLUMN districts.dol_code   IS '2-digit TD AMPH_CODE within the province; not comparable to districts.code (LED 4-digit amphurId)';
COMMENT ON COLUMN subdistricts.dol_code IS 'TD TUMB_CODE; not comparable to subdistricts.code (LED 5-digit district-scoped)';

-- Matching is by name, so index what the join actually reads.
CREATE INDEX IF NOT EXISTS districts_name_idx    ON districts (province_id, name);
CREATE INDEX IF NOT EXISTS subdistricts_name_idx ON subdistricts (district_id, name);