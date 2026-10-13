-- behavioural checks for 001_core.sql. Run inside the test database.

-- A province with LED/DOL codes that intentionally differ.
INSERT INTO provinces (code, name, dol_code) VALUES (40, 'Khon Kaen', 40);
INSERT INTO districts (province_id, code, dol_code, name)
VALUES (40, 4001, 01, 'Mueang'), (40, 4016, 16, 'Phu Wiang');

INSERT INTO parcels (province_code, district_dol_code, deed_number, land_title, tumbol,
                     district_name, province_name, geo_status, dol_lat, dol_lon, geom)
VALUES (40, 01, '39486', 'โฉนด', 'Sila', 'Mueang Khon Kaen', 'Khon Kaen',
        'mismatch', 16.48915792, 102.82765427,
        ST_SetSRID(ST_MakePoint(102.82765427, 16.48915792), 4326)::geography);

SELECT 'geo_status three-valued enforced' AS check_name WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%parcels_geo_status%' AND check_clause LIKE '%mismatch%');

-- an invalid geo_status must be rejected
\set ON_ERROR_STOP 0
DO $$
BEGIN
    BEGIN
        INSERT INTO parcels (province_code, district_dol_code, deed_number, geo_status)
        VALUES (40, 01, '99999', 'resolved');
        RAISE EXCEPTION 'FAIL: bogus geo_status was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'ok: bogus geo_status rejected';
    END;
END $$;
\set ON_ERROR_STOP 1

-- one lot
INSERT INTO auction_lots (parcel_id, case_no, case_year, order_number, order_sub,
                          order_label, first_round_date, asset_type, size_unit, size_wa,
                          start_price, start_price_src, status)
SELECT id, 'ผบE.1418', 2563, 3, 1, '3 - 1', DATE '2026-08-19', 'ห้องชุด', 'sqm', 31.04,
       1862400, 'officer', 'active'
FROM parcels WHERE deed_number = '39486';

-- same parcel, SAME cycle -> must collide (this is the re-run case)
\set ON_ERROR_STOP 0
DO $$
BEGIN
    BEGIN
        INSERT INTO auction_lots (parcel_id, case_no, case_year, order_number, order_sub,
                                  order_label, first_round_date)
        SELECT parcel_id, 'ผบE.1418', 2563, 3, 1, '3 - 1', DATE '2026-08-19'
        FROM auction_lots LIMIT 1;
        RAISE EXCEPTION 'FAIL: duplicate lot in the same cycle was accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'ok: duplicate lot in same cycle rejected';
    END;
END $$;
\set ON_ERROR_STOP 1

-- same parcel, NEW cycle -> must be allowed (this is the re-listing case)
INSERT INTO auction_lots (parcel_id, case_no, case_year, order_number, order_sub,
                          order_label, first_round_date, start_price)
SELECT parcel_id, 'ผบE.1418', 2563, 3, 1, '3 - 1', DATE '2027-03-15', 1900000
FROM auction_lots LIMIT 1;

SELECT 'lots for this parcel (expect 2: original + relist)' AS check_name, count(*) AS got
FROM auction_lots;

-- an invalid status_code on a round must be rejected
INSERT INTO auction_rounds (lot_id, idx, round_date, status_code, is_held)
SELECT id, 1, DATE '2026-08-19', 3, true FROM auction_lots LIMIT 1;

\set ON_ERROR_STOP 0
DO $$
DECLARE lid bigint;
BEGIN
    SELECT id INTO lid FROM auction_lots LIMIT 1;
    BEGIN
        INSERT INTO auction_rounds (lot_id, idx, status_code) VALUES (lid, 2, 99);
        RAISE EXCEPTION 'FAIL: bogus status_code accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'ok: bogus status_code rejected';
    END;
END $$;
\set ON_ERROR_STOP 1

-- spatial query works (this is what the frontend bbox search needs)
SELECT 'parcels within 1km of Khon Kaen city centre' AS check_name, count(*) AS got
FROM parcels
WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(102.8276, 16.4891), 4326)::geography, 1000);

SELECT 'unresolved queue size (expect 1)' AS check_name, count(*) AS got
FROM parcels WHERE geo_status <> 'verified';
