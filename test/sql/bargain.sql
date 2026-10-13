\pset border 2
\echo '=== the decision metric: LED asking price vs appraised value ==='
\echo '=== (ground-truth parcels, verified by hand against DOL + TD) ==='
SELECT p.deed_number                       AS "โฉนด",
       p.tumbol                            AS "ตำบล",
       l.size_rai||'-'||l.size_ngan||'-'||l.size_wa AS "LED ไร่-งาน-ตร.วา",
       round(l.size_rai*400 + l.size_ngan*100 + l.size_wa) AS "ตร.วา",
       p.dol_land_price                    AS "appraisal ฿/ตร.วา",
       round((l.size_rai*400 + l.size_ngan*100 + l.size_wa) * p.dol_land_price)
                                             AS "appraised total",
       l.start_price                       AS "LED asking",
       round(l.start_price / ((l.size_rai*400 + l.size_ngan*100 + l.size_wa) * p.dol_land_price), 2)
                                             AS "asking ÷ appraised",
       CASE WHEN l.start_price < (l.size_rai*400 + l.size_ngan*100 + l.size_wa) * p.dol_land_price
            THEN 'BELOW appraisal' ELSE 'ABOVE appraisal' END AS "verdict"
FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
WHERE p.eva_price_at IS NOT NULL AND p.dol_land_price IS NOT NULL
ORDER BY 7 NULLS LAST;

\echo ''
\echo '=== where our FREE area bracket sits vs truth ==='
SELECT p.tumbol AS "ตำบล",
       p.eva_price_min||' - '||p.eva_price_max AS "our bracket",
       p.dol_land_price AS "true ฿/ตร.วา",
       CASE WHEN p.dol_land_price BETWEEN p.eva_price_min AND p.eva_price_max THEN 'inside'
            WHEN p.dol_land_price > p.eva_price_max THEN 'UNDER by '||round(p.dol_land_price/p.eva_price_max,1)||'x'
            ELSE 'over' END AS "bracket quality"
FROM parcels p
WHERE p.dol_land_price IS NOT NULL
ORDER BY 4;
