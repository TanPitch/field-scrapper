\pset border 2
\echo '=========================================================================='
\echo ' LED LOTS WITH MAP COORDINATES  (Khon Kaen, live scrape -> database)'
\echo '=========================================================================='
SELECT
    l.order_label                                              AS "no.",
    p.deed_number                                              AS "โฉนด",
    p.tumbol                                                   AS "ตำบล",
    d.name                                                     AS "อำเภอ",
    p.tambon_code                                              AS "รหัสตำบล",
    round(ST_Y(p.geom::geometry)::numeric,5)||', '||round(ST_X(p.geom::geometry)::numeric,5) AS "lat, lon",
    p.geo_precision                                            AS "precision",
    trim(to_char(l.size_rai,'FM9990'))||'-'||trim(to_char(l.size_ngan,'FM90'))
        ||'-'||trim(to_char(l.size_wa,'FM90'))                  AS "size ไร่-งาน-ตร.วา",
    l.start_price                                              AS "start ฿",
    p.eva_price_min||' - '||p.eva_price_max                    AS "appraisal/ตร.วา",
    l.status                                                    AS "status",
    l.next_round_date                                           AS "next round"
FROM parcels p
JOIN auction_lots  l ON l.parcel_id = p.id
LEFT JOIN districts d ON d.province_id = p.province_code
                    AND d.dol_code   = p.district_dol_code
ORDER BY l.start_price DESC NULLS LAST
LIMIT 14;

\echo ''
\echo '=========================================================================='
\echo ' COVERAGE + HONESTY CHECKS'
\echo '=========================================================================='
SELECT count(*)                                            AS "lots",
       count(p.geom)                                       AS "placed on map",
       round(100.0*count(p.geom)/count(*),1)                AS "pct %",
       count(*) FILTER (WHERE p.geo_precision='subdistrict') AS "subdistrict-resolution",
       count(*) FILTER (WHERE p.geo_precision='parcel')      AS "parcel-resolution",
       count(*) FILTER (WHERE p.eva_price_at IS NOT NULL)    AS "with appraisal"
FROM auction_lots l JOIN parcels p ON p.id = l.parcel_id;

\echo ''
\echo '--- distinct map points (many lots share a subdistrict marker) ---'
SELECT round(ST_X(center::geometry)::numeric,4) AS lon,
       round(ST_Y(center::geometry)::numeric,4) AS lat,
       tambon_name, count(*) AS lots_here
FROM parcels p JOIN subdistrict_boundaries b
  ON b.district_code = (p.province_code*100 + p.district_dol_code)::text
 AND b.tambon_name   = p.tumbol
GROUP BY 1,2,3 ORDER BY lots_here DESC LIMIT 6;

\echo ''
\echo '--- sanity: are those coordinates actually in Khon Kaen? ---'
SELECT round(ST_X(center::geometry)::numeric,3) AS lon,
       round(ST_Y(center::geometry)::numeric,3) AS lat,
       tambon_name
FROM subdistrict_boundaries
WHERE tambon_name IN ('บ้านเรือ','หนองไผ่','เมืองเก่า')
ORDER BY tambon_name;
