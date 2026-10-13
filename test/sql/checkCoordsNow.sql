\pset border 2
\echo '=== current td_lat/td_lon vs กรมที่ดิน truth ==='
WITH truth(deed,tlat,tlon) AS (VALUES
 ('32880',16.42274720,102.83357846), ('256592',16.45198528,102.83737089),
 ('79626',16.39314045,102.82443020),  ('79625',16.39307974,102.82443189),
 ('130935',16.50219634,102.82899916), ('81864',16.40263201,102.86235993),
 ('40',16.12713873,102.53867803),     ('72928',16.42237805,102.80137869),
 ('72927',16.42251643,102.80143629),  ('39486',16.48915792,102.82765427),
 ('173559',16.49754268,102.86273200), ('66383',16.71934171,102.81768469),
 ('35089',16.68805495,103.13536974),  ('11093',16.26741841,102.71330087))
SELECT t.deed AS "โฉนด",
       round(p.td_lat::numeric,7) AS "stored lat",
       t.tlat AS "truth lat",
       round(p.td_lon::numeric,7) AS "stored lon",
       t.tlon AS "truth lon",
       round(sqrt(power((p.td_lat-t.tlat)*111320,2) + power((p.td_lon-t.tlon)*103000,2))::numeric,1) AS "err (m)"
FROM truth t JOIN parcels p ON p.deed_number = t.deed
ORDER BY 6;
