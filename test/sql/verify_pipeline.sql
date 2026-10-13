\pset border 2
\echo '============================================================================='
\echo ' LED -> TD PIPELINE : verify these on LED / TD / DOL'
\echo '============================================================================='
SELECT
  p.deed_number AS "โฉนด",
  p.tumbol AS "ตำบล",
  p.district_name AS "อำเภอ",
  round(p.td_lat::numeric,5) AS "TD lat",
  round(p.td_lon::numeric,5) AS "TD lon",
  p.td_eva_price AS "TD ฿/ตร.วา",
  p.td_rawang AS "ระวาง",
  p.td_office AS "สำนักงานที่ดิน"
FROM parcels p
WHERE p.td_checked_at IS NOT NULL AND p.land_title = 'โฉนด'
ORDER BY p.td_eva_price DESC
LIMIT 12;

\echo ''
\echo '--- also check these (different สำนักงาน, lower value) ---'
SELECT p.deed_number AS "โฉนด", p.tumbol AS "ตำบล", p.district_name AS "อำเภอ",
  round(p.td_lat::numeric,5) AS "TD lat", round(p.td_lon::numeric,5) AS "TD lon",
  p.td_eva_price AS "TD ฿/ตร.วา", p.td_office AS "สำนักงานที่ดิน"
FROM parcels p
WHERE p.td_checked_at IS NOT NULL AND p.land_title = 'โฉนด'
ORDER BY p.td_eva_price ASC LIMIT 6;
