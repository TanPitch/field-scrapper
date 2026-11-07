# PROGRESS — อ่านไฟล์นี้ก่อนเสมอ (ทุก session)

เป้าหมายหลักเดียว: **ผู้ใช้เห็นราคาคดี กับราคาที่ดิน แล้วตัดสินใจได้ว่าจะซื้อหรือขาย**

ไฟล์นี้คือสมุดติดตามงาน: เป้าหมาย, ค่าทดสอบที่ต้องเขียว, สถานะโมดูล, งานถัดไป, บันทึกแบตช์.
กติกา session: **อ่านก่อน → ทำงาน → อัปเดตค่าในไฟล์นี้ → commit → push dev**

---

## 1. ค่าทดสอบที่ต้องผ่าน (test ledger)

| หลักฐาน | คำสั่ง | ผลที่ต้องได้ | ค่าล่าสุด 2026-11-06 |
|---|---|---|---|
| โครงสร้าง | `bun run typecheck` | 0 error | ✓ 0 |
| build | `bun run build` | 0 error | ✓ 0 (1,764 modules, bundle 4,263 kB) |
| ชุด test | `cd test` + `set DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap` + `bun test` | fail จากโค้ด = 0 | ✓ 169 pass / 0 fail (รันชุดเดียววนซ้ำเคย 3-9 fail = NAS DB หลุด/timeout ไม่ใช่โค้ด, รันซ้ำให้เขียวก่อน commit) |
| ladder เทียบ BE/FE | priceLadder.agreement | mismatch ยอมได้ = lot 9556 เท่านั้น | ✓ 117 rows เฉพาะ 9556 (daybot drift — เป็น RCA แยกต่างหาก) |
| ผ่านจอ | ผู้ใช้เปิดหน้า + ลองฟีเจอร์จริง | ตามรายการท้ายไฟล์นี้ | รอผู้ใช้ |

ข้อที่ละเว้นได้: `DATABASE_URL` ไม่ตั้ง = แต่ละ test ข้ามตัวเอง (print skip) — นับเป็นปกติ.

---

## 2. สถานะโมดูล (✓ = ผ่านหลักฐานข้างบนแล้ว ไม่ต้องลุ้นซ้ำ)

- ✓ แผนที่ + marker + popup + คลิกเลือก — `src/map`, popup markup ทดสอบด้วยข้อมูลจริง
- ✓ ข้อมูลจริงจากเซิร์ฟเวอร์เท่านั้น — ชุด mockup ถูกลบ: โหลดไม่ได้ = แผนที่ว่างจริง + banner + toast พูดตรง
- ✓ ตาราง + ค้นหา + กรอง + picker ต่อคอลัมน์
- ✓ ladder ราคา — FE/BE ตรงกันทุก round ใน DB (ยกเว้นล็อต 9556 drift)
- ✓ กฎสถานะรายการขาย: code 26 + กฎ idx (listingRounds) — 32581 โชว์ ยกเลิกการขาย แล้ว
- ✓ ข้อมูลตกหล่น — parser เดียวกันกับ editor (lib/coord.ts), ปุ่มกดเลือกบนแผนที่
- ✓ ปุ่มรายงานผู้ใช้ → bell แอดมิน (poll 30 s) + pane จัดการ
- ✓ Admin editor: ที่ตั้ง (datalist 3 ระดับ ค้น/พิมพ์ใหม่ได้, dict = DISTINCT ของ parcels), โฉนด, ขนาด, ราคาเริ่ม (คอมม่า + ค่าจริง lot.start_price), พิกัดช่องเดียว + วาง, ราคาต่อนัด
- ✓ รูป: thumbnail + ลบ + อัปโหลดไฟล์ตรง (raw → sha file) + เรียงลำดับ + เพิ่ม URL
- ✓ ประวัติ parcel_edits + ปุ่มกลับค่า (ย้อน = เขียนแถวประวัติใหม่ จึงยังตรวจสอบได้)
- ◇ รอตรวจจอแรกหลังรีรัน server — รายการอยู่ท้ายไฟล์นี้
- ◇ batch 5 (แผงแก้ไขแอดมินแยกต่างหาก + popup จุดค้นหา) — ตาราง/บิลด์ผ่านแล้ว รอตรวจจอ

---

## 3. งานถัดไป (เรียงตามที่ควรทำ)

1. **Phase 5 — backfill ทั่วไทย 72 จังหวัด** — ingest fix เขียวแล้ว (batch 8); crisp cron จะเก็บจังหวัดที่มีข้อมูลเองทุก 06:00; จังหวัดใหม่ใช้ `bun backfillProvinces.js` ก่อน (ครั้งแรก 2-3 จังหวัด ตรวจ scrape_runs error_count=0 ก่อนขยาย)
2. **ตรวจจอ ServerPane โควตา DOL + ตารางจังหวัด 77** — โค้ดขึ้นแล้ว (68d6dbf); restart API :8787 แล้วเปิด ตั้งค่า → บอท
3. **ลบ Task ทดสอบ** `FieldScrapper-Bot1-TestOnce` — พาธ cron พิสูจน์แล้ว (batch 8: scrape เขียว 5 จังหวัด, ingest ตายแค่ seq แก้แล้ว)
4. **รันแอปบน Docker** — pack พร้อมแล้ว 23 ต.ค. (`server/Dockerfile` + `docker/portainer-stack.yml`); อัปโหลดรูปจะย้ายไปเก็บ IMAGE_ROOT บน NAS ด้วย
5. **RCA lot 9556 daybot drift** — ราคาที่ daybot เขียนไว้ (1077180) ไม่ตรง ladder คำนวณ (754026) ทุก round นับจาก 10; แยกต่างหาก ไม่ถือข้อบกพร่องของ commit อื่น
6. **แตก chunk 4.25 MB** — ปรับ `manualChunks` เมื่องานหลักเสร็จ

---

## 4. Batch log (ใหม่อยู่บน)

- **2026-11-06 batch 8 — RCA seq provinces_id_seq เต็ม (32767) + แก้ 2 ชั้น**
  - **อาการ จริงจาก cron**: บอท 1 (TestOnce 10:18) scrape 5 จังหวัดเขียวทั้งหมด (40/97/27/25/83, รวม 6,049 lots เห็นใน run rows 80-84) แต่ ingest ล้มทุกจังหวัด `error: nextval: reached maximum value of sequence "provinces_id_seq" (32767)` (code 2200H)
  - **RCA**: `provinces.id` = smallint (max 32767) + `ensureProvince` ถูกเรียกต่อรายการ (per deed) แบบ `INSERT .. ON CONFLICT DO UPDATE` — แม้ conflict (เจอของเดิม) Postgres ก็จ่าย nextval หนึ่งโดนทิ้ง = ลำดับ long tail กินจนหมด; 791 รายการ × หลายปี backfill
  - **แก้ 2 ชั้น**: (1) `test/ingest.js ensureProvince` เปลี่ยนเป็น SELECT-ก่อน แล้ว UPDATE/INSERT จริงเมื่อไม่มี (จังหวัดมีแค่ 77 แถว — read ถูก, write หา) = ไม่กิน nextval ให้ของว่าง; (2) `test/sql/fix_provinces_id.sql` — `ALTER TABLE provinces ALTER COLUMN id TYPE integer` + `ALTER SEQUENCE ... AS integer` + `setval(max(id))`, ยิงใส่ fs-db แล้ว (id_type = integer, seq = 4537 = เลข id จริงสูงสุด)
  - **ยืนยัน**: ลอง slice 20 แถวจาก rows.json ของคืนจริง ผ่าน `SKIP_IMAGES=1` → `lotsUpdated 20, rounds 160, elapsed 0.9s` `=== ingest result ===` เขียว; ยืนยัน tiers id ไม่พอง (districts id>32767 = 0)
  - **ขัดแย้งที่พบระหว่างนี้**: ingest เต็ม 7 MB วิ่งช้า 3s/แถว เพราะชนกับงาน resolveCoordsCLI/resolveTdParcels ที่รันทับ (cmd window ว่างที่ผู้ใช้ปิด) — ข้อมูลจังหวัด 83 เข้าครบแล้วตั้งแต่รอบแรก (927 lots / 7,416 rounds); cleanup orphan scrape_runs 85/87/88 ลบแล้ว; bun test 1 fail ชั่วคราว (TIMEOUT tdSrid) = DB ติดงานอื่น, รันซ้ำเขียว 169/0

- **2026-11-06 batch 7 — audit ข้อ 1+2 + cron ขั้น 3 (68d6dbf) + ปุ่ม more ปิดนอกจอ**
  - **ข้อเท็จจริง 267581 hole**: แถวซ้ำ 5 ในตารางล่าง = DB ตรวจแล้วไม่มีแถวซ้ำจริง (dup by province+deed → แยกอำเภอถูกกฎหมาย; key จริง (province,district,deed) ซ้ำ 0); 1 ห้องชุด 267581 มี 2 สำนวน (2494/2561 + 57/2562 = ขายทบ) — ข้อมูลถูกต้องตาม LED
  - **ปุ่ม more (ซูม · รายงาน)**: dropdown เดิมเปิดค้างถ้าไม่คลิกตัวมันเอง — `useOutsideClose([moreRef])` ห่อ button + กล่อง dropdown ใน ref เดียว, Esc ปิดด้วย
  - **SECURITY.md + CI**: `.github/workflows/ci.yml` รัน typecheck + build ทุก push `dev` (`bun test` integration ต่อ NAS DB จาก runner ไม่ได้ ยกให้ local); secrets policy เขียนกติกา env / LAN credential ห้ามย้ายขึ้น cloud โดยไม่ rotate; ยืนยัน argon2id + DUMMY_HASH timing guard ใน `server/users.js` แล้วเขียนตามจริง
  - **cron ขั้น 3 ออนจอ**: `/api/status` เพิ่ม `dol` (โควตาวันนี้ used/limit) + `provinces` (77 จังหวัด = active lots + วันเก็บล่าสุด, subquery ต่อจังหวัดไม่ซ้อน cross join); ServerPane โชว์แถว "โควตา DOL วันนี้" (แดงเมื่อเต็ม 20/20) + ตารางจังหวัด scroll — ใช้หน้านี้ตัดสิน Phase 5
  - **bot ทดสอบจริง**: Task `FieldScrapper-Bot1-TestOnce` ONCE 10:18 → State Running (ผลล่าสุด 267009 = running); ไล่จังหวัด 40 (1,757 lots) แล้ว 97/27/25/83; log `test/out/bot1-schedule.log`

- **2026-11-06 batch 6 — cron step 1+2 ครบ + RCA ingest 42P18**
  - **RCA ingest (บั๊กเก่าตั้งแต่ commit 033)**: `test/ingest.js` นัดไม่ระบุวันที่ INSERT `VALUES ($1,$2,NULL,$4,…$8)` — สลับหมายเลขพารามิเตอร์: NULL แทน round_date แล้วหนุ่ง $3 ตกบัฟเฟอร์ ทำให้ทุกแถว LED ที่มีนัดไม่มีวันที่ ingest ล้ม `42P18 could not determine data type of parameter $3` — แก้เป็น `$1..$7` (7 พารามิเตอร์ตรงกับอาร์เรย์จริง); สาขามีวันที่ (บรรทัด 482-485) ถูกอยู่แล้ว ห้ามแตะ
  - **bot 1 สมอง cron**: `test/scrapeDay.js` — จังหวัดค้างเก็บเมื่อ active lot ใดมี `next_round_date <= current_date` (วันเก่าหายไป ยังเข้างานเอง = self-heal); กันรันซ้ำด้วย run_key `night:<วันที่ICT>:<code>` — แถว finished + error_count=0 = ข้าม; โหมด `--dry` ลิสต์ไม่ทำ, `97` = บังคับรหัสเดียว
  - `test/run-bot1.cmd` พร้อม Task Scheduler: รองรับ `SCRAPEDAY_ARGS=--dry` ทดสอบ wiring โดยไม่ scrape จริง (dry ผ่านจอ: 5 จังหวัดค้างเก็บ 40/97/27/25/83); บทเรียน: **อย่าลอง wiring ตัวจริงผ่าน shell agent** — ปืนไป 5 จังหวัดที่ล่า 10 นาที/จังหวัด ตัวจบคือ timeout ครึ่งทางจังหวัด 40 (run_key ยังไม่ปิด = กลางคืนจะรันซ้ำทั้งจังหวัด)
  - Task Scheduler แล้ว 2 งาน: `FieldScrapper-Bot1-LED` 06:00 ทุกวัน→run-bot1.cmd, `FieldScrapper-Bot2-Coords` ทุก 1 ชม. เริ่ม 08:00→run-bot2.cmd — ทั้งคู่ Ready
  - `ParcelReport.tsx` กำจัด prop `i` ที่ TS6133 จับ (ตัดจาก RoundPriceRow + map); probe `tmp_schema.js`/`tmp_ing.js` + ล็อก RCA ลบแล้ว
  - สถานะถัดไป: ขั้น 3 = ServerPane แสดง scrape_runs/dol_quota_ledger/last-scrape-per-province (ข้อมูลแค่ /api/status เดิม)

- **2026-11-05 batch 5 — แผงแก้ไขแอดมินแยกต่างหาก + popup จุดค้นหา + RCA prefs (`k in SYNCED_PREFS`)**
  - editor ตัดออกจากท้าย DetailView → `<EditPanel>` (grid area `ep`, กว้าง 300) วางข้างแผงรายละเอียด; เปิด/ปิดด้วยปุ่มประแจในแถบ chip; ตาม selection อัตโนมัติ (อ่าน selectedId เดียวกัน); จอเล็ก = overlay ทับแผงขวา (z-48)
  - RCA: `loadPrefs` ใช้ `k in SYNCED_PREFS` กับ array → grep เจอแต่ดัชนี (0,1,2…) ทุก key หลุดมาตลอด — ค่าที่เซิร์ฟเวอร์เก็บไว้ไม่เคยถูกโหลดกลับ (รวม gkey/Google API) → เปลี่ยนเป็น `(SYNCED_PREFS as readonly string[]).includes(k)`; DB ยืนยัน: user_prefs มี `gkey:""` สะสมไว้จริง
  - editor: ราคาเริ่มประมูล + ราคานัด พิมพ์แล้วใส่คอมม่าเอง (helper `commas`, เซฟตัดคอมม่าแบบเดิม); thumbnail คลิกลุยรูปเต็มด้วย overlay ทึบ (คลิกปิด); **วางพิกัดคลิกแผนที่** = state `coordPick` — แผนที่งดกระทบ selection ตอนกำลังวาง (เดิมคลิกเมจิกแตะทั้ง deselect ผ่าน autoDeselect เลือกหลุด panel ปิด)
  - จุดค้นหาออนไลน์บนแผนที่: คลิก = popup เล็ก (ชื่อ + แหล่งที่มา) โหมด pop-box--compact, hover เป็น pointer, ยังเปิดแหว่ง + วิ่งไป marker เดิมด้วย pick handler; plotSearch เคลียร์ popup เมื่อค้นใหม่/เคลียร์
  - ล้างช่องค้น (ปุ่ม ✕ / ลบหมด) ยังเป็น path เดียวของ runSearch(''): rows เคลียร์ + marker + ring + dropdown ตรวจแล้วยังตรง — บททด 01a8365 ยืนอยู่

- **2026-11-05 batch 4 — ลบ mockup, admin editor ครบเครื่อง, RCA 32581/518, จัดระเบียบ docs**
  - `src/data/mockData.ts` ลบ — liveData เหลือ state `'loading'/'api'/'error'`; banner + toast แจ้งตรง, ตัดปัญหาข้อมูลตัวอย่างมั่วแทนข้อมูลจริง
  - editor ที่ตั้ง: datalist จาก `GET /api/admin/place-dict` (DISTINCT trio, 409 แถววันนี้); ราคา = `auction_lots.start_price` แสดงคอมม่า; พิกัดช่องเดียวผ่าน `src/lib/coord.ts`; รูป: sort_no + upload (express.raw, sha ตั้งชื่อไฟล์, unique (lot_id,url)); migration 033 (+ dedupe แถวซ้ำ 2 แถว ของ lot 7776/7553)
  - ปุ่มกลับค่าใน parcel_edits — round_price เก็บ ref_id, รูปที่ลบกลับได้ด้วย URL เก่า
  - RCA(H1): รูป 518/11737/32581 โชว์ alt text — client เคย prepend `/img/land/` ซ้ำบน URL ที่ server ส่งมาสุดท้ายแล้ว → ตัด prepend ที่ client
  - RCA(H2): chip 32581 = กำลังขาย ทั้งที่ LED งดขายหมดทุกนัดของรายการ — `every(dated)` นับแถวรายงานปี 2025 (`idx null`) ร่วมลงความเห็น → กฎ idx: **นัดปัจจุบัน = แถวมี idx; แถวรายงานเก่า = idx null ไม่มีสิทธิ์ตัดสิน** (helper `listingRounds` ใช้ทั้ง `listingCancelled` + `neverOnMarket`)
  - `test/ingest.js` ON CONFLICT ตาม key ใหม่ (lot_id, url); `test/priceLadder.agreement.test.js` corpus popup = 4 แถว Parcel ตาม DB จริง
- **2026-11-04 batch 3 — รายงาน→ผู้ดูแล flow + admin edit trail + RCA 518 cell / 161371 พิกัด (d7febf9)**
- **2026-11-03 batch 2 — กดพิกัดจากแผนที่เข้าข้อมูลตกหล่น + งดขายในนัดที่เหลือ (857a11f)**
- **2026-11-03 batch 1 — ตารางราคาแยกซอง + code 26 (01a8365)**

---

## 5. กติกา repo (ย่อ — รายละเอียดที่ AGENTS.md)

- push `dev` เท่านั้น — `main` สำหรับ version; **AUDIT.md ห้ามเข้า commit เด็ดขาด**
- RCA = พิสูจน์จากฐานข้อมูลก่อนแก้โค้ด ห้าม hardcode เคสเฉพาะ
- DB + รูปอยู่ NAS fs-db :33200; ต่อไม่ได้ = ตรวจ `Test-NetConnection` ก่อน อย่าสรุปว่าโค้ดพัง
- ห้ามรัน server ยาวใน agent shell (ผู้ใช้รันเอง); probe = ไฟล์ `test/tmp_*.js` แล้วลบหลังใช้ และคืนค่า DB "ทั้งแถว" ไม่ใช่บูลีน (บทเรียน 161371)

### รายการตรวจหน้าจอ (ผู้ใช้ — หลัง restart API :8787 แล้ว reload)

1. เปิดแอป: banner กำลังโหลด + toast นับจำนวนแปลง; API ยังไม่พร้อม = แผนที่ว่าง + banner error (ไม่มีข้อมูลตัวอย่างแล้ว)
2. 518 / 11737 / 32581 — รูปโชว์จริง (ไม่ใช่ alt text); 32581 status chip = ยกเลิกการขาย แต่ตารางราคายังมี งดขายในนัดที่เหลือ
3. editor: พิมพ์ตำบล/อำเภอ/จังหวัด เห็น dropdown ค้นได้ พิมพ์ชื่อใหม่ได้; ราคา = ตัวเลขคอมม่า (เช่น 1,381,600); พิกัดช่องเดียว (พิมพ์หรือกด วาง แล้วคลิกแผนที่)
4. รูปใน editor: thumbnail + ปุ่มลบ + อัปโหลดไฟล์จากเครื่อง + ปุ่มขึ้น/ลงเรียงลำดับ
5. ประวัติ: แต่ละแถวมีปุ่มกลับค่า กดแล้วค่ากลับ + แถวประวัติใหม่ปรากฏ
6. ตั้งค่าทั่วไป (ธีม/สี/คอลัมน์/ตัวกรอง) — เปลี่ยน รีโหลด ต้องกลับมาเหมือนเดิม (แก้ loadPrefs แล้ว)
7. editor ปุ่มประแจบน panel รายละเอียด = แผง "แก้ไขข้อมูล (แอดมิน)" แผงเล็กข้างขวา; รูป thumbnail คลิกขยาย; ราคาพิมพ์แล้วมีคอมม่า; ปุ่ม วาง พิกัดแล้วคลิกแผนที่ — selection ต้องยังอยู่ panel ไม่ถูกปิด
8. ค้นหาออนไลน์ คลิกจุดบนแผนที่ = popup ชื่อ/แหล่งที่มา; ล้างช่องค้น = จุด + ผลการค้นหาหายทั้งคู่
