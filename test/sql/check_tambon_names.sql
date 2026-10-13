\echo '=== do the LED sample tambols resolve by name? ==='
SELECT changwat_code, amphur_code, tambon_code, tambon_name, count(*) AS grades,
       min(evaprice) AS lo, max(evaprice) AS hi
FROM eva_area_grade
WHERE changwat_code = '40'
  AND tambon_name IN ('หนองไผ่', 'กุดน้ำใส', 'บ้านเรือ')
GROUP BY 1,2,3,4
ORDER BY tambon_name;

\echo ''
\echo '=== exact-match rate: how close are LED names to official tambon names? ==='
-- LED spells subdistricts with and without the เทศบาล prefix, so compare on a
-- normalised form rather than the raw string.
WITH norm AS (
    SELECT changwat_code, amphur_code, tambon_code, tambon_name,
           regexp_replace(tambon_name, '^(เทศบาล|อบต\.)', '', '') AS bare
    FROM eva_area_grade
    GROUP BY 1,2,3,4
)
SELECT count(*) FILTER (WHERE tambon_name LIKE 'เทศบาล%') AS prefixed_with_city,
       count(*) FILTER (WHERE tambon_name LIKE 'อบต.%')    AS prefixed_with_abt,
       count(*) AS total
FROM norm;

\echo ''
\echo '=== sample of Khon Kaen tambons as stored ==='
SELECT DISTINCT amphur_code, tambon_code, tambon_name
FROM eva_area_grade
WHERE changwat_code = '40' AND amphur_code IN ('01', '16')
ORDER BY amphur_code, tambon_code
LIMIT 25;
