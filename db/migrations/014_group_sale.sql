/* 014 — group-sale note, reduced to the two numbers worth keeping.
 *
 * LED writes a remark on a lot sold as part of a group:
 *   "เป็นการขายกลุ่มที่ 4, ขายรวม (แปลงที่ 40 - 72) รวม 33 แปลง,
 *    ราคาประเมินรวม 17,329,950.-บาท"
 *
 * Only the lot count and the assessed total are stored. The group number and
 * the plot range are not: nothing reads them, and every field carried forward
 * is another thing that can drift from what LED writes.
 *
 * Both numbers exist to make the row checkable rather than to be displayed.
 * Every lot in a group carries the same assessed total rather than a share of
 * it, so group_total_price should equal that lot's own start_price, and the
 * number of lots sharing a ลำดับการขาย should equal group_lot_count. A
 * mismatch means the scrape lost a lot, which is otherwise invisible.
 *
 * NULL on both for a lot sold on its own; a single-double NULL on one column
 * would mean the remark was half understood, so the parser returns null
 * instead rather than letting a partial reading look like a real group.
 */
BEGIN;

ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS group_lot_count integer;
ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS group_total_price bigint;

COMMENT ON COLUMN auction_lots.group_lot_count IS
  'จำนวนแปลงในกลุ่มขายรวม ตามที่ LED ระบุใน remark — ใช้ตรวจว่าดึงข้อมูลครบ';
COMMENT ON COLUMN auction_lots.group_total_price IS
  'ราคาประเมินรวมของกลุ่ม ตามที่ LED ระบุ — ทุกแปลงในกลุ่มมีค่านี้เท่ากัน ไม่ใช่ส่วนแบ่งต่อแปลง';

COMMIT;