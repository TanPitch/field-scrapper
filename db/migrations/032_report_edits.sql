-- 032_report_edits.sql — user reports + the admin edit trail.
--
-- parcel_reports: a signed-in user flags a parcel ("LED's own figure is
-- wrong"). One row per report; the admin pane lists the open ones, closes them
-- by hand. Nothing here writes back to the parcel — only the admin's edit does.
--
-- parcel_edits: every admin write to parcel/auction-lot data, one row per
-- field, with old and new value. The detail panel renders this as
-- "led site -> 0-1-16 -> 0-1-61 (03/11/26 11:34)". Deletions are rows, not
-- erasures, so the trail can never lose a value.
--
-- Field names are database column names (tumbol, deed_number, ...) plus the
-- synthetic image_added / image_removed, so a history row names itself.

CREATE TABLE parcel_reports (
    id          bigserial PRIMARY KEY,
    parcel_id   bigint NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    topic       text NOT NULL,
    detail      text NOT NULL,
    status      text NOT NULL DEFAULT 'open',  -- open | handled
    handled_by  bigint REFERENCES app_users(id),
    handled_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- The badge counts open reports; the pane sorts by age.
CREATE INDEX parcel_reports_open_idx ON parcel_reports (status, created_at DESC);

CREATE TABLE parcel_edits (
    id          bigserial PRIMARY KEY,
    parcel_id   bigint NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    lot_id      bigint REFERENCES auction_lots(id) ON DELETE SET NULL,
    field_name  text NOT NULL,                 -- parcels/auction_lots column, or image_added/image_removed
    old_value   text,
    new_value   text,
    note        text,
    edited_by   bigint NOT NULL REFERENCES app_users(id),
    edited_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parcel_edits_parcel_idx ON parcel_edits (parcel_id, edited_at DESC);
