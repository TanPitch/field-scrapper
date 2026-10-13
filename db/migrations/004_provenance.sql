-- 004: data provenance — where every field came from, and when.
--
-- Why: this project reads the same fact from several agencies and they
-- disagree. A parcel's area appears on LED (ไร่-งาน-ตร.วา) and on กรมที่ดิน
-- (ตร.วา). Its valuation appears on LED (assetprice4, the auction appraisal)
-- AND on กรมธนารักย์ (ราคาประเมินทุนทรัพย์). Those are different quantities that
-- look alike, and picking one silently means the other is lost with no trace.
--
-- So every write records: which agency, which field, what value, and when we
-- observed it. Divergences are then a query, not an archaeology project.
--
-- Design notes:
--   * Provenance is per FIELD, not per row. A parcel's deed number comes from
--     LED while its coordinates come from กรมที่ดิน; one source-per-row would
--     be a lie.
--   * keyed on the observation DAY, not the timestamp, so a nightly re-scrape
--     updates today's row instead of appending thousands of duplicates, while
--     still preserving the day's-over-days history that shows drift.
--   * append-only. Provenance is never rewritten, only extended.

BEGIN;

-- ------------------------------------------------------------ source registry

CREATE TABLE data_sources (
    key             text PRIMARY KEY,        -- 'led', 'dol', 'treasury_eva_area'
    name            text NOT NULL,
    agency          text NOT NULL,           -- กรมบังคับคดี, กรมที่ดิน, กรมธนารักย์
    url             text,
    license         text,
    -- NULL means unlimited/unknown. The anonymous กรมที่ดิน tier is 20/day and
    -- is tracked against dol_quota_ledger.
    quota_per_day   integer,
    terms_url       text,
    notes           text,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_used       timestamptz
);

COMMENT ON TABLE data_sources IS
    'Every agency we read from, so a value in any table can be traced to an origin.';

-- Known sources. UPSERTed by the application so notes stay current.
INSERT INTO data_sources (key, name, agency, url, license, quota_per_day, notes) VALUES
 ('led', 'กรมบังคับคดี — LED auction listing', 'กรมบังคับคดี',
  'https://asset.led.go.th/newbidreg/default.asp', NULL, NULL,
  'Primary source. Auction lots, rounds, prices, images. Reliable, no quota observed.'),
 ('dol', 'กรมที่ดิน — LandsMaps', 'กรมที่ดิน',
  'https://landsmaps.dol.go.th/', NULL, 20,
  'Anonymous UI tier. Coordinates + exact parcel area. 20 lookups/day; NOT the published API (see NOTES §23).'),
 ('treasury_eva_area', 'กรมธนารักย์ — ราคาประเมินทุนทรัพย์ที่ดินประเภทอื่น', 'กรมธนารักย์',
  'https://catalog.treasury.go.th/dataset/101b9904-93b5-4fd4-ac73-569130b7165a',
  'Open Data Common', NULL,
  'Area-level appraisal by tambon + street class. Joins on กรมการปกครอง codes. 31,990 rows.'),
 ('treasury_eva_sheet', 'กรมธนารักย์ — ราคาประเมินที่ดิน (by ระวาง)', 'กรมธนารักย์',
  'https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f',
  'Open Data Common', NULL,
  'Per-parcel appraisal by ระวาง+เลขที่ดิน. The table LandsMaps reads. 4.86M price rows. Needs ระวาง, which LED omits.')
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name, agency = EXCLUDED.agency, url = EXCLUDED.url,
    license = EXCLUDED.license, quota_per_day = EXCLUDED.quota_per_day,
    terms_url = EXCLUDED.terms_url, notes = EXCLUDED.notes;

-- ---------------------------------------------------------- field provenance

CREATE TABLE field_provenance (
    id           bigserial PRIMARY KEY,
    entity_type  text NOT NULL,      -- parcel | auction_lot | auction_round | lot_image
    entity_id    bigint NOT NULL,
    field_name   text NOT NULL,
    source_key   text NOT NULL REFERENCES data_sources(key),
    observed_on  date NOT NULL DEFAULT CURRENT_DATE,
    observed_at  timestamptz NOT NULL DEFAULT now(),
    value_text   text,               -- Thai text as published
    value_num    numeric,            -- numeric form, when the field is numeric
    run_id       bigint REFERENCES scrape_runs(id),
    UNIQUE (entity_type, entity_id, field_name, source_key, observed_on)
);

CREATE INDEX field_prov_entity_idx  ON field_provenance (entity_type, entity_id);
CREATE INDEX field_prov_field_idx   ON field_provenance (field_name, observed_on);
CREATE INDEX field_prov_source_idx  ON field_provenance (source_key, observed_on);
CREATE INDEX field_prov_lookup_idx  ON field_provenance (entity_type, entity_id, field_name);

COMMENT ON COLUMN field_provenance.value_num IS
    'Numeric form for comparison. กรมที่ดิน area is ตร.วา; LED area is ไร่/งาน/ตร.วา, so never compare the two raw.';

-- ----------------------------------------------------- derived observations

-- Fields seen from more than one agency. This is the query that answers
-- "why does this lot show two different prices / areas?" instead of leaving it
-- to be guessed at later.
CREATE OR REPLACE VIEW provenance_divergence AS
SELECT entity_type, entity_id, field_name,
       count(DISTINCT source_key)                        AS source_count,
       string_agg(DISTINCT source_key, ', ' ORDER BY source_key) AS sources,
       min(observed_on)                                  AS first_seen,
       max(observed_on)                                  AS last_seen
FROM field_provenance
GROUP BY entity_type, entity_id, field_name
HAVING count(DISTINCT source_key) > 1;

-- A single source disagreeing with ITSELF on a later day: the agency changed
-- the value (a new assessment round, a re-listing). Distinct from divergence.
CREATE OR REPLACE VIEW provenance_drift AS
SELECT entity_type, entity_id, field_name, source_key,
       count(DISTINCT observed_on) AS days,
       count(DISTINCT coalesce(value_num::text, value_text)) AS distinct_values
FROM field_provenance
GROUP BY entity_type, entity_id, field_name, source_key
HAVING count(DISTINCT observed_on) > 1
   AND count(DISTINCT coalesce(value_num::text, value_text)) > 1;

-- Latest observation per (entity, field, source).
CREATE OR REPLACE VIEW provenance_current AS
SELECT DISTINCT ON (entity_type, entity_id, field_name, source_key)
       entity_type, entity_id, field_name, source_key,
       value_text, value_num, observed_at, observed_on
FROM field_provenance
ORDER BY entity_type, entity_id, field_name, source_key, observed_at DESC;

COMMIT;
