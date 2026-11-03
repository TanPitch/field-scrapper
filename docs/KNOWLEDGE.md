# LED / TD domain knowledge

Everything here was established by reading the live sites or by hand-checking
real listings. Where something is a guess it says so. Nothing here should be
trusted without a source next to it.

---

### Decision: LED is the source of truth

We buy the assets **from LED**, so LED is the primary dataset. TD is a lookup
service used only to answer "what does TD say about this parcel", and never
overrides LED. Concretely:

- The lot table, the map and all statuses come from LED.
- TD is queried with `(province, district, deed)` taken from the LED row.
- If TD and LED disagree, **LED wins** and the difference is recorded, not
  resolved.

#### พลอยแหวน — resolved, do not re-open

Checked end to end against both sites for `ผบ.229/2567 7-1 ผบ.4663`:

| source | says |
|---|---|
| LED | พลอยแหวน, ท่าใหม่, จันทบุรี |
| TD | ระวาง:5434 III 7896 00, พลอยแหวน, ท่าใหม่ |

**Both** list the district as ท่าใหม่. LED's dropdown has no พลอยแหวน either.
So พลอยแหวน is a stale row in TD that no longer resolves to a district anybody
sells from.

Resolution: **keep the TD row for history, never match it, never query it.**
Matching it would file live ท่าใหม่ parcels under a district that no longer
exists. This was the only unmatched row in the two provinces with TD ground
truth, so the rename case is handled.

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

### The discount is per-listing, not per-lot

The -10% ladder counts only rounds **inside the current listing** — rounds dated
at/after the lot's release date (`published_date` = the announce point
`p.announce` is built from). A relist re-sets the floor, it does not add to it:
ผบ.754/2562 carries four งดขายไม่มีผู้สู้ราคา rows wedged *before* its relist
announcement and they must not price the new order's round 2 at -30%.
Undated rounds count as the current listing (the boundary cannot place them).

Group sales share the event: the sibling's ไม่มีผู้สู้ราคา rounds inside the
same listing window deepen the sibling price too (ผบ.754/2562: LED printed the
verdict only on 24653's table; 161371 inherits -10%). See `lib/group.ts` +
`lib/price.ts`; pinned in `test/ladderBoundary.test.js`.

Two LED labelling behaviours the rule leans on:

- **The report sheet stamps the final outcome on every remaining นัด row.**
  Once a sale concludes, each remaining dated round of that listing reads
  ขายได้ with the same sold price (312583: six consecutive code-1 rows around
  one actual sale) — so "last code-1 round" is not the sale round; the
  lot-level `sold_price` is the report's own word, and the chart's terminal
  break (`mapHist` stops at the first ขายได้) rides the round it hits first.
- **A "no result yet" row can carry the last verdict as its label.** The lists
  pages stamp code 0/10 rows with the same งดขายไม่มีผู้สู้ราคา wording, so the
  *label*, not the code, is the deciding evidence — that is why
  `isNoBidRound` reads both.

### Sale-order cadence (used by the panel's A/B grouping)

Inside one listing LED spaces นัด ~21 days (minimum 14 by law). So: a gap
> 60 days = new sale order; a gap < 14 days (nonzero) = an *adjacent relist*
(the new order lands right behind the old order's last นัด —
ผบE.3247/2567 lot 221345 splits A|B on a 3-day gap); crossing
`p.announce` is always the current order, and inside it nothing splits even
when a งดขาย suspension exceeds 60 days. Same-day rows are duplicate rows, not
a relist.

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

**Populated** by `bun ledAreaCodes.js` (no args):

```
provinces   77      (78 list entries; LED's duplicate "53" collapses to one)
districts   1005    all with a dol_code
subdistricts 1089   zero NULL codes
```

`บึงกาฬ` stored as LED `97` → TD `38` via `PROVINCE_DOL_CODE`. Bangkok is the
largest at 64 districts.

### TD (assessprice.treasury.go.th)

The dropdowns are dojo/AMOS-driven (`widgetid="uniqName_19_3"`, hidden inputs
named `PROV_CODE`, `DOL_CODE`, `AMPH_CODE`, `TUMB_CODE`) and the option lists
arrive over XHR.

What is known so far:

- `POST /assessprice/ashx/Proxy.ashx?<service-url>` authenticates with the
  `ASP.NET_SessionId` cookie plus a `CSRF_TOKEN` taken from the page. It answers
  `{"success":true,...}`.
- `SP=GIS_Q_ADMINPOLY_LOCATION` returns **geometry only** — a province bounding
  box in EPSG:32647 — not the code/name lists.
- `SP=LUT_Q_BND` (with `LAYER=PARCEL`, `SYS_ID=GIS5`) is the parcel-bound query.
- The **dropdown lists are a separate lookup service, still unidentified.** The
  widget CSS class is `amos-filtering-select`; the handler is *not* in
  `init.js` — `_hitchArgs` there is dojo's generic argument-forwarder helper and
  is a dead end.

⚠️ The root page `/assessprice/` returns a shell with no forms and no widget
markup, so the page that actually hosts the dropdown is a different one. Guessed
widget script paths all 404.

Reference data from <https://github.com/kongvut/thai-province-data> is useful
for **name lookup and validation only**. Its codes are *not* used anywhere: LED
and TD publish their own, and those are authoritative.

### What we still need TD for

Narrower than it looks. Only one join is missing:

```
LED district name  ->  TD AMPH_CODE
```

Province codes are known (only บึงกาฬ diverges). TD has no subdistrict level.
And because the join key is the district *name** — not its number —
`areaMatch.js` already resolves it wherever TD ground truth exists.

### Where the TD dropdown data actually lives — REA findings

Driving the real page with a headless browser settled a question that had been
guessing for several rounds:

- Framework root:
  `/amos/new/framework/production/library/releases/latest/library/esrith/amos/`
- Widgets present on `/assessprice/` (`uniqName_19_*` etc.), generic: `core/
  DropDown.js` is 5 KB with **no** service URL, `form/_SelectBase.js` 8 KB,
  also none.
- **The site exposes only three service methods:**
  `DS_TRANSIT`, `DS_ENCRYPT_DATA`, `GET_IPADDRESS`.
- **Zero `LUT_*` / `GIS_Q_*` calls happen on the search form.** Those SP names
  belong to the post-search map/parcel page.

So the province and district option lists are **server-rendered inline into the
page**, exactly as in hand-captured HTML — not fetched. There is no hidden
endpoint; my earlier assumption that one existed was wrong.

`?PROV_CODE=22` is *not* the way to drive it: that URL renders a different form
(`uniqName_28_*`, no populated dropdowns at all).

Therefore getting the TD district dictionary means **driving the widget** —
open the จังหวัด dropdown, pick a province, read the อำเภอ options the page
renders — not reverse-engineering a service. That is one scripted interaction
and needs no hidden API knowledge.

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
- Coordinate resolution — TD unlimited, DOL 20/day scripted (hand reads on DOL's
  web UI are unlimited). 349 parcels still carry no coordinate; most of those are
  the hand-work queue or known agency blind spots (see §7).
- DOL bulk access needs written permission.
- CRS calibration — **superseded**: refit nationally on 2026-10-23, see §7.

---

## 7. The national datum (2026-10-23) — measured, not assumed

**How it was measured.** `test/sampleCoords.js` picked 42 lands across 14
provinces (เชียงราย → ยะลา), each with a confirmed TD→cadastre chain; the user
read every parcel's real point off กรมที่ดิน's web site and answered back
(`test/research/samples/thailand-14-dol-answers.txt`). All 42 agreed with LED on
size, อำเภอ and ตำบล, so all 42 count as measurements.

**Result: one shift per SRID, lawfully.** Per-แปลง offsets fit a single
translation each:

| SRID (EPSG) | offset (metres, applied as Δx = lon / Δy = lat after transform) | basis |
|---|---|---|
| TD EPSG:24047 (INDIAN 1975 / TM 97°E) | −50.6 m E, +180.5 m N | 29 lands, 11 จังหวัด |
| TD EPSG:24048 (INDIAN 1975 / TM 102°E) | −55.4 m E, +181.3 m N | 11 lands, 5 จังหวัด |

Per-province spread around the fitted shift is ≤ 4.2 m — within the scatter any
single agency geometry guarantees, so **there is no lawful reason for a
per-province table**. The old restriction "24048 is Khon Kaen-only, do not
reuse" is retired; `crs_calibration.scope` was set to NULL. Both rows carry the
sample size, basis and residuals as data (`010_crs_calibration.sql`).

**Precision.** After the refit, the 5,079 TD-placed markers disagree with
กรมที่ดิน's own published point at a median of **2.4 m / 1.6 m** (previously
8.8 / 6.6 m). This is the map's practical accuracy.

**Hold-outs, recorded because they are true exceptions.**

- 15188 (จันทบุรี เมืองจันทบุรี วัดใหม่) — lands 74.1 m apart, agency to agency.
- 9866 (ยะลา ยะหา ละแอ) — 58.6 m apart.

Re-read by the user twice with identical coordinates to eight decimals: these
are genuine geometry disagreements between กรมธนารักย์ and กรมที่ดิน for the
same deed, not hand errors. On 2026-10-23 the user also opened both agencies'
official map GUIs and looked at the marker directly: for both deeds TD's
marker falls in the wrong place, while กรมที่ดิน's graphic map puts the land
exactly where its coordinate reads — the map views side with DOL. They are
excluded from the datum fit, and if either parcel is ever ingested,
**กรมที่ดิน's point wins** (the project's truth source
for "where is this land" — the record of that rule is in the answers file).

### น.ส.3ก. is a blind spot for both agencies

Deeds 4265, 4266, 1758 and 1565 (ผบ. / ผบE., ขอนแก่น) were re-checked by hand
more than once: น.ส.3ก. parcels are **not findable on either TD's โฉนด layer or
กรมที่ดิน's web** (a same-number hit on DOL came back with a wrong size and
wrong อำเภอ — a different land). The only path that resolves them is TD's NS3K
MapServer layer (`test/resolveNs3k.js`). Of the four, 1758 and 1565 later got
NS3K rows and are placed; 4265 and 4266 have no NS3K row either — their
`geo_note` on the parcel row says so.

### กรมที่ดิน cadastre layers 0 and 1 — know before you query

The TD_Former_View MapServer that `tdCadastre.js` reads has **disjoint province
coverage between layer 0 and layer 1**: อุดรธานี / มุกดาหาร / อุบลราชธานี /
บึงกาฬ appear only in layer 1, while เชียงใหม่ / เชียงราย / ปราจีนบุรี /
ภูเก็ต appear only in layer 0. `officialArea` already queries both layers, so
no fix is needed — this is here so nobody "discovers" it again.

### Hand-reading procedure (the path that replaced automated DOL for small batches)

`test/recordDolPoint.js <parcelId> <lat> <lon> [rai ngan wa] [note]`:

- sizes live in `auction_lots` (`size_rai/size_ngan/size_wa`), **not** on the
  parcel row — check the lot row before recording;
- the script refuses to store when the hand size disagrees with LED (wrong-land
  read protection: deed 88022's first read came back 0-0-9 against LED's
  0-0-0.90 — a 10× flag; the second read put it at 0-0-0.9, exactly LED's row —
  LED was right and the decimal point was the first read's mistake);
- when a re-check ever shows LED's own row is the wrong one, record with
  **no size args** — the check is skipped and the note carries the DOL size and
  the reason (that path exists for the rare case; 88022 did not turn out to be
  one — the sizes agree);
- a size that is left out is not checked — nothing downstream can tell hand
  reads from automated ones either way;
- only `match` verdicts are user-facing; mismatches and no_result stay in the
  admin error group.

---

## 8. Round provenance: lists rows vs report rows (2026-11-02)

`auction_rounds` rows are born in two places, and the difference is data an
algorithm should read rather than reconstruct from dates:

- **lists rows** — the schedules LED prints per case. The ingest stamps them
  with their own slot number `idx` (1..8) and source `lists`. Rounds that have
  not happened yet carry the placeholder phrase (รอประกาศ /
  ยังไม่มีการเปิดประมูล) with code 0.
- **report rows** — the ผลการขาย rows `ledReport.js` inserts for history the
  lists schedule no longer shows. `idx` is null, source `report`, and the
  label is the report's own outcome word.

Rules that hang off this split:

- **The current-listing boundary is `idx IS NOT NULL`, not the publish
  date.** A publish point can sit months before the first นัด
  (ผบE.3247/2567 lot 221345: published 19/06/2569, first live นัด 19/08),
  which is exactly why matching rows to the announce date planted the
  previous order's 01/07/2569 tail inside the live order.
- **The report's verdict lives in `led_label` only — by design.** Rewriting
  `status_label` from the report is how ผบ.2255/2562's labels got crossed
  between two orders. The client (`liveData.mapRounds`) promotes `led_label`
  onto a round whose lists label is still the placeholder; that is where the
  งดขายไม่มีผู้สู้ราคา/−10% behaviour comes from on rows the lists page has
  not re-scraped yet. ledReport only ever stamps rows it can date-match, so
  the promotion is conservatively guarded: placeholder lists label, real
  report word.
- **Elevation is a column, not a layer.** `parcels.elevation_m` is filled by
  `test/elevation.js` (AWS Terrarium z14, ±9.2 m/px). Gate on
  `geom IS NOT NULL` — not on `geo_precision = 'parcel'`, a label only 231
  rows carry while 5,164 real TD-resolved points hold NULL there. The run is
  idempotent and disk-caches its tiles under `test/data/elevation-tiles`.

## 9. The error-review verdict on gap parcels (2026-11-03)

`parcels.reviewed_error` (migration 030) is what a human's judgement looks
like in the schema — coordination gaps that a coordinate can never fix (the
deed points at the wrong tile, wrong land, agency blind spot) are *decided*,
not retried:

- **One column writes the verdict; every consumer reads it its own way.**
  The features payload (map + bottom table) excludes it server-side — never
  serve a parcel the reviewer said is wrong. The coord-gaps endpoint still
  lists it, because the admin needs to see what the verdicts were; the pane's
  `[error]` chip is the only way in. Do NOT fold this into `geo_status` —
  that column means *resolver progress* (unresolved/verified/mismatch), a
  different axis from *the data itself is wrong*.
- **Booleans need their own PATCH shape.** `COALESCE($x, col)` collapses
  false into "no change" — exactly wrong for a toggle. The endpoint uses
  `CASE WHEN $x::bool IS NULL THEN col ELSE $x::bool END` so an absent body
  field keeps the value and an explicit false un-marks it.
- **Clearing search must reset the store, not just the input state.** The
  empty-text branch of SearchBox used to leave `online` (the store's
  internet-result list) as it was, so the render rebuilt its rows and
  re-plotted the marker dots (the 2026-11-02 batch's stale-fetch abort kept
  the *response* fresh but the *cleared* surface stale). Every cleared
  search surface is enumerated now — dropdown, panel rows, online store,
  nationwide scope flag, panel selection, plotted markers — because they all
  commit.

## 10. Groups known wrong before the fix: read the stamping, not the intent (2026-11-03)

- **"Lists rows = the listing" is an invariant of the ingest, not the page.**
  The 2026 LED full sweep stamped `idx` 1..N over everything a case's printed
  schedule showed — 54 นัด across 2020-2027 on lot 10626 — so the provenance
  rule alone made those lots one flat order. The recovered hybrid: provenance
  still decides the boundary class, but a lists row dated before the listing's
  own publish point joins the report rows' history partition (same 60-day /
  <14-day gap splits). When the daybot eventually re-keys those lots, its rows
  already satisfy the invariant, so the hybrid degrades to the exact rule —
  no data migration required.
- **A percent-free rule for phrases**: when LED's report vocabulary has a
  CODE, promote to that code, never invent a colour of status. งดขายในนัดที่เหลือ
  is code 26 in the ingest's own labelling (test/pricing.js), so the client
  promotion maps the phrase to 26 rather than to a special-cased string; the
  lot-level ยกเลิกการขาย then follows from "every dated round tokenises the
  ingest's own close code" — data-driven, no phrase list in the status logic.
- **A hand coordinate needs three writes, not one.** The map dataset is keyed
  on `p.geom` and gated on `td_verdict = 'match'`; the parcel must carry
  `geo_precision='parcel'` for consumers that promise a real point. An admin
  PATCH writing only lat/lon silently satisfied only its own pane.
- **Coordinate text arrives human-shaped.** One field, two fields, any run of
  comma/space/;/| between the decimals — all parse; range-guarded (|lat|<=90,
  |lon|<=180) so a pasted paragraph cannot place land in the Gulf.
- **Drops must close both doors.** น.ส.3ก. went out via migration 031 AND the
  ingest skips the class (`skippedNs3k` stat) — deleting rows alone while the
  nightly sweep keeps inserting leaves the class back overnight.
