# Release Notes

All notable changes to Field Scrapper. Dates are ISO.

## Unreleased

## 2.2.0 - 2026-10-10

Splash/login, a real Google search backend, the search-result panel, and a
settings overhaul (themes, mockup account & server pages).

### Search
- **Google online search is real.** The mocked `POIS` stage is gone, replaced by
  two live stages in `src/lib/onlineSearch.ts`: **Geocoding API** (`bounds` = the
  current map bbox, `region=th`) for addresses, then **Places Text Search (New)**
  (`locationBias.circle` around the view centre) for businesses. Nominatim stays
  the final fallback when both throw or find nothing in the bbox;
  `ZERO_RESULTS` counts as "try the next stage", not an error. Needs a key with
  both APIs enabled in the Cloud Console.
- New **ผลการค้นหา** in the right panel, grouped into sticky sections — ที่ดิน /
  รถประจำทาง / กล้อง CCTV / เซ็นเซอร์น้ำ-เขื่อน / ออนไลน์ — each with a count.
  The title-bar dropdown is kept, so both surfaces show the same ranked hits.
- Search markers are drawn for **internet results only**, at the bottom of the
  render stack. Land parcels, cctv, water and bus keep their own markers — they
  were previously being duplicated underneath a second one.
- Internet markers take a glyph from their **place type** (`poiIcon` →
  rasterised onto a black disc as `fs-poi-<iconName>`), and the panel rows show
  the same small icon.
- Selecting a result branches by kind: an **internet** hit gets a persistent green
  ring and a pan/zoom; a **local** hit rings its own marker and replaces the
  results list with that marker's panel. Selecting no longer wipes the other
  markers — the ✕ clear button does.
- Results are a **snapshot of the bbox at search time**; panning no longer
  re-filters them. Flying to a hit only zooms when below zoom 12 (`flyToResult`).
- **จำนวนผลลัพธ์การค้นหา** is configurable (1–50) in แผนที่ → การค้นหา, replacing a
  hard-coded 8.
- Two separate search buttons, deliberately: **ค้นหาพื้นที่** on the bottom-table
  toolbar opens the right-panel search form; the floating **ค้นหาในพื้นที่นี้**
  appears over the map only after you search and then pan away, and re-runs the
  title-bar text against the new bbox without reopening the dropdown.
- Title-bar search box: vertically centred, clear (✕) button while it has text,
  and left-rail tooltips open to the right via `useSideTip()`.

### Account
- **Splash / sign-in screen** with two panels — a left brand panel (hidden below
  `lg`, where the form takes the full width) and a login form supporting
  remember-me, a show/hide password toggle, 2FA and a register flow that
  explicitly cannot create an account. Test accounts: `admin / admin1234`
  (2FA required), `fieldscrapper / user1234`. Logging out returns here.
- 2FA uses **six separate one-digit inputs**: typing advances, Backspace clears or
  steps back, arrows navigate, paste fills all six.
- New **ลืมรหัสผ่าน** page — no self-service recovery; it explains that only an
  admin can reset a password and walks through จัดการผู้ใช้.
- New **ผู้ใช้** tab (mockup): profile picture, read-only username, editable
  display name, change-password form, 2FA toggle and a danger zone.
- New **จัดการผู้ใช้** tab: add / remove users, per-user password reset, active
  and 2FA toggles, restore-defaults. You cannot delete your own account, and the
  list can never drop below one user — both rules re-checked in `remove()`.
- New **เซิร์ฟเวอร์** tab (mockup): connection status, queue depth and a task list
  with state, progress bar and start time. Sample data only.
- Profile picture is an icon + colour picker: nine lucide icons, two colour
  inputs (one = solid, two = gradient) using the app's own `ColorButton`, plus an
  image upload. The panel is anchored under the **เปลี่ยนรูป** button; the round
  preview is not clickable.
- New `Confirm` dialog + `useConfirm()` for destructive actions — deleting your
  own account (requires typing the username) and deleting another user.
- `role` is part of app state: **admins bypass the hidden-menu gate** for
  ค้นหา & API.

### Settings
- Parcel markers reduced to exactly three kinds: **กำลังขาย**, **ขายแล้ว**,
  **นำกลับมาขายใหม่** (`re`). `Status` is now `'sale' | 'sold'` — the `normal`
  (ทั่วไป) state was removed from the type, colour maps, mock generation, filters
  and every status expression.
- Five new themes (**สเลต / ทราย / ป่า / กุหลาบ / ขาวดำ**) plus a customisable
  **สีหลัก (Primary)** via `body[data-accent]`.
- Marker size gains **เล็ก** (0.72×) alongside ปกติ and ใหญ่; `markerScale()` is a
  single lookup table shared by every marker and selection ring.
- New table column **ผู้ขาย** (`seller`, from `Parcel.dataSource`); **ขายโดย**
  renamed to **จำนอง**.
- **ค้นหา & API** is hidden behind an unlock code in แผนที่ → ปลดล็อกเมนูขั้นสูง
  (`SETTINGS_SECRET` in `src/data/constants.ts`). It is a local convenience gate,
  **not** the Google API key.
- **ซ้อนกันได้** and **วันที่ขาย** only apply while ป็อปอัพหมุดที่ดิน is
  **แสดงทุกจุด**; otherwise they dim out. Stored values are preserved.
- ตัวกรอง / คอลัมน์ popovers open above their button and only drop below when they
  would not fit above the top of the screen (`useAboveBelow`).
- API key row is a single masked line (`sk-d•••8a36`) with an eye toggle; the
  test result is thin text inside the button, colour-coded by state. Google road
  and satellite tile checks are merged into one row.
- Bottom table minimum height lowered to 170px.
- The changelog in เกี่ยวกับ renders `RELEASE_NOTES.md` itself (Vite `?raw`),
  parsed by `src/lib/changelog.ts` into sticky version headers, real bullets and
  inline `**bold**` / `code`.

### Map
- Depth probe read-out follows the probed area: dry keeps a dark panel, submerged
  switches to deep blue.
- Filter areas renumber 1..n on every create and delete, like shapes already did.

### Fixes
- **Infinite render loop on the 2FA step** (`Maximum update depth exceeded`). The
  OTP boxes registered via `ref={el => setOtpRefs(…)}`; under React 19 a ref
  callback's return value is a *cleanup function*, and the inline callback was a
  new identity each render, so refs detached and re-attached forever, each
  re-attach calling `setState`. They are now a plain `useRef` array.
- **Avatar picker crash** (`Cannot read properties of undefined`). The icon list
  was keyed off `Icon.name`, but lucide icons expose `displayName`, not `name`.
  `ICONS` is now an explicit `{ key, th, Icon }` table.
- **Right panel crash** (`Can only set one of 'children' or
  'props.dangerouslySetInnerHTML'`): the internet-result marker was one `<span>`
  carrying both, which React rejects even when the child is `false`.
- **Logout button drifted down** on tall settings tabs. RCA: the tab row is a flex
  item and defaults to `min-height: auto`, so a tall pane grew the row past its
  `height`; the sidebar is `h-full`, so the footer rode along. Fixed with
  `min-h-0 overflow-hidden` on the row and `min-h-0` on the body column.
- **Double selection ring** on search markers: `gotoItem()` and
  `setSearchSelection()` both ringed the same point. `gotoItem()` now takes a
  `ring` flag.
- `ringAt()` left `fs-sel-ring` at its last animated radius, silently overriding
  the marker-size setting; it now settles back to `markerScale()`.
- Compact land popups omit the delta strip when the change rounds to zero
  (`-0.4%` used to render as `-0%`).
- ตัวกรอง / คอลัมน์ popovers, group headers in ผลการค้นหา (`top-0` parked them
  behind the sticky `VStats`), the changelog scrollbar (`scrollbar-width: thin`
  bypassed the custom webkit scrollbar in Firefox), and oversized result icons.
- `Handbag` is not exported by the installed lucide-react; the avatar list uses
  `ShoppingBag`.

### Toolchain
- Switched the package manager and script runner from npm to
  [Bun](https://bun.sh). `bun.lock` replaces `package-lock.json`; run
  `bun install`, then `bun run dev | typecheck | build | preview`.
- Restored the `.pop-box` / `.pop-box--compact` styles in `src/index.css`; both
  layouts were being emitted but rendered identically without them.

## 2.1.0 — 2026-10-08

### Auction data model
- `Parcel` now carries the full auction/legal record: `saleByText`, `ownerFile`,
  `propertyType`, `deedNo`, `court`, `caseNo`, `plaintiff`, `defendant`,
  `possessor`, `enforcementOffice`, `collateral`, `spouseCollateral`,
  `expertPrice`, `enforcementOfficerPrice`, `assessorPrice`, `committeePrice`,
  plus `rounds: SellRound[]` and `mortgage`.
- `SellRound` and `Mortgage` types added.
- Mock generation produces plausible Thai party names, a shared deed number per
  parcel, mortgage data, and 8 sale rounds anchored around today so upcoming
  rounds actually exist.

### Land detail panel
- Coordinates row replaced by a plain ตำบล / อำเภอ / จังหวัด line (no more ต. อ. จ. prefixes).
- Collateral and mortgage rows shown when present.
- "การขายรอบถัดไป" shows the next dated round; a banner with a live countdown
  appears when the next round is within 10 days.
- New 3-column round table (นัดที่ / วันที่ / สถานะ) for rounds 1–8, where a past
  or skipped round can read `ไม่มีผู้ซื้อ`.
- Price chart gained a draggable range slider under the graph, sharing
  `chartRange` with the date pickers.

### Table
- นัดที่ 1–8 collapsed into a single **นัดล่าสุด** column (subs: นัดที่ / วันที่ /
  สถานะ) showing the round that is currently selling, else the nearest future
  round, else the last dated one.
- ลำดับที่ renders an auction-style `12-716` reference derived from the row number.
- Duplicate เลขโฉนด column removed; เลขที่โฉนด kept.
- ขายโดย shows only the mortgage amount, with the bank in the hover hint.
- Column drag now renders a ghost column, a full-height opaque drop slot marked
  วางที่นี่, neighbour cells that slide aside to preview the result, and
  continuous autoscroll near the viewport edges. The source column (including its
  header text) is masked while dragging, and the table snaps into place on release
  with no animation.

### Filters
- Size filters support ขนาด ≥ and ขนาด ≤, each in either single ตร.วา/ตร.ม. or the
  3-box ไร่/งาน/ตร.วา form, with a toggle that converts the value across.
- Multi-select chip filters for จังหวัด, ตำบล, อำเภอ and ประเภททรัพย์: a
  click-to-open long input with a search box, removable chips, and a custom
  checkbox. ตำบล/อำเภอ options narrow to the selected provinces.

### Settings
- Resale parcels (นำกลับมาขายใหม่) get their own colour plus a popup-visibility
  toggle under สถานะและสี. The colour now applies live to the map dot and open
  popups.
- Time-axis marker interval for the price-chart range slider: ไม่แสดง / ทุกปี /
  6 เดือน / 4 เดือน / 3 เดือน.
- A1/A2 area tags can be hidden from the filter area panel.
- Settings tab รูปวาด added; the land tab is labelled ที่ดิน.

### Tooltips
- All native `title` attributes replaced with [tippy.js](https://atomiks.github.io/tippyjs/):
  a single delegated instance bound to `document.body` handles every trigger.
  Rounded SVG arrow via tippy's `roundArrow` plugin, and a `shift-away` animation
  so the bubble slides out of the trigger rather than fading.
- Table cells reveal their full text on hover, but only when the text is clipped.
  The ขายโดย column always shows the mortgage bank on hover.

### Thai geographic data
- `src/data/thaiGeo.ts` normalises `provinces.json`, `districts.json` and
  `subDistricts.json` into name-keyed lookups.
- The จังหวัด → เขต/อำเภอ → แขวง/ตำบล dropdowns in ค้นหาที่ดิน now cascade from that
  data, auto-fill a parent when a child identifies it unambiguously, and expose a
  clear (×) button. Mock parcels are generated as real, consistent triples.

### Map popups
- Parcel popups have two layouts: compact (≤2 rows, tighter padding, heavier
  price) and full, applied automatically based on how many fields are enabled.

### Typography
- All UI text renders in Noto Sans Thai.

## 2.0.1

- Migrated from the single-file `field scraper 2.0.1.html` to Vite + React +
  TypeScript + Tailwind, with UI state centralised in a zustand store.
