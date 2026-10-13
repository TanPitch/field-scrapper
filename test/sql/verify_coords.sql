\pset border 2
\echo '=== quota ledger (must never exceed the limit) ==='
SELECT quota_date, used, limit_value, calls_ok, calls_failed
FROM dol_quota_ledger ORDER BY quota_date DESC LIMIT 5;

\echo ''
\echo '=== queue state ==='
SELECT state, count(*) FROM coord_queue GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== priority: soonest auction round first ==='
SELECT c.priority AS days_until_round, c.state, count(*)
FROM coord_queue c GROUP BY 1,2 ORDER BY 1 LIMIT 8;

\echo ''
\echo '=== coords + provenance: did the fake run attribute correctly? ==='
SELECT p.deed_number, p.geo_status, p.dol_lat, p.dol_lon,
       ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lon,
       p.eva_price_avg AS eva_avg
FROM parcels p
WHERE p.deed_number LIKE '9900%' AND p.dol_lat IS NOT NULL
ORDER BY p.geo_status, p.deed_number LIMIT 8;

\echo ''
\echo '=== geo_status distribution on resolved parcels ==='
SELECT geo_status, count(*) FROM parcels WHERE dol_lat IS NOT NULL GROUP BY 1;

\echo ''
\echo '=== DOPA-sourced coords in the provenance trail ==='
SELECT field_name, count(*) FROM field_provenance
WHERE source_key='dol' GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== divergence: any field seen from 2+ agencies? ==='
SELECT entity_type, field_name, sources, source_count
FROM provenance_divergence ORDER BY field_name LIMIT 10;
