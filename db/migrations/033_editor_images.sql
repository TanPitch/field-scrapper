-- 033_editor_images.sql — the editor can carry several images per lot, order
-- them, and history rows can point at the round they belong to.
--
-- 1. parcel_edits.ref_id — round_price rows name auction_rounds.id, so a
--    history line can be reverted to the printed figure. Older rows keep null;
--    their revert button stays off.
--
-- 2. lot_images.sort_no — display order. Null keeps the id order.
--
-- 3. (lot_id, kind) was the bot's REPLACE key — one photo + one survey per lot.
--    Admin uploads need N photos per lot. (lot_id, url) replaces by link for
--    the bot's re-fetch and for an admin re-adding the same URL; uploaded
--    files carry a distinct sha-named local file each, and their url stays
--    null, which a unique index never treats as a duplicate.

ALTER TABLE parcel_edits ADD COLUMN ref_id bigint;

ALTER TABLE lot_images ADD COLUMN sort_no integer;

ALTER TABLE lot_images DROP CONSTRAINT lot_images_lot_id_kind_key;
ALTER TABLE lot_images
    ADD CONSTRAINT lot_images_lot_url_key UNIQUE (lot_id, url);
