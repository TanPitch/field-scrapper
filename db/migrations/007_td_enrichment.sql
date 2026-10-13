-- 007_td_enrichment.sql — กรมธนารักย์ per-parcel assessment.
--
-- This captures columns that were first applied ad hoc to the dev database, so
-- a fresh install gets the same shape without anyone having to remember them.
--
-- Prices are per 1 ตร.วา, exact and per parcel. This is a different fact from
-- the LED asking price (a ไร่-งาน-ตร.ว. cascade) and from the ตำบล-level area
-- grade table; do not average them together.
--
-- The UTM columns record where the source WKT actually was, before the local
-- datum correction. They are kept so the correction stays auditable and
-- reversible rather than being baked invisibly into the geometry.

BEGIN;

ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS td_eva_price    numeric,
    ADD COLUMN IF NOT EXISTS td_land_no      text,
    ADD COLUMN IF NOT EXISTS td_rawang      text,
    ADD COLUMN IF NOT EXISTS td_survey_no   text,
    ADD COLUMN IF NOT EXISTS td_office      text,
    ADD COLUMN IF NOT EXISTS td_lat         double precision,
    ADD COLUMN IF NOT EXISTS td_lon         double precision,
    ADD COLUMN IF NOT EXISTS td_checked_at  timestamptz;

-- Source CRS before correction, so the delta is inspectable.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS td_utm_e       double precision,
    ADD COLUMN IF NOT EXISTS td_utm_n       double precision,
    ADD COLUMN IF NOT EXISTS td_utm_srid    integer;

-- Why a parcel has or lacks TD coordinates. Skipped means "we looked and this
-- layer cannot serve it" (น.ส.3ก. is not on the โฉนด layer); unresolved means
-- "the layer answered but nothing matched". Unresolved is a real data gap;
-- skipped is not. The UI must not present them the same way.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS td_status      text;

COMMENT ON COLUMN parcels.td_eva_price IS
    'Exact กรมธนารักย์ assessment, บาท/ตร.วา, per parcel. Null when TD has no record.';
COMMENT ON COLUMN parcels.td_status IS
    'NULL = not attempted, ''skipped:*'' = layer cannot serve it, ''unresolved:*'' = queried but no match, ''matched'' = ok.';
COMMENT ON COLUMN parcels.td_utm_srid IS
    'EPSG of the SHAPE WKT as served by TD (24048 in Khon Kaen), before the local datum correction applied to td_lat/td_lon.';

CREATE INDEX IF NOT EXISTS parcels_td_pending_idx
    ON parcels (province_code, td_status)
    WHERE td_eva_price IS NULL;

COMMIT;
