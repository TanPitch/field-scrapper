-- 022_td_parcel_identity.sql
--
-- TD resolves a deed number to a LAND parcel, not to a unit inside it.
--
-- Verified on Phuket deed 100683, which LED sells as two separate rooms in one
-- building (8/105 in ผบE.1941/2566, 8/26 in ผบ.778/2565). TD returns a single
-- record for it either way - with SURVEY_NO supplied and without - so TD has no
-- concept of the rooms at all. Its NS3A_ID, the unit-level field, is null.
--
-- That is the right shape for us rather than a limitation to work around: the
-- map wants one marker per building, and the building is the land parcel. The
-- rooms are assets on sale, not separate places, and they already live on
-- auction_lots as order_label (LED's addrno).
--
-- td_object_id is therefore the grouping key: two lots on the same building
-- share it, and the map draws one marker labelled x2. There is deliberately no
-- unit-level column: TD's NS3A_ID, the field that would carry one, is null for
-- every parcel checked, so a td_unit_no column would only ever be empty.
--
-- td_lat/td_lon must come from TD's SHAPE field inverted out of UTM, never from
-- DOL_SHAPE. DOL_SHAPE is the land office pin and came back byte-identical for
-- every Phuket deed checked (98.397726, 7.887292), which would have stacked
-- every parcel in the province on one dot in the sea.

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS td_object_id bigint;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS td_srid integer;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS td_utm_e double precision;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS td_utm_n double precision;

COMMENT ON COLUMN parcels.td_object_id  IS 'TD OBJECT_ID: the LAND parcel. Lots sharing this are in one building and share one map marker.';
COMMENT ON COLUMN parcels.td_lat        IS 'Latitude from TD SHAPE inverted out of UTM. NOT DOL_SHAPE, which is the land office pin.';
COMMENT ON COLUMN parcels.td_lon        IS 'Longitude from TD SHAPE inverted out of UTM. NOT DOL_SHAPE, which is the land office pin.';
COMMENT ON COLUMN parcels.td_srid       IS 'SRID TD reported for SHAPE; 24047 in practice, which is WGS84 / UTM zone 47N.';

-- One row per land parcel. Uniqueness is by OBJECTID because that is what makes
-- two rooms in one building a single marker, which is what we want.
CREATE UNIQUE INDEX IF NOT EXISTS parcels_td_object_id_key
    ON parcels (td_object_id) WHERE td_object_id IS NOT NULL;

-- LED's addrno, kept beside order_label so a room can be identified without
-- depending on the display string order_label carries.
ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS addr_no text;

COMMENT ON COLUMN auction_lots.addr_no IS
    'Room/unit number as printed by LED (addrno), e.g. 8/105. order_label carries it too but is a display string.';