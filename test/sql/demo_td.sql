\pset border 2
\echo '=============================================================================='
\echo ' LED LOTS + TD COORDINATES + TD PRICE PER ตร.วา'
\echo ' (no LED selling price, no กรมที่ดิน — TD only)'
\echo '=============================================================================='
SELECT
    p.deed_number                                              AS "โฉนด",
    p.tumbol                                                   AS "ตำบล",
    p.district_name                                           AS "อำเภอ",
    round(p.td_lat::numeric,5)                                AS "lat",
    round(p.td_lon::numeric,5)                                AS "lon",
    p.geo_precision                                            AS "precision",
    p.td_eva_price                                            AS "฿/ตร.วา (TD)",
    p.td_rawang                                               AS "ระวาง",
    p.td_survey_no                                            AS "หน้าสำรวจ",
    p.td_land_no                                              AS "เลขที่ดิน",
    p.td_office                                               AS "สำนักงานที่ดิน"
FROM parcels p
WHERE p.td_checked_at IS NOT NULL
ORDER BY p.td_eva_price DESC NULLS LAST;

\echo ''
\echo '=============================================================================='
\echo ' ACCURACY vs THE SIX YOU VERIFIED BY HAND'
\echo '=============================================================================='
WITH truth(deed, tlat, tlon, teva) AS (VALUES
  ('32880',16.4227,102.8335,80500), ('72927',16.4225,102.8014,4000),
  ('79626',16.3931,102.8244,13500), ('66383',16.7193,102.8176,490),
  ('35089',16.6880,103.1353,410),   ('11093',16.2674,102.7133,120))
SELECT t.deed AS "โฉนด",
       t.teva AS "your ฿/ตร.วา", p.td_eva_price AS "our ฿/ตร.วา",
       CASE WHEN p.td_eva_price = t.teva THEN 'EXACT' ELSE 'DIFF' END AS "price",
       round((sqrt(power((p.td_lat-t.tlat)*111320,2)
                 + power((p.td_lon-t.tlon)*103000,2)))::numeric) AS "dist (m)",
       round(p.td_lat::numeric,5) AS "our lat", round(p.td_lon::numeric,5) AS "our lon"
FROM truth t JOIN parcels p ON p.deed_number = t.deed
ORDER BY 4 DESC;

\echo ''
\echo '=============================================================================='
\echo ' COVERAGE'
\echo '=============================================================================='
SELECT count(*) AS "lots",
       count(td_checked_at) AS "TD enriched",
       count(*) FILTER (WHERE td_checked_at IS NULL) AS "no TD match",
       count(*) FILTER (WHERE geo_precision='parcel') AS "parcel-precision",
       count(*) FILTER (WHERE geo_precision='subdistrict') AS "subdistrict fallback"
FROM parcels;

\echo ''
\echo '--- the 6 without a TD match (NOT guessed) ---'
SELECT p.deed_number, p.tumbol, p.district_name, p.geo_precision
FROM parcels p WHERE p.td_checked_at IS NULL ORDER BY p.deed_number;

\echo ''
\echo '--- provenance: every TD field attributed to กรมธนารักย์ ---'
SELECT field_name, count(*) FROM field_provenance
WHERE source_key='td_assessprice' GROUP BY 1 ORDER BY 1;
