-- 011_parcel_annotations.sql — let the user name and note individual parcels.
--
-- The name/note columns in the bottom table are per-ROW annotations, the same
-- feature that already exists for drawings and display areas, aimed at a
-- different target. Reusing user_layers rather than adding a near-identical
-- table keeps one annotation shape, one API surface and one editor.
--
-- 'parcel' rows carry no geometry and no geom_type: the parcel already exists in
-- parcels, so this row only holds the user's text about it. layer_id is
-- namespaced as 'parcel-<id>' so a parcel id can never collide with a drawing id.
--
-- The CHECK on user_layers.kind is dropped and re-added rather than altered,
-- because PostgreSQL cannot extend a CHECK constraint in place.

BEGIN;

ALTER TABLE user_layers DROP CONSTRAINT IF EXISTS user_layers_kind_check;

ALTER TABLE user_layers
    ADD CONSTRAINT user_layers_kind_check
    CHECK (kind IN ('drawing', 'display_area', 'parcel'));

COMMENT ON CONSTRAINT user_layers_kind_check ON user_layers IS
    'drawing / display_area carry geometry; parcel rows are text-only and use layer_id ''parcel-<id>''.';

-- A drawing or an area needs a geom_type; a parcel annotation must not have one.
ALTER TABLE user_layers DROP CONSTRAINT IF EXISTS user_layers_geom_type_check;
ALTER TABLE user_layers
    ADD CONSTRAINT user_layers_geom_type_check CHECK (
        geom_type IS NULL OR geom_type IN ('line', 'polygon', 'circle')
    );

COMMIT;
