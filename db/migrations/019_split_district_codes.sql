-- 019_split_district_codes.sql
--
-- districts.dol_code carried two different systems' codes, exactly like
-- subdistricts.code did:
--
--   ledAreaCodes.js wrote LED's 2-digit code (amphurId's last two digits)
--   tdAreaCodes.js  wrote TD's own AMPH_CODE
--
-- They coincide in most provinces only because both are derived from the same
-- amphurId suffix. Where they genuinely differ the two loaders fight: after TD
-- matching set คลองสามวา to TD 46, re-running the LED loader tried to insert
-- LED 52 against code 1052, missed its ON CONFLICT (province_id, dol_code)
-- target and died on UNIQUE (province_id, code).
--
-- Split the same way as subdistricts:
--   code     4-digit LED amphurId   8301
--   dol_code 2-digit LED suffix      01   (LED's own view, matches code)
--   td_code  2-digit TD AMPH_CODE    03   (TD renumbers independently)
--
-- districts.dol_code currently holds TD values, so they are migrated to
-- td_code before dol_code is redefined as LED's.

ALTER TABLE districts ADD COLUMN IF NOT EXISTS td_code smallint;

UPDATE districts SET td_code = dol_code WHERE td_code IS NULL;

-- Every LED district has a dol_code, so anything still NULL was never matched
-- by TD. Those must not inherit a bogus LED value.
UPDATE districts SET dol_code = NULL WHERE dol_code = td_code;

CREATE UNIQUE INDEX IF NOT EXISTS districts_td_code_idx
    ON districts (province_id, td_code) WHERE td_code IS NOT NULL;

COMMENT ON COLUMN districts.code     IS 'LED amphurId, 4-digit concatenation of province and district';
COMMENT ON COLUMN districts.dol_code IS 'LED 2-digit district suffix, the last two digits of code';
COMMENT ON COLUMN districts.td_code  IS 'TD AMPH_CODE; renumbered independently, NULL when TD has no such district';