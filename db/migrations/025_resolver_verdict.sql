-- 025_resolver_verdict.sql
--
-- A resolver that returns a row has not necessarily answered the right one.
-- TD takes a bare CHANOD_NO and returns every parcel in the province carrying
-- that deed number: deed 12329 in บึงกาฬ returns three, in เซกา, เมืองบึงกาฬ and
-- ศรีวิไล. Choosing wrongly produced 7 บึงกาฬ parcels placed in the wrong
-- district, all of them "resolved" as far as the UI could tell.
--
-- So the outcome is recorded, not just its existence:
--   match              the parcel sits in the district our map resolved
--   district_mismatch  a row came back, none in the district we asked for
--   no_result          TD holds no record of this deed in this province
--
-- Only 'match' is user-facing. The other two are an admin's problem, not a
-- user's: a marker in the wrong district is worse than no marker, and a parcel
-- at lat/lng 0 is worse still.

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS td_verdict text;

COMMENT ON COLUMN parcels.td_verdict IS
    'match | district_mismatch | no_result. Only match is shown on the map or in the table.';

CREATE INDEX IF NOT EXISTS parcels_td_verdict_idx ON parcels (td_verdict);

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS dol_verdict text;

COMMENT ON COLUMN parcels.dol_verdict IS 'Same three verdicts for the DOL fallback.';