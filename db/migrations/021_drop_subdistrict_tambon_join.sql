-- 021_drop_subdistrict_tambon_join.sql
--
-- Removing subdistricts.dol_code.
--
-- It was only ever populated by matching LED tambon NAMES against TD tambon
-- names, and that guess did not hold up: a full pass left 61 LED districts with
-- nothing to match and 42 TD tambons with no LED counterpart. Bangkok's legacy
-- offices (แสนแสบ, สำเพ็ง, จักรวรรดิ (สามเพ็ง), คลองกุ่ม, คลองตัน) returned no
-- tambons at all from LED, and several Nakhon Ratchasima districts did the same.
--
-- The reason is structural, not a tuning problem. LED publishes no numeric tambon
-- id - get_tambon.asp returns a postcode, and 83000 stands in for "no postcode"
-- across five different Phuket tambons - so a tambon can only be joined by name,
-- and name-matching across two systems' spellings is guesswork.
--
-- It is also unnecessary. LED is searched by province and district and answers in
-- text, and the parcel data needed downstream - lat/lng, ระวาง, price per sqwa,
-- size - comes from TD addressed by deed number plus province and district. The
-- tambon is carried as LED's own text for display and is never a join key.
--
-- So subdistricts keeps exactly what LED actually asserts: which tambon names sit
-- in which district. eva_code stays, because that comes from กรมการปกครอง
-- reference data rather than from matching two live sites against each other.

ALTER TABLE subdistricts DROP COLUMN IF EXISTS dol_code;

DROP INDEX IF EXISTS subdistricts_dol_code_idx;

/* led_code held LED's get_tambon.asp option value, which is a postcode, and was
 * cleared to NULL once that was understood. A column named led_code implies LED
 * publishes a tambon id, which is the opposite of the truth and the thing that
 * sent this down the wrong path in the first place. */
ALTER TABLE subdistricts DROP COLUMN IF EXISTS led_code;

DROP INDEX IF EXISTS subdistricts_led_code_idx;

COMMENT ON TABLE subdistricts IS
    'Tambon names exactly as LED lists them, grouped by district. Display text only - there is no subdistrict code on LED and no join to TD. eva_code, when present, comes from กรมการปกครอง reference data.';