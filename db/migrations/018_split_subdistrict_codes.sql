-- 018_split_subdistrict_codes.sql
--
-- subdistricts.code held TWO numbering schemes in one column:
--
--   83000, 83110, 83150   LED's 5-digit, district-scoped tambon code
--   95, 96, 97, 98, 99   กรมการปกครอง eva_area_grade code, written by ingest
--
-- They collide constantly (both are unique per district) and cannot both be
-- right, so matching against TD silently failed: a ภูเก็ต row holding 96 was
-- compared as if 96 were LED's code, and 5 of 6 subdistricts found no partner.
--
-- Three systems, three columns. Only the unique indexes needed changing -
-- (district_id, <code>) stays unique per column because a code is unique per
-- district within its own system.
--
-- Backfill is safe because the two schemes are distinguishable by shape: LED
-- codes are 5 digits beginning with the province code, eva codes are short.
-- Anything not matching that shape stays NULL rather than being guessed at.

ALTER TABLE subdistricts ADD COLUMN IF NOT EXISTS led_code text;
ALTER TABLE subdistricts ADD COLUMN IF NOT EXISTS eva_code text;

-- Backfill is only safe while the mixed `code` column still exists. It is
-- dropped at the end, so this block is a one-shot recovery path: on a database
-- that has already run this migration, re-run ledAreaCodes.js instead, which
-- is authoritative and re-fetches LED rather than inferring from old values.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'subdistricts' AND column_name = 'code'
    ) THEN
        -- LED: 5 digits whose first two are this district's province code.
        UPDATE subdistricts s
           SET led_code = s.code
          FROM districts d
         WHERE d.id = s.district_id
           AND s.code ~ '^[0-9]{5}$'
           AND left(s.code, 2) = right(d.province_id::text, 2);

        -- Everything else that has a code is eva_area_grade's.
        UPDATE subdistricts SET eva_code = code
         WHERE code IS NOT NULL AND led_code IS NULL AND eva_code IS NULL;
    END IF;
END $$;

ALTER TABLE subdistricts DROP CONSTRAINT IF EXISTS subdistricts_code_idx;

ALTER TABLE subdistricts DROP CONSTRAINT IF EXISTS subdistricts_district_id_code_key;

-- Partial UNIQUE constraints are only expressible as indexes: ADD CONSTRAINT
-- ... UNIQUE (cols) WHERE ... is a syntax error, so these are indexes. Postgres
-- permits any number of NULLs under a unique index, which is what lets an
-- unmatched subdistrict coexist with the others in its district.
CREATE UNIQUE INDEX IF NOT EXISTS subdistricts_led_code_idx
    ON subdistricts (district_id, led_code) WHERE led_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subdistricts_eva_code_idx
    ON subdistricts (district_id, eva_code) WHERE eva_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subdistricts_dol_code_idx
    ON subdistricts (district_id, dol_code) WHERE dol_code IS NOT NULL;

ALTER TABLE subdistricts DROP COLUMN code;

COMMENT ON COLUMN subdistricts.led_code IS 'LED tambon code, 5-digit district-scoped (83000)';
COMMENT ON COLUMN subdistricts.eva_code IS 'กรมการปกครอง eva_area_grade tambon code, 2-digit (96)';
COMMENT ON COLUMN subdistricts.dol_code IS 'TD TUMB_CODE within the district';

-- Matching resolves by NAME within a district, so index what the join reads.
CREATE INDEX IF NOT EXISTS subdistricts_name_idx ON subdistricts (district_id, name);