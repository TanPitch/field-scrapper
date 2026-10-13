\pset border 2
\echo '==============================================================================='
\echo ' LED SEARCH KEYS  +  TD RESULTS'
\echo ' search LED by: หมายเลขคดี + ปีคดี + ลำดับการขาย   |   then check TD / DOL'
\echo '==============================================================================='
SELECT
  l.case_no                                   AS "หมายเลขคดี",
  l.case_year                                 AS "ปีคดี",
  l.order_label                               AS "ลำดับการขาย",
  l.department                                AS "สำนักงานบังคับคดี",
  p.deed_number                               AS "เลขที่โฉนด",
  p.tumbol                                    AS "ตำบล",
  round(p.td_lat::numeric,5)                  AS "TD lat",
  round(p.td_lon::numeric,5)                  AS "TD lon",
  p.td_eva_price                              AS "TD ฿/ตร.วา",
  p.td_rawang                                 AS "ระวาง",
  p.td_survey_no                              AS "หน้าสำรวจ"
FROM parcels p
JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.td_checked_at IS NOT NULL
ORDER BY p.td_eva_price DESC
LIMIT 15;

\echo ''
\echo '--- same, lowest value end (branch land offices) ---'
SELECT l.case_no AS "หมายเลขคดี", l.case_year AS "ปีคดี", l.order_label AS "ลำดับการขาย",
  p.deed_number AS "เลขที่โฉนด", p.tumbol AS "ตำบล",
  round(p.td_lat::numeric,5) AS "TD lat", round(p.td_lon::numeric,5) AS "TD lon",
  p.td_eva_price AS "TD ฿/ตร.วา", p.td_office AS "สำนักงานที่ดิน"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.td_checked_at IS NOT NULL
ORDER BY p.td_eva_price ASC LIMIT 6;

\echo ''
\echo '--- check 79625 vs 79626 specifically: same ระวาง, are they split correctly? ---'
SELECT l.case_no AS "หมายเลขคดี", l.order_label AS "ลำดับ", p.deed_number AS "โฉนด",
       p.td_land_no AS "เลขที่ดิน(TD)", p.td_survey_no AS "หน้าสำรวจ(TD)",
       round(p.td_lat::numeric,5) AS lat, round(p.td_lon::numeric,5) AS lon,
       p.td_eva_price AS "฿/ตร.วา"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.deed_number IN ('79625','79626') ORDER BY p.deed_number;
