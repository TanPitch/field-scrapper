\pset border 2
\echo '==============================================================================='
\echo ' CORRECTED COORDINATES  (datum calibrated from your 14 hand-checked points)'
\echo '==============================================================================='
SELECT l.case_no AS "หมายเลขคดี", l.case_year AS "ปี", l.order_label AS "ลำดับ",
       p.deed_number AS "โฉนด", p.tumbol AS "ตำบล",
       round(p.td_lat::numeric,5) AS "lat", round(p.td_lon::numeric,5) AS "lon",
       p.td_eva_price AS "฿/ตร.วา"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.td_checked_at IS NOT NULL
ORDER BY p.td_eva_price DESC LIMIT 8;

\echo ''
\echo '=== accuracy vs your กรมที่ดิน readings (8 decimals) ==='
WITH truth(deed,tlat,tlon) AS (VALUES
 ('32880',16.42274720,102.83357846), ('256592',16.45198528,102.83737089),
 ('79626',16.39314045,102.82443020),  ('79625',16.39307974,102.82443189),
 ('130935',16.50219634,102.82899916), ('81864',16.40263201,102.86235993),
 ('40',16.12713873,102.53867803),     ('72928',16.42237805,102.80137869),
 ('72927',16.42251643,102.80143629),  ('39486',16.48915792,102.82765427),
 ('173559',16.49754268,102.86273200), ('66383',16.71934171,102.81768469),
 ('35089',16.68805495,103.13536974),  ('11093',16.26741841,102.71330087))
SELECT t.deed AS "โฉนด",
       round(p.td_lat::numeric,7) AS "ours lat", t.tlat AS "DOL lat",
       round(p.td_lon::numeric,7) AS "ours lon", t.tlon AS "DOL lon",
       round(sqrt(power((p.td_lat-t.tlat)*111320,2) + power((p.td_lon-t.tlon)*103000,2))::numeric,1) AS "err m"
FROM truth t JOIN parcels p ON p.deed_number=t.deed ORDER BY 6;

\echo ''
\echo '==============================================================================='
\echo ' น.ส.3ก. SAMPLES  — search these on TD (NS3K layer) and send me the fetch'
\echo '==============================================================================='
SELECT l.case_no AS "หมายเลขคดี", l.case_year AS "ปี", l.order_label AS "ลำดับ",
       l.legal_exec_dept AS "สำนักงานบังคับคดี",
       p.land_title AS "ชนิดสิทธิ์",
       p.deed_number AS "เลขที่น.ส.3ก. (search this on TD)",
       p.tumbol AS "ตำบล", p.district_name AS "อำเภอ", p.province_name AS "จังหวัด",
       l.asset_type AS "ประเภททรัพย์",
       trim(to_char(l.size_rai,'FM990'))||'-'||trim(to_char(l.size_ngan,'FM90'))
         ||'-'||trim(to_char(l.size_wa,'FM90.00')) AS "ขนาด ไร่-งาน-ตร.ว."
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.land_title LIKE 'น.ส.3%'
ORDER BY p.deed_number;
