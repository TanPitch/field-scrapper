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
| ชุด test | `cd test` + `set DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap` + `bun test` | fail จากโค้ด = 0 | ✓ 169 pass / 0 fail (รันชุดเดียววนซ้ำเคย 3-9 fail = NAS DB หลุด/timeout ไม่ใช่โค้ด, รันซ้ำให้เขียวก่อน commit) || ladder เทียบ BE/FE | priceLadder.agreement | mismatch ยอมได้ = lot 9556 เท่านั้น | ✓ 117 rows เฉพาะ 9556 (daybot drift — เป็น RCA แยกต่างหาก) |
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

- **2026-11-07 batch 11 — UI fix 3 จุด: ServerPane crash, ตารางนัด 2 บรรทัด, ladder -20%**
  - **ServerPane TypeError** `Cannot read properties of undefined (reading 'used')` — API :8787 ยังเป็น process เก่า (แรน batch 7 ก่อน restart) จึงไม่มี `st.dol` แล้ว pane ชี้ผ่าน; แก้ pane ให้ robust ต่อ API เก่า: `st?.dol &&` , `st?.provinces?.length ? : null` (ทำงานได้ทั้ง API เก่า/ใหม่); API server ยังต้อง restart เพื่อเห็น DOL + ตารางจังหวัด
  - **ตารางนัด 2 บรรทัด (ผบE.91/2568 3701)**: lists page บอก `งดขายในนัดที่เหลือ` (บรรทัด 1), report page บอก `งดขายในนัดที่เหลือ เปลี่ยนวิธีขาย` (บรรทัด 2 ผลรายงาน) — ตอนนี้: ถ้า report พูดคำ verdict เดียวกัน = คุณภาพ (qualifier) รวมเข้า hover tip ของบรรทัดเดียว, หายบรรทัดที่ 2, สถานะยังยึดคำของ lists; คำคนละคำ = บรรทัดที่ 2 ยังโชว์ (เป็นข่าวจริง)
  - **-20% บาดลงถูกทบ (ผบ.754/2562, 24653 + 161371)**: RCA DB = ทั้ง 2 sibling ต่างถือ code-3 round 1/6 เองแล้ว (LED เปลี่ยนพฤติกรรมจาก "พิมพ์บนโต๊ะเดียว" → "พิมพ์ทุกโต๊ะ") — own 1 + sibling merge 1 = เหตุการณ์จริงครั้งเดียวนับ 2 ครั้ง; แก้ `siblingNoBidCount` ใน `lib/price.ts`: นับ gift จาก sibling เฉพาะ DATE ที่โต๊ะของตัวไม่มีแถว (จอง dedupe ตามวันที่, ไม่ hardcode); pin `ladderBoundary.test.js` เดิม 2 กรณี (silent sibling = -10%, ทั้งคู่มีเอง = -10% ไม่ใช่ -20%)
  - **ยืนยัน**: typecheck 0, build 0, bun test 170/0 (ขึ้นจาก 169 — เพิ่ม test pin)

- **2026-11-07 batch 10 — Phase 5 เปิด: แก้ backfill ข้ามจังหวัด (scrapeLED CONFIG freeze) + cron 20:00**
  - **ทดสอบจริง 2 จังหวัด (มุกดาหาร 49 + สิงห์บุรี 17)**: ingest เขียวทั้งคู่ แต่ข้อมูล "สิงห์บุรี" = 402 แถว เหมือน มุกดาหาร เป๊ะ (lotsNew 0, lotsUpdated 379 = เขียนซ้ำของเดิม)
  - **RCA**: `scrapeLED.js CONFIG = { province: process.env.LED_PROVINCE ... }` จับ env ตอน module load — `backfillProvinces.js` เปลี่ยน `LED_PROVINCE` รายจังหวัดใน process เดียว สายไป = ทุก pass หลังแรก scrape จังหวัดแรกซ้ำ (cron เดิม scrapeDay ไม่ได้รับเจ็บ เพราะวิ่ง process ใหม่ต่อเจอ)
  - **แก้**: `scrapeLED()` อ่าน env ใหม่ทุกครั้ง (`CONFIG.province`/`CONFIG.ampur` ตั้งต้นเองในฟังก์ชัน) — 1 จุด, คยั้งทุก caller
  - **ยืนยันหลัง fix**: สิงห์บุรีจริง = 205 แถว, parcelsNew 200, lotsNew 202, รูป 377 ไฟล์ 60 MB, รวม 543.8s ≈ 9 นาที/จังหวัด
  - **cron Phase 5**: Task **`FieldScrapper-Backfill-TH`** รันทุกวัน 20:00 → `run-backfill.cmd` (`backfillProvinces.js --all`) + `test/out/backfill.log`; `-all` เพิ่ม resume: ดู manifest ข้ามจังหวัดที่ ingested แล้ว = คืนต่อที่ค้าง (ingested ครบแล้วจะจบทันที = no-op) — id โปร่งมือ force re-scrape เสมอ
  - **งานเสริม**: ingest มี image budget cap 300 (over_budget แจ้งใน log เท่านั้น — ยัดหมดเหมือนเดิม)

- **2026-11-07 batch 9 — RCA bot2 TD stage ตายซ้ำ `parcels_td_object_id_key` ซ้ำ (2ef357f)**
  - **อาการ**: log `bot2-schedule.log` ทุกรอบ: TD ไล่ 329/90714 ใกล้แล้วถอนแถวที่ 10510 ตาย `duplicate key value violates unique constraint "parcels_td_object_id_key" / Key (td_object_id)=(5841515) already exists` ก่อน DOL แล้ว quota จบ (ลำดับ: ตายที่แถว 5841515 การรีสตาร์ทจะตายแถวแรกซ้ำถึง 5000 แถวต่อรอบ ไม่ progress)
  - **RCA**: TD's OBJECTID = id ของ map layer ต่อจังหวัด — ไม่ unique ข้ามจังหวัด! แถว: ขอนแก่น deed 25246 (parcel 12301 ถือ 5841515 แล้ว) กับ ภูเก็ต deed 10510 (parcel 23264, คิวบอต 2) ได้เลข 5841515 ชนกันข้ามจังหวัด = ที่ดินคนละแปลง เลขบังเอิญซ้ำ; migration 022 เดิมอ้าง unique ตลอด = ผิดสมมติฐานเดิมตั้งแต่ Phuket-only
  - **แก้**: `db/migrations/034_td_objectid_scope.sql` — drop unique (td_object_id) ใหม่ (td_object_id, province_code) (ยังกันห้องชุดยืม object ซ้ำในจังหวัดเดียวได้); ยิงใส่ fs-db แล้ว; ปรับหัว comment `resolveTdParcels.js` ให้ตรง
  - **ยืนยัน**: probe `bun resolveTdParcels.js --limit=3 --write` → 3 แถว 0 error 2s; กลุ่ม dup td_object_id ปัจจุบัน 0; บอท 2 รอบถัดไป (09:00) จะไล่ต่อจาก ภูเก็ตทับ 5841515 ได้แล้ว
  - **หมายเหตุ**: cmd window "ว่าง" ที่ปิดเมื่อวานยังจะเปิดซ้ำทุก 09:00 — มัน = งาน bot ที่พื้นหลัง (`run-bot2.cmd`), ปิดระหว่างรัน = งานหยุดกลางคัน (log ตรวจได้ ไม่หาย); อยากเลิกจอ understand ใช้ Task Scheduler ปิด task แทน

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

### below this line is the code that update using web chat instead of local harness

# Sprint 01 — 07:00 timestamp bug + sibling price share (ผบ.754/2562)

Remote-advisor sprint for `TanPitch/field-scrapper@dev`. Two fixes, pre-verified
in a sandbox clone of the repo (patches apply clean; RED→GREEN proven;
`bun run typecheck` = 0 errors; `bun run build` = exit 0; no new suite failures).

## Erratum (2026-11-07, after the first apply attempt)

1. **`01-server-07-00-timestamp.patch` rejects on current dev**
   (`patch failed: server/index.js:116`). dev's `server/index.js` drifted from
   the base the patch was cut against, and `git apply` matches the *context*
   lines around a hunk, not just the changed lines — `--ignore-whitespace`
   cannot fix that, and one failed hunk rejects the whole file. Use
   **`apply-patch01.mjs`** instead: same 4 edits (the `isoStamp` helper + the
   three call sites), anchored only on the lines it actually changes.
   All-or-nothing with per-anchor reporting, idempotent, CRLF-safe. From the
   repo root: `bun patches\apply-patch01.mjs`. If even an anchor misses, it
   prints exactly what to send back for an exact patch.
2. **The RED gate (15 pass / 1 fail) is the state with 03 NOT applied.** The
   test file is fully synthetic and nothing in `src/` reads `DATABASE_URL`, so
   that env var cannot change its outcome — verified both ways in the sandbox:
   pre-fix code = 15/1 with the same "Expected: 10, Received: 0" regardless of
   DATABASE_URL; fixed code = 16/0 with or without it. If you reverted 03 to
   re-run the RED gate, re-apply it before the GREEN gates.

## Files

| File | What |
|---|---|
| `apply-patch01.mjs` | **Use this instead of patch 01** (see erratum) |
| `01-server-07-00-timestamp.patch` | Fix: ประวัติงานล่าสุด shows "07:00" on every row |
| `02-sibling-price-RED-test.patch` | The failing test first (TDD RED) |
| `03-sibling-price-fix.patch` | The fix: silent sibling inherits the shared -10% |
| `_rcaSibling.js` | SELECT-only recon: prints 24653 ↔ 161371 rounds from DB |

## Root causes (short)

1. **07:00 everywhere** — `server/index.js` formats run timestamps with
   `isoDate()` (a **date-only** formatter, Bangkok). The pane feeds that
   "2026-11-07" to `new Date(...)` + hh:mm → UTC midnight → **07:00 ICT**, so
   every run of a day renders the same time. Fix: new `isoStamp()` (full ISO
   instant) for `startedAt` / `finishedAt` / `lastRun` only; day-granular
   columns keep `isoDate`.

2. **Sibling price** — `src/lib/price.ts` `siblingNoBidCount()` blocked the
   sibling gift for **any** date our own table has a row on. But 161371's own
   row for the shared นัด is the **silent placeholder** ("-", code 0), while
   24653's row carries งดขายไม่มีผู้สู้ราคา → 161371 got **0%** instead of
   the shared **-10%**. The pinned test's fixture omitted the same-date
   placeholder row, so the suite never saw it. Fix: dedup only against dates
   our own table answers with a **verdict**; silent rows accept the gift;
   gifts are keyed by date (a 3-sibling group still counts once). Plus
   `DetailView.tsx`: the silent sibling's cell now shows the inherited verdict
   inline (tip keeps provenance "ขายรวมกัน: 24653 — …"), so -10% is
   self-explanatory.

## Apply order (PowerShell, repo root)

```powershell
cd D:\Projects\field-scrapper
git checkout dev; git pull; git status        # clean tree before applying

# TDD: RED first — apply the test, watch it fail
git apply --ignore-whitespace --verbose <patch-dir>\02-sibling-price-RED-test.patch
cd test
$env:DATABASE_URL="postgres://postgres:landmap@192.168.1.137:33200/landmap"
bun test ladderBoundary.test.js              # expect: 15 pass, 1 fail (T2 = 0%, want 10)
cd ..

# GREEN: the fixes
copy <patch-dir>\apply-patch01.mjs patches\          # replaces patch 01 (see erratum)
bun patches\apply-patch01.mjs
git apply --ignore-whitespace --verbose <patch-dir>\03-sibling-price-fix.patch
copy <patch-dir>\_rcaSibling.js test\_rcaSibling.js
```

`--ignore-whitespace` tolerates CRLF checkouts. If a patch still rejects,
`git apply --reject` and paste the `.rej` files back to the advisor.

## Gates (repo convention — AGENTS.md)

```powershell
bun run typecheck                             # 0 errors
bun run build                                 # exit 0
cd test
$env:DATABASE_URL="postgres://postgres:landmap@192.168.1.137:33200/landmap"
bun test ladderBoundary.test.js               # 16 pass / 0 fail
bun test                                      # all green (NAS flake → rerun)
cmd /c "bun _rcaSibling.js > out\sibling-rca.txt 2>&1"
Get-Content -Encoding utf8 out\sibling-rca.txt
```

Browser check (run the API + Vite in your own terminals):

1. Settings › เซิร์ฟเวอร์ › ประวัติงานล่าสุด — each row now shows its own
   time (not a wall of 07:00); รอบล่าสุด shows a real time.
2. Open deed **161371** detail: headline next-round price shows **-10%**,
   and its round-1 row now prints งดขายไม่มีผู้สู้ราคา (hover: which deed it
   came from). Deed **24653**: still -10%, nothing double-counted (-20%
   would be wrong).
3. Marker popup + price chart forecast for 161371 also read -10%
   (same `nextRoundPrice` path).

## Commit (dev only — never main)

```powershell
git add server/index.js src/lib/price.ts src/components/panel/DetailView.tsx test/ladderBoundary.test.js test/_rcaSibling.js
git commit -m "fix(status): real run timestamps; fix(price): silent sibling inherits shared no-bid once"
git push origin dev
```

## PROGRESS.md batch entry (paste-ready)

```
## Batch 12 (2026-11-07)
- ประวัติงานล่าสุด เวลา 07:00 ทุกแถว: /api/status ส่ง startedAt/finishedAt/lastRun
  ผ่าน isoDate (date-only) → new Date("YYYY-MM-DD") = เที่ยงคืน UTC = 07:00 กรุงเทพ;
  เพิ่ม isoStamp (instant เต็ม) เฉพาะคอลัมน์เวลา-งาน คอลัมน์ระดับวันยังใช้ isoDate เดิม
- ผบ.754/2562 (24653↔161371): siblingNoBidCount เดิมตัดของขวัญทุกวันที่ตารางตัวเองมีแถว
  แม้แถวนั้นเป็น placeholder "-" → 161371 ได้ 0% แทน -10%; แก้เป็นตัดเฉพาะวันที่ตารางตัวเอง
  ตอบด้วยผล (verdict) จริง และนับของขวัญแบบ key ด้วยวันที่ (กลุ่ม 3 แปลงก็นับรอบร่วมครั้งเดียว)
  + DetailView: แถวเงียบของน้องแสดงคำตัดสินที่รับมาเลย (tip บอกที่มา) ไม่ใช่ "-"
  - เทสใหม่ ladderBoundary: silent SAME-DATE row (ผบ.754/2562 รูปจริง) RED→GREEN
  - ทุกแผ่นที่ใช้ nextRoundPrice (หัวราคา, popup, ป้ายแผนที่, forecast) ได้ -10% พร้อมกัน
  - หมายเหตุ: ราคา stored ต่อรอบของ 161371 ยังเป็น per-lot (0%) — จะ self-heal เมื่อ daybot
    เก็บซ้ำแล้ว LED พิมพ์คำตัดสินบนตารางของ 161371 เอง; ถ้าจะให้ DB ตรงทันที คืองาน
    ingest กลุ่ม-aware (แยก sprint)
```

## Known limitation (deliberate, YAGNI)

`test/pricing.js` (the ingest authority) stays **per-lot**. The stored
`auction_rounds.price` for 161371 keeps its per-lot values until LED re-scrapes
its table; the frontend now derives the shared view. If you want the DB itself
group-aware, that is a separate, larger change (ingest batches by
case+year+order before pricing) — say the word and it becomes its own sprint.

## Next up (Sprint B — ServerPane overhaul, design agreed pending your OK)

1. Order: oldest→newest (new at bottom) + auto-scroll once on tab open +
   stick-to-bottom while polling (chat pattern).
2. Limits: 20/50/100/250/**ทั้งหมด** (server `?limit=`, capped 5000; poll 4s
   ≤100, else 15s).
3. Fullscreen log view (expand icon on the section header): fixed overlay,
   header = server status summary (เชื่อมต่อ / บอทกำลังทำงาน / โควตา DOL /
   ค้าง-ล้มเหลว / รอบล่าสุด), body = the log. Esc / × closes.
4. Bot grouping: sticky group headers — บอท 1 LED list (`scrape`, `images`),
   บอท 2 TD/DOL (`enrich_td`, `enrich_coord`), บอท 3 ประวัติราคา LED
   (`report` — **needs migration 035** to add the stage to the CHECK and
   run-row writes in `server/ledReport.js`, otherwise bot 3 is invisible).
5. Location in rows: province as a chip + `lastStep` always visible (bot 2's
   steps already carry ตำบล names); richer `detail` rendering later.
6. งานถัดไป section: bot 1 = due provinces with `next_round_date`; bot 2 =
   `coord_queue` pending top items (deed + ตำบล/อำเภอ/จังหวัด); bot 3 = cases
   awaiting `led_report_seen` sync.
