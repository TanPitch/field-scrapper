# Security Policy

## รายงานช่องโหว่

หากพบช่องโหว่ อย่าเปิด issue สาธารณะ — ใช้ GitHub "Security advisories" (แท็บ
Security) หรือแจ้งผู้ดูแลระบบโดยตรง. จะได้รับการตอบกลับภายใน 7 วัน และแก้ใน
branch `dev` ก่อนขึ้น version.

## การจัดการ secrets

- **ทุก secret ต้องมาจาก environment**: `DATABASE_URL`, `SESSION_SECRET`,
  Google Geocoding key ผ่าน env เท่านั้น ห้าม hardcode ลง source.
- **ค่า credentials ระดับ dev ที่อยู่ใน repo**: `test/run-bot1.cmd`,
  `test/run-bot2.cmd` มี `DATABASE_URL` ฝังไว้ — เป็น **LAN-only** credential
  (`192.168.1.137` docker fs-db, owner `postgres`, เข้าถึงได้เฉพาะเครือข่ายบ้าน).
  กติกา:
  - ห้ามเผยแพร่ IP/credential ระดับ production ต่อ (ถ้าย้ายขึ้น cloud หรือเปิด
    repo public ต้อง rotate รหัส DB ก่อนและอ่านจาก env ทั้งหมด).
  - สคริปต์ใหม่อ่านค่าจาก `process.env.DATABASE_URL` เสมอ (ตาม pattern ของ
    `test/ingest.js`).
- **รหัสผู้ใช้แอป**: hash ด้วย **argon2id** (`Bun.password.hash`, memory 64 MB)
  ใน `server/users.js` — แถวล็อกอินที่หาไม่เจอก็ยังจ่ายค่า hashing เท่ากัน
  (`DUMMY_HASH`, กัน timing oracle); `test/seedUsers.js` สร้าง account ทดสอบ
  เท่านั้น ห้ามใช้ใน production (credentials ตัวอย่าง: admin / fieldscrapper).

## ระดับการเปิด API

- `server/index.js` เป็น **read-only API ตามการออกแบบ** — เขียนผ่าน endpoint
  `/api/admin/*` ต้องมี session (middleware `requireUser`/`requireAdmin`).
- Outbound เฉพาะแหล่งข้อมูล LED/TD/DOL และ Google Geocoding; ไม่มีการฟ้อง
  POST อื่น ๆ.

## การตรวจสอบใน CI

`.github/workflows/ci.yml` รัน typecheck + build ทุก push ที่ `dev` — ตรวจไม่ถึง
`bun test` แบบ integration เพราะ runner บน GitHub ต่อ NAS DB ไม่ได้ (คงไว้ที่
local). การ scan dependency: ใช้ `bun install` lockfile + การตรวจด้วยมือ
ก่อนอัปเกรด dependency ใหญ่ (Bun ยังไม่มี `bun audit` ทางการ).
