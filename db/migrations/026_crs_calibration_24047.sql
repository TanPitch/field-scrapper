-- 026_crs_calibration_24047.sql — the datum correction for SRID 24047.
--
-- assessprice serves SHAPE WKT in two SRIDs. Most of what it returns is
-- 24048, which migration 010 calibrated against 14 hand-verified points in
-- Khon Kaen. The rest is 24047, and that had no calibration row at all.
--
-- It did not need one while only one code path could place a parcel. But
-- resolveTdParcels.js inverted the projection itself, with the zone hardcoded
-- to 47, and wrote the result over whatever PostGIS had produced. For a row
-- whose SRID is 24048 that put the longitude 6 degrees out - 618 km - and 3,621
-- parcels ended up in the Andaman Sea instead of on their land. The
-- coordinates were not wrong by a few metres; they were in another country.
--
-- The correction itself is the same datum shift the 24048 row already holds.
-- Measured independently over all 1,652 parcels stored with SRID 24047, by
-- comparing their existing coordinates against PostGIS's transform of their own
-- UTM pair:
--
--     d_lat  -58.9 m   (spread -61.7 .. -48.6)
--     d_lon +183.5 m   (spread +180.0 .. +188.3)
--
-- against the 24048 row's -53.5 m and +175.1 m. Two independent measurements,
-- six and eight metres apart, of the same thing: the Indian 1975 datum that
-- assessprice publishes against the one กรมที่ดิน and LED use.
--
-- Basis: the existing coordinates, which are what the user has been reading
-- off LED and DOL and confirming by hand. The residual spread above is the
-- measure of how tight that source is, not a claim of authority.
--
-- Scope warning unchanged: this is a national default, not a measurement for
-- any one province. A row for a specific province should be measured against
-- that province's own points, the way 010 was.

BEGIN;

INSERT INTO crs_calibration
(source_key, srid, d_lat_m, d_lon_m, scope, basis_points, residual_max_m, notes)
VALUES
('td_assessprice', 24047, -58.9, 183.5, NULL, 1652, 6.6,
 'National default for SRID 24047. Median over all 1,652 parcels stored with that SRID, comparing their existing coordinates against PostGIS ST_Transform of their own UTM pair. Agrees with the 24048 row (Khon Kaen, 14 hand-verified points: -53.5 m, +175.1 m) to within 6 m in latitude and 8 m in longitude, which is two independent measurements of the same datum shift. Residual spread 6.6 m latitude, 8.3 m longitude.')
ON CONFLICT (source_key, srid, scope) DO UPDATE
   SET d_lat_m = EXCLUDED.d_lat_m,
       d_lon_m = EXCLUDED.d_lon_m,
       basis_points = EXCLUDED.basis_points,
       residual_max_m = EXCLUDED.residual_max_m,
       notes = EXCLUDED.notes;

COMMIT;
