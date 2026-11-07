-- 035_report_resync.sql
--
-- The LED report stamp must not survive a sync that learned nothing.
--
-- Root cause of the missing history (ผบ.754/2562, deeds 24653 + 161371): the
-- browse-triggered sync stamped led_report_seen at 2026-10-30 02:14 while the
-- lot's dated rows had not landed yet (the provinces_id_seq blockage had ingest
-- writes held up that morning, and the 029 dated-key reshape landed the same
-- day). applyCase therefore hit both dead ends at once:
--
--   * the date-matched UPDATE ('2026-10-28' ↔ nothing dated) matched nothing;
--   * the history INSERT is gated on min(round_date) — minDate NULL → skipped.
--
-- One fetch, zero writes, stamp set anyway — and 029's heal had already run,
-- so nothing ever cleared it: stamp blocks every later retry forever. This is
-- not unique to 754/2562 — 83 lots carry a stamp and only 29 have any report
-- row to show for it.
--
-- Data-driven heal: reset the stamp only where the sync verifiably produced
-- nothing — no report-source history row exists AND no led_label was ever
-- written. Lots whose sync DID write keep their stamp; cases whose deed truly
-- does not appear on LED's sheet will re-sync once through the normal paths
-- and, because server/ledReport.js now stamps only when something applied or
-- the deed is genuinely absent from the sheet, they settle on the correct
-- post-029 outcome instead of a blind stamp.
--
-- The bulk admin endpoint picks rows up by led_report_seen IS NULL, and the
-- per-parcel browse path re-syncs as before.

UPDATE auction_lots l
   SET led_report_seen = NULL
 WHERE l.led_report_seen IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auction_rounds r
                    WHERE r.lot_id = l.id AND r.source = 'report')
   AND NOT EXISTS (SELECT 1 FROM auction_rounds r
                    WHERE r.lot_id = l.id AND r.led_label <> '');
