\pset border 2
\echo '=== what codes did ArcGIS actually give us? ==='
SELECT tambon_code, district_code, province_code, tambon_name, amphur_name
FROM subdistrict_boundaries
WHERE province_code = '40'
ORDER BY tambon_code
LIMIT 8;

\echo ''
\echo '=== our parcels, as stored ==='
SELECT id, deed_number, province_code, district_dol_code, tumbol, tambon_code
FROM parcels ORDER BY id LIMIT 8;

\echo ''
\echo '=== does the join key line up? ==='
SELECT p.tumbol, p.tambon_code AS our_tambon,
       b.tambon_code AS arcgis_tambon, right(b.tambon_code,2) AS arcgis_last2,
       (b.province_code = p.province_code::text) AS prov_ok,
       (b.district_code = (p.province_code*100 + p.district_dol_code)::text) AS dist_ok
FROM parcels p
LEFT JOIN subdistrict_boundaries b
  ON b.province_code = p.province_code::text
 AND right(b.tambon_code,2) = p.tambon_code
LIMIT 8;

\echo ''
\echo '=== district_code format check ==='
SELECT DISTINCT district_code, length(district_code) AS len, count(*)
FROM subdistrict_boundaries WHERE province_code='40' GROUP BY 1 ORDER BY 1 LIMIT 6;
