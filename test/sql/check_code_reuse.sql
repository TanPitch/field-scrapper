\pset border 2
\echo '=== is tambon_code reused across amphurs inside one province? ==='
SELECT changwat_code, tambon_code, count(DISTINCT amphur_code) AS amphurs,
       string_agg(DISTINCT amphur_name, ', ' ORDER BY amphur_name) AS which
FROM eva_area_grade
WHERE changwat_code = '40' AND tambon_code = '98'
GROUP BY 1,2;

\echo ''
\echo '=== how widespread is that reuse? ==='
SELECT count(*) AS codes_reused_across_amphurs
FROM (
  SELECT changwat_code, tambon_code
  FROM eva_area_grade
  GROUP BY 1,2 HAVING count(DISTINCT amphur_code) > 1
) t;

\echo ''
\echo '=== the 2 unresolved parcels (fixed column) ==='
SELECT deed_number, tumbol, district_name, tambon_code, eva_price_at
FROM parcels WHERE eva_price_at IS NULL ORDER BY deed_number;

\echo ''
\echo '=== sanity: are those 2 tambons present in eva_area_grade at all? ==='
SELECT changwat_code, amphur_code, tambon_code, tambon_name
FROM eva_area_grade
WHERE changwat_code = '40'
  AND (tambon_name LIKE '%ห้วยแก%' OR tambon_name LIKE '%โนนทัน%')
GROUP BY 1,2,3,4;
