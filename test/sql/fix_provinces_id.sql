-- 2026-11-06: provinces_id_seq (smallint-backed, max 32767) exhausted by
-- per-lot INSERT..ON CONFLICT upserts that burned one nextval per attempt
-- even when the row already existed. ensureProvince in test/ingest.js is now
-- SELECT-then-write (no wasted nextval); this widens the column to int4 as
-- belt-and-braces and resets the sequence to the real max id (77 provinces).
ALTER TABLE provinces ALTER COLUMN id TYPE integer;
ALTER TABLE provinces ALTER COLUMN id SET DEFAULT nextval('provinces_id_seq'::regclass);
ALTER SEQUENCE provinces_id_seq AS integer;
SELECT setval('provinces_id_seq', (SELECT max(id) FROM provinces));
