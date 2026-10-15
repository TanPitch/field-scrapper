-- 020_adopt_led_to_td_map.sql
--
-- The LED->TD district map (test/research/led_to_td/led_to_td_map.json) shows
-- the relationship is many-to-one, which 019 assumed it was not.
--
-- LED still lists dissolved districts beside their replacements, and TD merged
-- them, so one TD district legitimately answers for several LED districts:
--
--     LED prov 10 td 13:  1013 สัมพันธวงศ์ || 1055 สำเพ็ง || 1063 จักรวรรดิ(สามเพ็ง)
--     LED prov 43 td 02:  4302 ท่าบ่อ      || 4304 พรเจริญ
--
-- 59 such keys exist, covering 125 rows. UNIQUE (province_id, td_code) rejects
-- every one of them, so the index 019 created cannot hold real data.
--
-- td_code alone is also ambiguous: LED 25 ปราจีนบุรี and LED 27 สระแก้ว both
-- carry td_code 01, and they are different TD districts. The TD province has
-- to travel with the district code, so it is stored per-district rather than
-- inferred from provinces.dol_code.
--
-- match_method and note are kept so a resolver can tell an exact same-province
-- match from a cross-province one, an alias, or a tambon-evidence inference.
-- A lookup that silently trusts a manual_pin over an exact match is worse than
-- one that admits uncertainty.

DROP INDEX IF EXISTS districts_td_code_idx;

ALTER TABLE districts ADD COLUMN IF NOT EXISTS td_province_code smallint;
ALTER TABLE districts ADD COLUMN IF NOT EXISTS td_match_method text;
ALTER TABLE districts ADD COLUMN IF NOT EXISTS td_note text;

CREATE INDEX IF NOT EXISTS districts_td_lookup_idx
    ON districts (td_province_code, td_code) WHERE td_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS districts_led_code_idx
    ON districts (code);

COMMENT ON COLUMN districts.td_province_code IS 'TD province code; differs from LED after the 2013 province reorganisation';
COMMENT ON COLUMN districts.td_code         IS 'TD AMPH_CODE; several LED districts may share one, NULL when unmatched';
COMMENT ON COLUMN districts.td_match_method IS 'exact_name_same_prov | exact_name_cross_prov | alias | mueang_prefix | tambon_evidence | paren_hint | manual_pin | code_same_renamed | unmatched';
COMMENT ON COLUMN districts.td_note         IS 'why this mapping was chosen; non-empty where confidence is not automatic';