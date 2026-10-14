/* 013 — lot identity: deed and plot belong to the lot, not only to the parcel.
 *
 * The natural key was (parcel_id, case_no, case_year, order_number, order_sub,
 * first_round_date). parcel_id is the join to `parcels`, which only exists once
 * the TD/DOL match succeeds. For any province not yet matched — Phuket, Trang,
 * Chiang Mai — every lot has parcel_id NULL, so the key collapses to
 * (NULL, case, order, first_round_date) and one bankruptcy order becomes one
 * row. Phuket พ.376/2568 order 1-1 has five condominium units under one deed
 * number; they all fought over the same row and
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Verified against the source, not assumed:
 *   - พ.4302/2549 order 17-1, 84 lots, deeds 3704-3805, distinct prices ->
 *     84 genuinely different parcels.
 *   - พ.376/2568 order 1-1, 5 lots, deed 114461, plots 15/440-15/444, unit areas
 *     39.11-40.44 วา -> 5 different assets, one building. Sharing coordinates
 *     is correct for these; what differs is the unit.
 *
 * So the lot needs to carry its own deed and plot. Those are LED facts, present
 * whether or not any later enrichment matched, and they are exactly what
 * distinguishes a re-list (new first_round_date) from a re-scrape (same
 * first_round_date).
 *
 * The backfill keeps first_round_date last deliberately: it is the
 * re-list discriminator, and the deed/plot columns are what make a row unique
 * within one listing.
 */
BEGIN;

ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS deed_number text;
ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS plot_no text;

COMMENT ON COLUMN auction_lots.deed_number IS
  'เลขโฉนดจาก LED. For condominium listings this is the building deed, shared by every unit in it, so it does not identify a parcel on its own.';
COMMENT ON COLUMN auction_lots.plot_no IS
  'เลขห้อง/แปลงย่อยจาก LED (เช่น 15/440). Disambiguates units that share a deed number.';

DROP INDEX IF EXISTS lots_natural_key;

-- Existing Khon Kaen rows predate these columns; backfill from `parcels` so
-- they keep their existing identity and a re-scrape stays an update rather
-- than inserting a second copy of every lot.
UPDATE auction_lots l
   SET deed_number = p.deed_number
  FROM parcels p
 WHERE p.id = l.parcel_id
   AND l.deed_number IS NULL;

-- Any lot still without a deed number cannot be matched to a parcel row, so
-- give it a distinct value rather than leaving NULL: NULL would let it collide
-- with every other unmatched lot in the same order.
UPDATE auction_lots
   SET deed_number = 'unmatched:' || id::text
 WHERE deed_number IS NULL;

-- Created last, on purpose. Building the index before the backfill fails
-- immediately on the very rows this migration exists to rescue, because they
-- are still NULL at that point.
CREATE UNIQUE INDEX lots_natural_key
  ON auction_lots (
    case_no, case_year,
    coalesce(order_number, -1), coalesce(order_sub, -1),
    coalesce(deed_number, ''), coalesce(plot_no, ''),
    first_round_date
  );

COMMIT;