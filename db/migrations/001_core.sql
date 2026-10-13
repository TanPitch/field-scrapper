-- 001_core.sql — LED/DOL core domain.
--
-- Design notes that are easy to get wrong:
--
--  * A parcel can be auctioned many times. `auction_lots` records each
--    *appearance* on LED, not the parcel. Never overwrite: closed lots are
--    kept so price history and re-listing stay auditable.
--  * `auction_lots` natural key includes the auction cycle, because the same
--    case + order recurs across cycles with different rounds and prices.
--  * geo_status is three-valued. DOL returning a parcel does NOT mean it is the
--    right parcel — see NOTES.md §17, where 5 of 30 same-number hits were
--    different properties.
--  * Images belong to the lot, not the deed.
--  * Size units differ by asset type: land is rai/ngan/wa, condo is ตร.ม.

BEGIN;

-- PostGIS is expected to be installed by the image (postgis/postgis) or by
-- `CREATE EXTENSION postgis` before this script. Doing it here raced with the
-- image's own init and aborted the whole database, so it is not repeated.
-- Run once manually on a bare cluster:
--   CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- reference

CREATE TABLE provinces (
    id           smallserial PRIMARY KEY,
    code         smallint  NOT NULL UNIQUE,   -- LED and กรมที่ดิน share these
    name         text      NOT NULL,
    dol_code     smallint  NOT NULL          -- same as code today; kept separate
                                             -- so a future divergence is a data
                                             -- change, not a migration
);

CREATE TABLE districts (
    id           serial PRIMARY KEY,
    province_id  smallint NOT NULL REFERENCES provinces(code),
    -- LED's amphur code is 4 digits (4022), built as province*100 + dol_code.
    -- smallint overflows past 32,767, and province 320 alone gives 32000+, so
    -- this must be int.
    code         int NOT NULL,
    dol_code     smallint NOT NULL,          -- กรมที่ดิน 2-digit (22)
    name         text     NOT NULL,
    UNIQUE (province_id, code),
    UNIQUE (province_id, dol_code)
);

CREATE TABLE subdistricts (
    id           serial PRIMARY KEY,
    district_id  int NOT NULL REFERENCES districts(id),
    name         text NOT NULL,
    UNIQUE (district_id, name)
);

-- ------------------------------------------------------------------ parcels

-- The physical parcel. Survives across auctions; this is what DOL describes.
CREATE TABLE parcels (
    id                bigserial PRIMARY KEY,
    province_code     smallint NOT NULL REFERENCES provinces(code),
    district_dol_code smallint NOT NULL,
    deed_number       text    NOT NULL,      -- bare digits; suffix stripped
    land_title        text,                  -- โฉนด | น.ส.3ก. | ตามสำเนาโฉนด
    land_title_raw    text,                  -- LED's own spelling
    tumbol            text,
    district_name     text,
    province_name     text,

    -- กรมที่ดิน, fetched once per parcel and cached forever (NOTES §11)
    dol_status        text     NOT NULL DEFAULT 'pending',
    dol_land_type     text,
    dol_office        text,
    dol_land_price    numeric(14,2),
    dol_rai           numeric(10,2),
    dol_ngan          numeric(10,2),
    dol_wa            numeric(12,2),
    dol_lat           double precision,
    dol_lon           double precision,
    dol_checked_at    timestamptz,

    -- three-valued: DOL answered but it may be a DIFFERENT parcel
    geo_status        text     NOT NULL DEFAULT 'unresolved',
    geo_note          text,

    geom              geography(Point, 4326),
    first_seen        timestamptz NOT NULL DEFAULT now(),
    last_seen         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT parcels_unique UNIQUE (province_code, district_dol_code, deed_number),
    CONSTRAINT parcels_geo_status CHECK (geo_status IN ('unresolved','verified','mismatch'))
);

CREATE INDEX parcels_geom_idx ON parcels USING GIST (geom);
CREATE INDEX parcels_geo_status_idx ON parcels (geo_status) WHERE geo_status <> 'verified';
CREATE INDEX parcels_deed_idx ON parcels (deed_number);

-- --------------------------------------------------------------------- lots

-- One auction listing. The same parcel appears here many times over its life.
CREATE TABLE auction_lots (
    id                bigserial PRIMARY KEY,
    parcel_id         bigint NOT NULL REFERENCES parcels(id),

    case_no           text NOT NULL,          -- Thai red-case name, e.g. ผบE.1418
    case_year         smallint NOT NULL,
    court             text,
    plaintiff         text,
    defendant         text,
    owner             text,
    department        text,

    -- cycle identity: rounds start here and the whole listing belongs to it
    first_round_date  date NOT NULL,
    order_number      smallint,              -- fbidnum
    order_sub         smallint,              -- fsubbidnum (0 seen in the wild)
    order_label       text NOT NULL,          -- "N - M" as LED displays it

    asset_type        text,                  -- ที่ดินว่างเปล่า / ที่ดินพร้อมสิ่งปลูกสร้าง / ห้องชุด
    size_unit         text NOT NULL DEFAULT 'wa',   -- 'wa' | 'sqm'
    size_rai          numeric(10,2),
    size_ngan         numeric(10,2),
    size_wa           numeric(12,2),         -- ตร.วา, or ตร.ม. when size_unit='sqm'

    published_date    date,
    legal_exec_dept   text,
    remark            text,

    -- price cascade result (see pricing.js)
    start_price       numeric(14,2),
    start_price_src   text,                  -- committee|led|officer|expert
    committee_price   numeric(14,2),
    led_price         numeric(14,2),
    officer_price     numeric(14,2),
    expert_price      numeric(14,2),
    bid_security      numeric(14,2),

    status            text NOT NULL DEFAULT 'active',
    close_code        smallint,
    close_reason      text,
    closed_at         timestamptz,
    next_round_date   date,
    next_round_price  numeric(14,2),

    first_seen        timestamptz NOT NULL DEFAULT now(),
    last_seen         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT lots_status CHECK (status IN ('active','closed')),
    CONSTRAINT lots_close_reason CHECK
        (close_reason IS NULL OR close_reason IN
         ('sold','seizure_revoked','cancelled_remaining_rounds'))
);

-- The natural key. first_round_date pins the auction cycle, so a re-listed lot
-- becomes a NEW row instead of overwriting the old one.
CREATE UNIQUE INDEX lots_natural_key ON auction_lots
    (parcel_id, case_no, case_year, coalesce(order_number, -1),
     coalesce(order_sub, -1), first_round_date);

CREATE INDEX lots_live_idx ON auction_lots (status, next_round_date)
    WHERE status = 'active';
CREATE INDEX lots_close_idx ON auction_lots (close_reason) WHERE status = 'closed';
CREATE INDEX lots_cycle_idx ON auction_lots (first_round_date);

-- ------------------------------------------------------------------- rounds

CREATE TABLE auction_rounds (
    id           bigserial PRIMARY KEY,
    lot_id       bigint NOT NULL REFERENCES auction_lots(id) ON DELETE CASCADE,
    idx          smallint NOT NULL,          -- 1..N, N varies per lot
    round_date   date,
    status_code  smallint,
    status_label text,
    is_held      boolean NOT NULL DEFAULT false,
    discount_pct smallint NOT NULL DEFAULT 0,
    price        numeric(14,2),
    scraped_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lot_id, idx),
    CONSTRAINT rounds_status CHECK (status_code IS NULL OR status_code IN (0,1,3,6,7,10,13,23,26))
);

CREATE INDEX rounds_due_idx ON auction_rounds (round_date) WHERE round_date IS NOT NULL;

-- ------------------------------------------------------------------- images

-- Lot-level: LED serves ONE photo set per listing, shared by every deed.
CREATE TABLE lot_images (
    id          bigserial PRIMARY KEY,
    lot_id      bigint NOT NULL REFERENCES auction_lots(id) ON DELETE CASCADE,
    kind        text NOT NULL,               -- photo | survey | map
    url         text,
    local_path  text,
    content_sha text,
    bytes       integer,
    fetched_at  timestamptz,
    UNIQUE (lot_id, kind)
);

-- ------------------------------------------------------------- ingest audit

-- One row per (province, scrape night). Lets us prove coverage and detect the
-- moment a lot vanishes from LED.
CREATE TABLE scrape_runs (
    id           bigserial PRIMARY KEY,
    province_code smallint REFERENCES provinces(code),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    pages        integer,
    lots_seen    integer,
    lots_new     integer,
    lots_closed  integer,
    error_count  integer,
    notes        text
);

CREATE INDEX scrape_runs_province_idx ON scrape_runs (province_code, started_at DESC);

COMMIT;