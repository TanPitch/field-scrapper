-- 031_ns3k_drop.sql — delete every น.ส.3ก. parcel from the database.
--
-- A น.ส.3ก. is a room or a shop on land whose โฉนด someone else holds. TD keeps
-- the class on its own NS3K layer and LED never prints a coordinate for one, so
-- the map cannot place them and the features payload has been filtering them
-- out since they were parked (the 196 + 2 rows with geo_note explaining the
-- park). The decision as of 2026-11-03: parking is not the right state — the
-- rows are deleted, and the LED lists ingest skips the class outright
-- (ingest.js), so no bot run can re-create them.
--
-- auction_lots references parcels WITHOUT a cascade, so its rows go first;
-- auction_rounds, lot_images and every lot child table have ON DELETE CASCADE
-- off lots, and coordinate_queue off parcels.
--
-- Rerunnable: the DELETEs match nothing after the first run.

BEGIN;

DELETE FROM auction_lots l
  USING parcels p
  WHERE l.parcel_id = p.id
    AND p.land_title ILIKE 'น.ส.3ก%';

DELETE FROM parcels WHERE land_title ILIKE 'น.ส.3ก%';

COMMIT;
