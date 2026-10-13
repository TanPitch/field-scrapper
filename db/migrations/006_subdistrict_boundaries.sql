-- 006: subdistrict boundary geometry.
--
-- Why: placing an auction lot on a map needs a coordinate. กรมที่ดิน's
-- anonymous tier gives parcel-accurate points but only 20/day, and no
-- open-data bulk cadastral file exists (NOTES §24). LED, however, publishes
-- ตำบล/อำเภอ/จังหวัด on every row, so official subdistrict boundaries let us
-- place every lot immediately with no quota at all.
--
-- This is deliberately NOT a parcel pin. It is a subdistrict marker, and
-- parcels.geo_precision records which of the two a given point is, so the UI
-- can be honest about it rather than implying parcel accuracy.
--
-- Source: public ArcGIS FeatureServer "Thailand Subdistrict Boundaries",
-- 7,436 features, generalised to 50 m tolerance. รหัส fields are the same
-- กรมการปกครอง codes already in our districts/provinces tables, so the join
-- is exact rather than name-matched.

BEGIN;

CREATE TABLE subdistrict_boundaries (
    tambon_code     text PRIMARY KEY,        -- 6-digit รหัสตำบล
    district_code   text NOT NULL,           -- 4-digit รหัสอำเภอ (matches districts.code)
    province_code   text NOT NULL,           -- 2-digit รหัสจังหวัด (matches provinces.code)
    tambon_name     text NOT NULL,
    amphur_name     text,
    province_name   text,
    population      integer,
    geom            geometry(MultiPolygon, 4326),
    -- ST_PointOnSurface, not ST_Centroid: a centroid can fall outside a concave
    -- or crescent-shaped tambon, which would put the marker in the wrong place.
    center          geography(Point, 4326) NOT NULL,
    source          text NOT NULL DEFAULT 'arcgis:Thailand_Subdistrict_Boundaries',
    loaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subdistrict_boundaries_geom_idx ON subdistrict_boundaries USING GIST (geom);
CREATE INDEX subdistrict_boundaries_district_idx ON subdistrict_boundaries (district_code);

-- Only Khon Kaen is needed to prove the pipeline; keep the import scoped so a
-- full-country load is an explicit decision, not an accident.
COMMENT ON TABLE subdistrict_boundaries IS
    'Official subdistrict polygons. Centroid-free marker via ST_PointOnSurface. Generalised 50m.';

-- Record how precise a parcel's stored point actually is, so the map never
-- implies parcel accuracy it does not have.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS geo_precision text;

CREATE INDEX IF NOT EXISTS parcels_precision_idx
    ON parcels (geo_precision) WHERE geo_precision IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_geo_precision_chk') THEN
        ALTER TABLE parcels ADD CONSTRAINT parcels_geo_precision_chk
            CHECK (geo_precision IS NULL OR geo_precision IN ('parcel', 'subdistrict'));
    END IF;
END $$;

COMMIT;
