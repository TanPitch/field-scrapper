# Release Notes

All notable changes to Field Scrapper. Dates are ISO.

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