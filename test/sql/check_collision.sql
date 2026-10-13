\pset border 2
\echo '=== COLLISION TEST: same (province, amphur, tambon_code) with DIFFERENT tambon names ==='
SELECT count(*) AS colliding_keys
FROM (
  SELECT changwat_code, amphur_code, tambon_code
  FROM eva_area_grade
  GROUP BY 1,2,3
  HAVING count(DISTINCT tambon_name) > 1
) t;

\echo ''
\echo '=== worst offenders ==='
SELECT changwat_code, amphur_code, tambon_code,
       count(DISTINCT tambon_name) AS names,
       string_agg(DISTINCT tambon_name, ' / ' ORDER BY tambon_name) AS which
FROM eva_area_grade
GROUP BY 1,2,3
HAVING count(DISTINCT tambon_name) > 1
ORDER BY names DESC
LIMIT 12;

\echo ''
\echo '=== are the highly-reused codes just sentinels (98/99/00)? ==='
SELECT tambon_code, count(DISTINCT changwat_code) AS provinces,
       count(DISTINCT (changwat_code, amphur_code)) AS scopes
FROM eva_area_grade
WHERE tambon_code IN ('98','99','00','0')
GROUP BY 1 ORDER BY scopes DESC;

\echo ''
\echo '=== excluding sentinels, is reuse still present? ==='
SELECT count(*) AS collisions_without_sentinels
FROM (
  SELECT changwat_code, amphur_code, tambon_code
  FROM eva_area_grade
  WHERE tambon_code NOT IN ('98','99','00','0')
  GROUP BY 1,2,3
  HAVING count(DISTINCT tambon_name) > 1
) t;
