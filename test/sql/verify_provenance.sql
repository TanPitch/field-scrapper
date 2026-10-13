\pset border 2
\echo '=== provenance rows by source and entity ==='
SELECT source_key, entity_type, count(*) AS rows,
       count(DISTINCT field_name) AS fields
FROM field_provenance
GROUP BY 1,2 ORDER BY rows DESC;

\echo ''
\echo '=== every field we log, with its owning agency ==='
SELECT field_name, source_key, count(*) AS rows
FROM field_provenance
GROUP BY 1,2 ORDER BY source_key, field_name;

\echo ''
\echo '=== source registry: quota + last used ==='
SELECT key, agency, quota_per_day, license, last_used IS NOT NULL AS used
FROM data_sources ORDER BY key;

\echo ''
\echo '=== sample parcel with full provenance trail ==='
SELECT field_name, source_key, value_num, value_text, observed_on
FROM field_provenance
WHERE entity_type='parcel'
  AND entity_id = (SELECT min(id) FROM parcels WHERE eva_price_at IS NOT NULL)
ORDER BY source_key, field_name;

\echo ''
\echo '=== divergence / drift views working? ==='
SELECT count(*) AS divergent_fields FROM provenance_divergence;
SELECT count(*) AS drifting_fields FROM provenance_drift;
SELECT count(*) AS current_rows FROM provenance_current;
