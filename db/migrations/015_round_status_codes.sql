/* 015 — widen the round-status allow-list.
 *
 * The CHECK in 001 was written from one province's data and enumerates the
 * codes that province happened to produce. LED emits more than that: Khon Kaen
 * alone brings code 4 and code 12, and ingest aborted on the first of them, so
 * the province could not be loaded at all.
 *
 * 4 and 12 are stored, not invented. Both arrive from LED carrying the
 * placeholder text "ไม่รู้จัก(รหัส N)" - LED itself does not label them - so the
 * parser passes them through verbatim and the UI shows that same placeholder
 * rather than guessing a meaning. Widen the constraint to what the site actually
 * sends rather than narrowing the scraper to what the schema once allowed.
 *
 * Both are rare: one round each in Khon Kaen.
 *
 *   ผบE.5644/2565  order 17-1  deed 272772  plot 200/257  2026-09-09  code 12
 *   ผบE.650/2564   order 67-1  deed 104660                2026-08-19  code 4
 */
BEGIN;

ALTER TABLE auction_rounds DROP CONSTRAINT IF EXISTS rounds_status;
ALTER TABLE auction_rounds ADD CONSTRAINT rounds_status
  CHECK (status_code IS NULL OR status_code IN (0,1,3,4,6,7,10,12,13,23,26));

COMMENT ON CONSTRAINT rounds_status ON auction_rounds IS
  'Codes LED emits. 4 and 12 are unlabelled by LED and arrive as placeholders; kept so one unseen code cannot block a whole province.';

COMMIT;