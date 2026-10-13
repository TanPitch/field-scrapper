-- 010_crs_calibration.sql — the local datum correction applied to กรมธนารักย์
-- coordinates, as data rather than as hard-coded SQL in a scraper.
--
-- assessprice serves SHAPE WKT in EPSG:24048. PostGIS's transformation of that
-- datum lands ~183 m from where กรมที่ดิน puts the same parcel. The error is a
-- constant offset in this area, so it is corrected with a median shift measured
-- against hand-verified points.
--
-- It is stored here, not in code, for three reasons:
--   - it is a measurement, and a measurement with its basis and sample size is
--     auditable;
--   - the dev database was corrected by a one-off script, which meant any new
--     enrichment run would have written UNcorrected coordinates and silently
--     broken the earlier ones;
--   - it will need re-deriving when we work outside Khon Kaen, and that should
--     be an INSERT or an UPDATE, not an edit inside a scraper.
--
-- Scope warning: derived from Khon Kaen points only. National validity is
-- UNPROVEN. A row for another province should be measured, not extrapolated.

BEGIN;

CREATE TABLE IF NOT EXISTS crs_calibration (
    id            bigserial PRIMARY KEY,
    source_key    text NOT NULL,
    srid          integer NOT NULL,
    -- Metres to ADD to latitude and longitude after the datum transform.
    -- Median of the residuals measured against verified reference points.
    d_lat_m       double precision NOT NULL,
    d_lon_m       double precision NOT NULL,
    -- Which province/region this was measured in. NULL means "measured over a
    -- sample, not established for any one place" — which is the honest state
    -- for a country-wide default.
    scope         text,
    -- How many hand-verified points the median came from, and the resulting
    -- residual spread. Stated so nobody treats it as an authoritative datum
    -- transform.
    basis_points  integer,
    residual_max_m double precision,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (source_key, srid, scope)
);

COMMENT ON TABLE crs_calibration IS
    'Empirical offset applied after a datum transform, where PostGIS disagrees with the issuing agency. Not an authoritative CRS definition.';
COMMENT ON COLUMN crs_calibration.basis_points IS
    'Number of hand-verified reference points the median was taken from. Small N means a wide confidence interval, not a precise transform.';
COMMENT ON COLUMN crs_calibration.residual_max_m IS
    'Largest remaining disagreement after correction, in metres. One outlier point (35089) remains ~12.4 m out.';

-- Khon Kaen, measured against 14 hand-verified pairs.
--   lat: the datum transform lands ~53.5 m north of truth  -> shift south
--   lon: the datum transform lands ~175.1 m west of truth  -> shift east
INSERT INTO crs_calibration
    (source_key, srid, d_lat_m, d_lon_m, scope, basis_points, residual_max_m, notes)
VALUES
    ('td_assessprice', 24048, -53.5, 175.1, '40', 14, 12.4,
     'Khon Kaen. Median residual vs กรมที่ดิน on 14 hand-verified parcels: 13 of 14 land within 0.4 m, 35089 remains 12.4 m out. DO NOT reuse for other provinces without re-measuring.')
ON CONFLICT (source_key, srid, scope) DO UPDATE
    SET d_lat_m = excluded.d_lat_m,
        d_lon_m = excluded.d_lon_m,
        basis_points = excluded.basis_points,
        residual_max_m = excluded.residual_max_m,
        notes = excluded.notes;

COMMIT;
