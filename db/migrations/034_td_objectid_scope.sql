-- 034_td_objectid_scope.sql
--
-- TD's OBJECTID comes from each province's own map layer, so it is unique
-- ONLY WITHIN a province. Two provinces handing out the same OBJECTID is not
-- the same land: on 2026-11-07 the bot2 TD stage died on
--   duplicate key value violates unique constraint "parcels_td_object_id_key"
--   Key (td_object_id)=(5841515) already exists
-- where 5841515 was legitimately stamped on Khon Kaen deed 25246 (parcel 12301)
-- and then returned AGAIN for Phuket deed 10510 (parcel 23264) - a different
-- province, a different land office, a different shape.
--
-- The original idea in 022 ("same OBJECTID across all provinces = one building")
-- does not survive multi-province OBJECTID reuse. Scoping the uniqueness to
-- (td_object_id, province_code) keeps the useful half - two rooms in ONE
-- building in ONE province may not double-claim the object - and lets bot 2
-- cross provinces without dying on its first collision.
DROP INDEX IF EXISTS parcels_td_object_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS parcels_td_object_id_key
    ON parcels (td_object_id, province_code) WHERE td_object_id IS NOT NULL;
