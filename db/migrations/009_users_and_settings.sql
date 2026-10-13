-- 009_users_and_settings.sql — per-user identity and app settings, moved off
-- localStorage and into Postgres so settings follow the user between machines.
--
-- The frontend currently keeps users, appearance, table layout and every named
-- annotation in browser storage. That makes "my settings" mean "this browser's
-- settings" and loses work on a cache clear. This moves the durable parts here.
--
-- Rich text: labels and notes are user-authored and need bold/italic/underline,
-- colours, and a leading emoji or shape. That is stored as jsonb rather than
-- HTML, so it is never interpreted as markup and cannot become stored XSS when
-- it is read back. One shape for all three places it appears (table column,
-- drawing layer, display area) — see user_style_shape() in the API.

BEGIN;

/* ------------------------------------------------------------------ users */

CREATE TABLE IF NOT EXISTS app_users (
    id            bigserial PRIMARY KEY,
    username      text UNIQUE NOT NULL,
    /* argon2id encoded hash, never a plaintext password. */
    password_hash text NOT NULL,
    display_name  text,
    avatar_path   text,
    avatar_color  text,
    is_admin      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN app_users.password_hash IS
    'argon2id PHC string. Never store or log the plaintext.';

/* Scalar app preferences (theme, map style, units, toggles). Key/value so a
 * new preference does not need a migration. */
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id     bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    key         text NOT NULL,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

/* ----------------------------------------------------------------- tables */

-- One row per (user, table, column). Covers show/hide, order, width and pinned,
-- plus the user's own label and note for the column.
--
-- `key` is the stable frontend column id (e.g. 'deed'), not the display text.
-- The user can rename it, so the label cannot be the identity.
CREATE TABLE IF NOT EXISTS user_table_columns (
    user_id     bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    table_key   text   NOT NULL,
    column_key  text   NOT NULL,
    label       text,
    note        text,
    style       jsonb  NOT NULL DEFAULT '{}'::jsonb,
    visible     boolean NOT NULL DEFAULT true,
    pinned      boolean NOT NULL DEFAULT false,
    sort_order  integer NOT NULL DEFAULT 0,
    width       integer,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, table_key, column_key)
);

COMMENT ON COLUMN user_table_columns.style IS
    'Rich text for the label/note: {b,i,u,bg,fg,badge}. bg/fg are CSS colours, badge is an emoji or shape char. Never HTML.';

/* ------------------------------------------------------- named annotations */

/* Drawings (line, polygon, circle) and display areas both let the user attach
 * a name and a note. They share one table because they share the annotation
 * shape; geom_type and kind tell them apart.
 *
 * geometry is kept as GeoJSON so the server does not need a geometry library —
 * it stores and returns annotations, it does not compute on them. */
CREATE TABLE IF NOT EXISTS user_layers (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    /* frontend-generated id, so unsaved drawings have a stable identity */
    layer_id    text   NOT NULL,
    kind        text   NOT NULL CHECK (kind IN ('drawing', 'display_area')),
    geom_type   text   CHECK (geom_type IN ('line', 'polygon', 'circle')),
    name        text,
    note        text,
    style       jsonb  NOT NULL DEFAULT '{}'::jsonb,
    geometry    jsonb,
    visible     boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, layer_id)
);

/* ---------------------------------------------------------------- status */

/* "Inactive" is distinct from "closed/sold": the lot ran its rounds unsold and
 * has since been pulled from LED's listing, so it should not compete with live
 * inventory but should stay in the table and on the map as history. */
ALTER TABLE auction_lots DROP CONSTRAINT IF EXISTS lots_status;
ALTER TABLE auction_lots
    ADD CONSTRAINT lots_status CHECK (status IN ('active', 'closed', 'inactive'));

ALTER TABLE auction_lots DROP CONSTRAINT IF EXISTS lots_close_reason;
ALTER TABLE auction_lots
    ADD CONSTRAINT lots_close_reason CHECK (
        close_reason IS NULL OR close_reason IN (
            'sold', 'seizure_revoked', 'cancelled_remaining_rounds', 'withdrawn'));

COMMENT ON COLUMN auction_lots.status IS
    'active = still listed. closed = ended (see close_reason). inactive = ran all rounds unsold and dropped off LED; kept as history, filtered out of live views.';

/* --------------------------------------------------------------- elevation */

-- Height above mean sea level, sampled from a DEM at the parcel point.
-- Kept nullable and always paired with a source name, because a number with no
-- provenance is worse than no number: it looks authoritative and is not.
ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS elevation_m        double precision,
    ADD COLUMN IF NOT EXISTS elevation_source   text,
    ADD COLUMN IF NOT EXISTS elevation_uncertainty_m double precision;

COMMENT ON COLUMN parcels.elevation_m IS
    'Metres above sea level from elevation_source. Null where no DEM covers the point or the parcel has no coordinate yet. Never treat as a flood verdict on its own.';

COMMIT;
