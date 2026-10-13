\pset border 2
\echo '=== land title distribution in our LED data ==='
SELECT p.land_title, l.asset_type, count(*) AS lots,
       count(*) FILTER (WHERE p.td_checked_at IS NOT NULL) AS "TD matched",
       count(*) FILTER (WHERE p.td_checked_at IS NULL)     AS "TD unmatched"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
GROUP BY 1,2 ORDER BY 3 DESC;

\echo ''
\echo '=== every deed number on a lot (multi-deed rows expand into several parcels) ==='
SELECT p.id, p.deed_number, p.land_title, l.asset_type, p.tumbol, p.district_name,
       count(*) OVER (PARTITION BY p.deed_number) AS "deeds sharing this number"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
ORDER BY count(*) OVER (PARTITION BY p.deed_number) DESC, p.deed_number
LIMIT 12;
