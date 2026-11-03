-- 030_parcel_error_review.sql — admin-reviewed "error data" verdict on a gap parcel.
--
-- ข้อมูลตกหล่น shows the parcels every resolver pass could not place. A human
-- reviewer can now close a row without a coordinate: the tile the deed points
-- at may simply be wrong (wrong deed number, wrong land, agency blind spot),
-- and guessing coordinates would seed a lie into the map. This column is that
-- reviewed-verdict marker.
--
-- Effect elsewhere:
--   server/index.js features payload — rows marked here are excluded, so the
--   map and the bottom table stop selling a parcel the reviewer says is bad.
--   ข้อมูลตกหล่น hide them behind its [error] filter chip instead of deleting
--   them from the admin's view.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, no rewrite of existing rows.

BEGIN;

ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS reviewed_error boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN parcels.reviewed_error IS
    'Admin reviewed this unresolvable parcel and marked it as erroneous data: hidden from the features payload (map/table), listed only under the error filter in admin coord-gaps.';

COMMIT;
