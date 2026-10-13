\echo '=== Khon Kaen: eva_area_grade amphur_code -> sample tambons ==='
SELECT amphur_code, string_agg(DISTINCT tambon_name, ', ' ORDER BY tambon_name) AS tambons
FROM eva_area_grade
WHERE changwat_code = '40'
GROUP BY amphur_code
ORDER BY amphur_code;

\echo ''
\echo '=== what our districts table currently holds for Khon Kaen ==='
SELECT d.dol_code, d.name, count(s.id) AS subdistricts
FROM districts d
LEFT JOIN subdistricts s ON s.district_id = d.id
WHERE d.province_id = 40
GROUP BY d.dol_code, d.name
ORDER BY d.dol_code;

\echo ''
\echo '=== distinct street classes (to understand the grade dimension) ==='
SELECT street_name, count(*) AS rows
FROM eva_area_grade
WHERE changwat_code = '40'
GROUP BY street_name
ORDER BY rows DESC
LIMIT 15;
