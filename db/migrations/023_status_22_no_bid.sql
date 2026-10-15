-- 023_status_22_no_bid.sql
--
-- Allow status 22.
--
-- LED labels it "ไม่รู้จัก(รหัส 22)" - the site does not know either - and the
-- rounds_status check constraint rejected it, which killed the whole บึงกาฬ and
-- ปราจีนบุรี ingest mid-transaction.
--
-- Confirmed on LED as งดขาย: ผบE.1648/2564, ที่ดินพร้อมสิ่งปลูกสร้าง, deed 23720,
-- 0-0-39 ตร.วา, ท่าตูม ศรีมหาโพธิ ปราจีนบุรี, round 1 on 2026-08-13.
-- So it behaves like 13/14/15/23: the round did not happen, and it carries no
-- discount.

ALTER TABLE auction_rounds DROP CONSTRAINT IF EXISTS rounds_status;

ALTER TABLE auction_rounds ADD CONSTRAINT rounds_status CHECK (
    status_code IS NULL
    OR status_code = ANY (ARRAY[0,1,3,4,6,7,10,12,13,14,15,16,22,23,26])
);