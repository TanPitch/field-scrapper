-- 003: area-level valuation (กรมธนารักย์) onto parcels.
--
-- Why this exists: ราคาประเมิน is the number a buyer actually acts on, and the
-- LandsMaps per-parcel price needs the 20/day quota. But eva_area_grade is
-- keyed by ตำบล + street class, and LED already publishes จังหวัด/อำเภอ/ตำบล,
-- so every auction lot can be given an appraisal bracket with zero DOL calls.
--
-- Verified compatible before writing this:
--   * LED amphurParser codes match eva_area_grade.amphur_code exactly
--     (40/01 เมืองขอนแก่น, 40/05 ชุมแพ, 40/07 น้ำพอง, 40/16 ภูเวียง).
--   * amphur NAMES do NOT match ("เมืองขอนแก่น" vs "เทศบาลนครขอนแก่น"),
--     so the join is on codes only.
--   * tambon is the weak link: LED publishes a NAME only, and 2467 of 7915
--     official tambon names carry an "เทศบาล" prefix. Hence tambon_code is
--     stored alongside, resolved once and cached.
--
-- A price here is always a RANGE. One ตำบล legitimately holds several unit
-- prices per street class, so min/max/avg is the honest representation.

BEGIN;

ALTER TABLE subdistricts ADD COLUMN IF NOT EXISTS code text;  -- กรมการปกครอง 2-digit

CREATE UNIQUE INDEX IF NOT EXISTS subdistricts_code_idx
    ON subdistricts (district_id, code) WHERE code IS NOT NULL;

ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS tambon_code text;

-- Area-level appraisal bracket, resolved from eva_area_grade.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS eva_price_min   numeric(14,2),
    ADD COLUMN IF NOT EXISTS eva_price_max   numeric(14,2),
    ADD COLUMN IF NOT EXISTS eva_price_avg   numeric(14,2),
    ADD COLUMN IF NOT EXISTS eva_grade_count integer,
    ADD COLUMN IF NOT EXISTS eva_price_source text,
    ADD COLUMN IF NOT EXISTS eva_price_at    timestamptz;

-- How the tambon name was resolved, so we can measure name-join quality
-- instead of assuming it. 'code' = matched official code, 'name' = matched on
-- normalised name only (prefix stripped), NULL = unresolved.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS tambon_match  text;

CREATE INDEX IF NOT EXISTS parcels_tambon_idx ON parcels (tambon_code);
CREATE INDEX IF NOT EXISTS parcels_eva_pending_idx
    ON parcels (eva_price_at) WHERE eva_price_at IS NULL;

-- Look up path used by the ingest worker: (province, amphur, tambon) -> range.
CREATE OR REPLACE VIEW eva_area_lookup AS
SELECT changwat_code, amphur_code, tambon_code, tambon_name,
       min(evaprice) AS eva_price_min,
       max(evaprice) AS eva_price_max,
       round(avg(evaprice), 2) AS eva_price_avg,
       count(*)     AS eva_grade_count
FROM eva_area_grade
GROUP BY 1,2,3,4;

COMMIT;
