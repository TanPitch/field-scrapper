\pset border 2
\echo '=== parcels with an area-level appraisal bracket ==='
SELECT p.deed_number, p.tumbol, p.tambon_code, p.tambon_match,
       p.eva_price_min AS lo, p.eva_price_max AS hi, p.eva_price_avg AS avg,
       p.eva_grade_count AS grades, p.eva_price_source AS src
FROM parcels p
WHERE p.eva_price_at IS NOT NULL
ORDER BY p.eva_price_avg
LIMIT 12;

\echo ''
\echo '=== the 2 unresolved tambons (visible gap, not silently zero) ==='
SELECT p.deed_number, p.tumbol, p.amphur_label AS amphur, p.tambon_code, p.eva_price_at
FROM parcels p
WHERE p.eva_price_at IS NULL
ORDER BY p.deed_number;

\echo ''
\echo '=== subdistricts now carry official codes ==='
SELECT s.name, s.code, d.name AS amphur, p.name AS province
FROM subdistricts s
JOIN districts d ON d.id = s.district_id
JOIN provinces p ON p.code = d.province_id
ORDER BY s.code NULLS LAST
LIMIT 15;

\echo ''
\echo '=== match-quality distribution (name-join confidence) ==='
SELECT coalesce(tambon_match,'(none)') AS match, count(*)
FROM parcels GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== do these brackets line up with the earlier manual check? ==='
\echo '  earlier: บ้านเรือ 40/16/1 -> lo 110.00  hi 750.00'
SELECT min(evaprice) AS lo, max(evaprice) AS hi, count(*) AS grades
FROM eva_area_grade
WHERE changwat_code='40' AND amphur_code='16' AND tambon_code='1';
