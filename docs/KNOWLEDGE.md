# LED / TD domain knowledge

Everything here was established by reading the live sites or by hand-checking
real listings. Where something is a guess it says so. Nothing here should be
trusted without a source next to it.

---

## 1. Round status codes

`status_code` is LED's per-round outcome. Every code below was confirmed against
a real listing; the four marked ✋ were originally printed by LED as
`ไม่รู้จัก(รหัส N)` and were labelled by hand afterwards.

| code | label | discount | terminal | notes |
|---|---|---|---|---|
| 0 | ยังไม่มีการเปิดประมูล | — | no | no auction held at this slot |
| 1 | ขายได้ | — | **yes** | sold |
| 3 | งดขายไม่มีผู้สู้ราคา | **-10%** | no | **the only discount driver** |
| 4 | งดขายส่งประกาศมิชอบ | — | no | ✋ |
| 6 | ถอนการยึด | — | **yes** | listing is **withdrawn from LED** |
| 7 | โจทก์แถลงงดขาย | — | no | |
| 10 | งดขาย | — | no | |
| 12 | งดขาย (ป.วิ.แพ่ง มาตรา 309) | — | no | ✋ court order |
| 13 | งดขาย | — | no | |
| 14 | งดขาย | — | no | ✋ |
| 15 | งดขาย | — | no | ✋ |
| 16 | งดขาย | — | no | ✋ |
| 23 | งดขาย | — | no | |
| 26 | งดขายในนัดที่เหลือ | — | **yes** | cancelled for remaining rounds |

### The one rule that matters most

**Only code 3 produces a discount.** -10% per consecutive no-bid round, capped at
30%. Codes 14/15/16 are plain งดขาย and must never be folded into that count —
treating them as no-bid rounds invents a price drop that LED never applied.

A round's price reflects the no-bid count from rounds *before* it, because a
no-bid round is itself held at the undiscounted price.

Worked example:

```
งดขาย, งดขาย, งดขายไม่มีผู้สู้ราคา, งดขาย   ->  round 4 is -10%
```

### Code 6 is not a failed sale

ถอนการยึด means the seizure was lifted. **LED removes the listing.** The land
went back to its owner; it did not fail to sell. So code 6 is terminal (stop
scheduling, never predict a next round) but its stored `close_reason` is
`withdrawn`, never `sold`. The API maps both `withdrawn` and
`cancelled_remaining_rounds` to status `inactive`.

### Codes still unlabelled

Everything LED currently emits is in the table. `rounds_status` in the DB is a
closed CHECK constraint — a genuinely new code **kills the whole province
ingest**, so widen the constraint and add the label in the same change.

---

## 2. LED ↔ TD codes

LED is the auction site (`asset.led.go.th`). TD is the Treasury assessment site.
**They do not use the same codes, and neither does one subsume the other.**

### Province level

Identical for 76 of 77 provinces. One divergence:

| province | LED | TD |
|---|---|---|
| บึงกาฬ | **97** | **38** |

Stated as an explicit override (`PROVINCE_DOL_CODE`) rather than inherited by
copying `code` into `dol_code`, which silently mislabels it.

Also note LED's own province list contains a **duplicate `53`** (`อุตรดิต` and
`อุตรดิตถ์`). That is LED's typo, not a second province.

### District level — verified NOT shared

Checked by diffing LED's `get_amphur.asp` against the `AMPH_CODE` list scraped
from the TD page:

**จันทบุรี (22)** — TD has 11 districts, LED lists only 10.

| district | TD | LED |
|---|---|---|
| ท่าใหม่ | `ท1` | `03` |
| พลอยแหวน | `พ1` | *absent* |

**ตราด (23)** — same 7 districts with the same `01`–`07` codes, but LED prefixes
island districts:

| district | TD | LED |
|---|---|---|
| เกาะกูด | `เกาะกูด` | `อำเภอเกาะกูด` |

Three consequences:

1. **TD district codes are not always numeric.** `ท1` and `พ1` mean a district key
   cannot be assumed to be 2 digits, and `provinceCode + districtCode` is not a
   safe way to rebuild one.
2. **LED's district list can be incomplete.** พลอยแหวน is absent, so LED is not
   an authority on the district level either.
3. **Names are not byte-identical**, so a name join across the two systems needs
   normalisation, not equality. `อำเภอ` is the observed prefix.

### Subdistrict level

**TD has no subdistrict level at all.** That is why `districts` carries both a
LED `code` and a `dol_code`, while `subdistricts` carries only `code`.

Subdistrict codes are unique **within a district** and repeat freely across
districts:

```
หนองไผ่ = 93  in ชุมแพ          (4005)
บ้านค้อ  = 93  in เมืองขอนแก่น     (4001)
ราไวย์  = 96  in เมืองภูเก็ต      (8301)
```

So `UNIQUE (district_id, code)` is correct and must stay.

⚠️ **Two numbering schemes currently share one column.** LED's tambon codes are
5-digit and district-scoped (`เกาะแก้ว=83000`, `กมลา=83150`, `สาคู=83110`) while
the `eva_area_grade` codes written by ingest are 2-digit (`วิชิต=95`,
`ราไวย์=96`). Harmless today because nothing joins on the value — split into
`tambon_code` and `tambon_ref_code` before anything starts depending on it.

### LED's amphurId

```
amphurId = provinceCode + districtCode     83 + 01 -> 8301
```

Not an autoincrement — a concatenation, which is why `ท1`-style codes break naive
reconstruction. Use the option value verbatim.

The district dropdowns also carry a province-wide aggregate row, `<province>00`,
with an empty label. **It is not a district** and must be skipped.

---

## 3. Reading the sites

### LED admin hierarchy

```
GET https://asset.led.go.th/newbidreg/get_amphur.asp?provinceId=<2-digit province>
GET https://asset.led.go.th/newbidreg/get_tambon.asp?amphurId=<provinceCode><districtCode>
```

Returns `<option value='8302'>กะทู้</option>` — **single-quoted**, with a BOM
before the label. A double-quote-only parser silently returns zero options and
makes a working endpoint look dead. That bug cost real time here.

No daily limit on LED.

### TD (assessprice.treasury.go.th)

The dropdowns are dojo/AMOS-driven (`widgetid="uniqName_19_3"`, hidden inputs
named `PROV_CODE`, `DOL_CODE`, `AMPH_CODE`, `TUMB_CODE`) and the option lists
arrive over XHR. **The endpoint is not yet identified** — `ledAreaCodes.js`
covers LED only, and TD district codes still need a source.

Reference data from <https://github.com/kongvut/thai-province-data> is useful
for **name lookup and validation only**. Its codes are *not* used anywhere: LED
and TD publish their own, and those are authoritative.

### Quotas

| source | limit |
|---|---|
| LED | none |
| **TD** | **none** |
| **DOL** | **20/day** |

TD being unlimited is what unblocks map markers — the earlier claim that lookups
were capped at 20/day was wrong; the cap is DOL's alone.

---

## 4. Land identity and condos

**One auction row can list several deeds; each deed is its own parcel.** A condo
building is typically one parcel with many lots/units that share coordinates.

Consequences, all deliberate:

- **Table: one row per lot.** A condo shows 17 rows for 17 units.
- **Map: one dot per parcel.** A condo building is one marker labelled `×17`,
  never 17 stacked dots.
- Representative unit is configurable (`orderLabel`, `priceAsc`, `priceDesc`,
  `sizeAsc`, `sizeDesc`); ties always fall back to `order_label`, and unpriced
  units sort last.

Condo data confirmed against the real listing:

```
ราไวย์ เมืองภูเก็ต ภูเก็ต ห้องชุด โฉนด 114461  พ.376/2568
owner บริษัท ซิซซา กรุ๊ป จำกัด
sizes differ per unit
```

Sizes differ between units, which is why the `sizeAsc`/`sizeDesc` ordering
options exist — a representative unit is a UI choice, not a data assumption.

`พ.376/2568` also demonstrates that **a province has more pages than anyone
assumed**: a 3-page cap captured 5 of its 17 units and looked like a complete
list. Scraper page caps are now off by default and the site-reported
`totalpage` governs.

### Prices on condos

TD price-per-wah on a condo is **building-level**, not per unit. It stays
visible and unlabelled rather than being hidden — it is the only valuation TD
publishes for that deed.

---

## 5. Schema traps

**`districts.province_id` is an FK to `provinces.code`, not `provinces.id`.**
This is declared that way in `001_core.sql` and is correct. Joining it to
`provinces.id` reports every district as orphaned. The name is misleading and
has already cost one wrong diagnosis; the column is documented at each use.

Related: `districts.code` is the 4-digit LED amphurId, also not the internal id.

**Subdistrict names arrive with trailing whitespace.** LED's tambon name and the
reference table's name for the same tambon are not byte-identical, so an upsert
on `(district_id, name)` misses, inserts a new row, and then dies on
`subdistricts_code_idx` because a sibling already holds that code. That killed
an entire Phuket ingest. Resolution order is now: known name → known code →
insert. A name/code disagreement logs a warning instead of taking the run down.

---

## 6. Still open

- **TD district codes** — no endpoint identified; need one for the LED↔TD
  conversion pipeline and the frontend's search/filter.
- `tambon_code` vs `tambon_ref_code` split (see §2).
- Coordinate resolution — TD unlimited, DOL 20/day. 179 parcels still have no
  geometry, so the map draws no markers at all until this runs.
- DOL bulk access needs written permission.
- CRS calibration proven for Khon Kaen only.