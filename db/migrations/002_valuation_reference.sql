-- 002: reference tables from กรมธนารักย์ (Department of Treasury) appraisal open data.
--
-- Source: catalog.treasury.go.th, licence "Open Data Common", no API key, no quota.
-- Two distinct tables, because they answer different questions and join on
-- different keys:
--
--   eva_land_sheet   ราคาประเมินที่ดิน, keyed by ระวาง + เลขที่ดิน. 4.86M rows.
--                    This is the same table LandsMaps reads to show
--                    "ราคาประเมิน" per parcel, so a row here IS the authoritative
--                    per-parcel appraisal once we know its sheet.
--                    Requires the sheet number, which LED does not publish.
--
--   eva_area_grade   ราคาประเมินทุนทรัพย์ที่ดินประเภทอื่น, keyed by
--                    กรมการปกครอง codes + street class. 32k rows.
--                    Joins straight onto any auction lot we already hold,
--                    because LED gives us จังหวัด/อำเภอ/ตำบล.

-- One เลขที่ดิน on one sheet can legitimately carry several unit prices:
-- the source export flattens a sub-parcel dimension (front / middle / rear
-- land, or a ห้องย่อย) that กรมธนารักย์ holds but does not export. Verified
-- concretely: (5136,4,7228,05,1000,9529) appears with EVAPRICE 74000 *and*
-- 58000. So the natural key must include the price, and consumers read a
-- range rather than a fake single value.
CREATE TABLE IF NOT EXISTS eva_land_sheet (
    utmmap1    text   NOT NULL,           -- ระวางหลัก เช่น 5136
    utmmap2    text   NOT NULL,           -- ระวางย่อย เช่น 3
    utmmap3    text   NOT NULL,           -- แผ่นที่ เช่น 6416
    utmmap4    text   NOT NULL,           -- ส่วนย่อยของแผ่นที่ เช่น 11
    utmscale   text   NOT NULL,           -- มาตราส่วน เช่น 1000 / 4000
    land_no    text   NOT NULL,           -- เลขที่ดิน
    evaprice   numeric(18,6) NOT NULL,    -- ราคาประเมิน บาท/ตร.วา
    source_file text   NOT NULL,          -- which CSV it came from
    PRIMARY KEY (utmmap1, utmmap2, utmmap3, utmmap4, utmscale, land_no, evaprice, source_file)
) PARTITION BY LIST (source_file);

-- One partition per CSV. The five ราคาประเมินที่ดิน files are regional
-- splits, so partitioning by file keeps any single-region scan cheap and lets
-- us drop a stale region without touching the rest.
CREATE TABLE IF NOT EXISTS eva_land_sheet_r1 PARTITION OF eva_land_sheet FOR VALUES IN ('land_R1');
CREATE TABLE IF NOT EXISTS eva_land_sheet_r2 PARTITION OF eva_land_sheet FOR VALUES IN ('land_R2');
CREATE TABLE IF NOT EXISTS eva_land_sheet_r3 PARTITION OF eva_land_sheet FOR VALUES IN ('land_R3');
CREATE TABLE IF NOT EXISTS eva_land_sheet_r4 PARTITION OF eva_land_sheet FOR VALUES IN ('land_R4');
CREATE TABLE IF NOT EXISTS eva_land_sheet_r5 PARTITION OF eva_land_sheet FOR VALUES IN ('land_R5');
-- guard so an unrecognised CSV fails loudly instead of silently creating rows
-- that no partition can hold
CREATE TABLE IF NOT EXISTS eva_land_sheet_default PARTITION OF eva_land_sheet DEFAULT;

CREATE INDEX IF NOT EXISTS eva_land_sheet_lookup_idx
    ON eva_land_sheet (utmmap1, utmmap2, utmmap3, land_no);

CREATE TABLE IF NOT EXISTS eva_area_grade (
    changwat_code text NOT NULL,
    changwat_name text NOT NULL,
    amphur_code   text NOT NULL,
    amphur_name   text NOT NULL,
    tambon_code   text NOT NULL,
    tambon_name   text NOT NULL,
    street_name   text NOT NULL,          -- ประเภทที่ดินตามถนน/หน่วยย่อย
    evaprice      numeric(18,2) NOT NULL, -- บาท/ตร.วา
    -- same flattening as eva_land_sheet: one ตำบล + street class legitimately
    -- carries several unit prices, so the key includes the price
    PRIMARY KEY (changwat_code, amphur_code, tambon_code, street_name, evaprice)
);

-- join path used by the ingest worker: lot -> eva_area_grade
CREATE INDEX IF NOT EXISTS eva_area_grade_area_idx
    ON eva_area_grade (changwat_code, amphur_code, tambon_code);

-- The honest read of eva_land_sheet: one เลขที่ดิน may map to a spread of unit
-- prices, so consumers take a range. Use this rather than the raw table.
CREATE OR REPLACE VIEW eva_land_sheet_range AS
SELECT utmmap1, utmmap2, utmmap3,
       min(utmmap4)  AS utmmap4_lo, max(utmmap4)  AS utmmap4_hi,
       min(land_no)  AS land_no_lo, max(land_no)  AS land_no_hi,
       land_no,
       min(utmscale) AS utmscale,
       min(evaprice) AS evaprice_min,
       max(evaprice) AS evaprice_max,
       round(avg(evaprice), 2) AS evaprice_avg,
       count(*)      AS price_variants
FROM eva_land_sheet
GROUP BY utmmap1, utmmap2, utmmap3, utmscale, land_no;

CREATE OR REPLACE VIEW eva_area_grade_range AS
SELECT changwat_code, amphur_code, tambon_code,
       min(evaprice) AS evaprice_min,
       max(evaprice) AS evaprice_max,
       round(avg(evaprice), 2) AS evaprice_avg,
       count(*)      AS grade_count
FROM eva_area_grade
GROUP BY changwat_code, amphur_code, tambon_code;

COMMENT ON TABLE eva_land_sheet IS
    'กรมธนารักย์ ราคาประเมินที่ดิน, keyed by ระวาง+เลขที่ดิน. Same table LandsMaps reads. Licence: Open Data Common.';
COMMENT ON TABLE eva_area_grade IS
    'กรมธนารักย์ ราคาประเมินทุนทรัพย์ที่ดินประเภทอื่น, by ตำบล + street class. Joins directly to LED lots.';
