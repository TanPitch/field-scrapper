# Scraper findings

Hard-won facts about the Thai government sources, and why the pipeline is built
the way it is. Everything here was verified against the live sites or the loaded
data, not assumed.

**Current state:** Khon Kaen, 30 lots, 24 with an exact กรมธนารักย์ assessment.

---

## 1. LED — กรมบังคับคดี

`https://asset.led.go.th/newbidreg/default.asp`

### Protocol

- POST only. GET returns the shell.
- **UTF-8, percent-encoded** — Thai district names arrive as mojibake otherwise.
- Send every `<input>` and `<select>`, plus `search=ok`. Sending a subset returns
  zero rows rather than an error.
- One session per crawl: capture and replay the cookie, and resend
  `oseckey` / `seckey` on every page request. Dropping them mid-crawl silently
  truncates the listing.
- Detail pages POST to `asset_open.asp` with the same session. Without the cookie
  they return a login redirect.

### Three bugs that each produced zero rows

1. Not URL-encoding the Thai text.
2. Not replaying `oseckey`/`seckey`.
3. Not POSTing `search=ok`.

All three look identical from the outside: an empty result set.

### Forms are hoisted out of the detail rows

The page contains exactly one `<form>` per *field kind*, repeated at the top, and
the row markup references them by index (`web1`, `web2`, …). Reading a form from
inside its row gives you the wrong field. Parse from the hoisted set by index.

### Images

```
Z:\งานล้ม\2569\ล้ม 1\37191p.jpg
→ https://asset.led.go.th/PPKPicture/งานล้ม/2569/ล้ม 1/37191p.jpg
```

Path preserved, drive letter replaced. Kinds: `p` photo, `j` survey drawing,
`m` map. **Not every lot has a map image** — 19 of our 30 do not. That is normal,
not a failure, and the UI needs an empty state for it.

### issale codes are not round labels

The field is a status code, not the text shown to a user. Confirmed mapping
against the site:

| code | meaning |
|---|---|
| 0 | scheduled, not held yet |
| 1 | sold |
| 3 | งดขายไม่มีผู้สู้ราคา — held, nobody bid |
| 6 | seizure revoked |
| 26 | cancelled for remaining rounds |

**Only code 3 deepens the discount.** The other งดขาย-family codes neither deepen
nor reset it. Confirmed example: `งดขาย, งดขาย, งดขายไม่มีผู้สู้ราคา, งดขาย` →
round 5 is −10%, not −30%.

### Province vs court — do not conflate

`address.province_id` on a row is a per-row value that is empty on most lots.
Trusting it produced six different bogus provinces all named ขอนแก่น with codes
20/21/22/23/24/401. Resolve the province **from the name** via the district
dictionary.

### Rate limiting

There is no server-side throttle — verified. The limits here are politeness, not
enforcement: one session per host, paced requests, 1200 ms between image
downloads. These sites are small and public; keep it slow.

---

## 2. The price ladder

```
discount = min(noBidRoundsBefore × 10%, 30%)
price    = startPrice × (1 − discount/100)
```

A round's price reflects the no-bid count from rounds **before** it, because a
no-bid round is itself held at the undiscounted price. Increment the count after
computing that round's price, never before.

`test/pricing.js` is the authority — it wrote the numbers in the database.
`src/lib/price.ts` mirrors it for the UI, and
`test/priceLadder.agreement.test.js` runs both over all 240 real rounds and fails
on the first disagreement.

The starting price is the first non-zero value in LED's cascade order.
`assetprice1` is **not** part of it (zero on every row sampled).

---

## 3. กรมธนารักย์ — assessprice (TD)

### Transport

```
POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx
      ?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT
```

JSON body sent as `application/x-www-form-urlencoded`. Key parameters:

| param | value |
|---|---|
| `PROV_CODE` | province code |
| `CHANOD_NO` | the เลขที่โฉนด, from LED |
| `PERIODS` | `7` |
| `FN_ID` | `GIS5-WF01` |
| `PARCEL_LAYER` | `PARCEL` |
| `BEGIN` / `END` | `1` / `200` |

Requires an ASP.NET session id plus the ASP.NET_SessionId cookie; the token is
fetched first and both are resent. **The service is undocumented** — the client is
sequential, paced and session-reusing, and expects to break.

Prices arrive as comma-formatted strings (`"85,500"`), not numbers. Parse them.

### The trap: one deed number, many parcels

TD returns **every parcel sharing that deed number** — 21–23 unrelated parcels for
a single query is normal. Selecting by area alone would have matched the wrong
parcel. Selection is by LED's ตำบล/อำเภอ; ambiguity is never guessed.

### Coordinates: a 183 m datum error, then fixed

TD serves `SHAPE` WKT in **EPSG:24048**. PostGIS's transform placed it ~183 m
away. An empirical median correction of **−53.5 m latitude, +175.1 m longitude**
brings it into agreement.

- 13 of 14 hand-verified points now agree with กรมที่ดิน within 0.0–0.4 m.
- One point (35089) remains 12.4 m out.
- Derived from 14 Khon Kaen points, so **national validity is unproven**.

Source UTM is kept in `td_utm_e` / `td_utm_n` / `td_utm_srid` so the correction
stays auditable and reversible rather than baked invisibly into the geometry.

### น.ส.3ก.

Supported by TD only — กรมที่ดิน does not carry it. But the LED listing search
requires a **ระวาง**, which LED does not publish, so the normal โฉนด query returns
only unrelated parcels.

Of the five น.ส.3ก. lots in the sample, one has an obvious location match that is
**not a match**: LED says นางิ้ว 0-1-0, TD returns เขาสวนกวาง 0-0-96.5. The area
is within 5% and a naive tolerance would accept it — but the ตำบล differs, and a
different ตำบล is a different parcel. **Area similarity never substitutes for
location agreement.**

By decision these are skipped: the LED record is kept in full, without parcel
coordinates, and the reason is recorded.

### Coverage

24 of 30 lots enriched. Of the 6 without: five น.ส.3ก. (skipped) and one genuine
`no_location_match`.

---

## 4. กรมที่ดิน (DOL) — verification only

Removed from the active enrichment pipeline by request. Retained for manual
verification.

- Anonymous quota is **20 requests/day**, tracked in `dol_quota_ledger`.
- The official bulk source is advertised at **100,000 requests/day/organization**
  but requires written permission and issued credentials. Not a path we can just
  take.
- Does not cover น.ส.3ก.

`coordQueue.js` spends the daily quota in priority order (nearest round first),
and verification is deliberately conservative.

---

## 5. Treasury open data

### There is no bulk national parcel file

Confirmed, not assumed. What exists is the **source table that LandsMaps itself
reads**: `eva_area_grade`, ตำบล-level assessment grades. Loading it requires a
provincial tanban code, and it is slow — roughly a week of runtime at any
respectable rate. **Not viable.**

### What is loaded

| table | rows | note |
|---|---|---|
| `eva_land_sheet` | 4,858,811 | 2,074,090 distinct parcel/sheet keys |
| `eva_area_grade` | 31,990 | from 31,999 raw — 9 exact duplicates dropped |

Two traps in the source CSVs, both found by the loader:

- **16 rows contain the literal string `"NULL"`** in the price column, not a real
  null. Filtered at load.
- **Multiple prices per parcel**, differing by appraisal period. The loader keeps
  them all; do not assume one row per parcel.

### The join key is the blocker, not the quota

Province must resolve from the **name**, because LED's `province_id` is empty on
most rows. Then `(province, amphur)` scopes the tambon-name match, with
`เทศบาล` prefixes stripped — see `tambonResolver.js`.

Result on the Khon Kaen sample: **28 of 30** resolved to an area grade. The 2
that failed are บ้านเรือ / ภูเวียง style names outside the published tambon list.

### Area grades are biased low, and are not parcel prices

Hand-checking six lots showed the ตำบล grade badly understating real land in
เมืองขอนแก่น — an urban parcel is not the average of a tambon that is mostly
farmland. Use it as a fallback range only, always labelled, and prefer the exact
per-parcel TD figure when it exists.

### "asking ÷ appraised" is not a bargain metric

It reads well and means nothing. A low ratio usually means the asking price was
already cut, not that the land is cheap. **Do not ship it as a deal indicator.**

---

## 6. Coordinates

### Precision must be stated

A parcel can have a real coordinate or only a subdistrict centroid. The centroid
exists so an ungeocoded lot is still visible on the map — but it is a *different
place*, and its position and elevation are not the parcel's. `geo_precision`
records which, and the UI does not present a centroid as a location.

Subdistrict boundaries: 199 Khon Kaen tambons from a public ArcGIS service, with
`ST_PointOnSurface` giving an interior point rather than a centroid that can land
outside the polygon.

### One code base ≠ another

`eva_area_grade.tambon_code` is **not** the national tambon code. Do not join
across code systems.

---

## 7. Height

From **AWS Terrain Tiles** (`terrarium` PNG encoding, keyless), z=14 ≈ 9.2 m/px.

```
metres = (R × 256 + G + B / 256) − 32768
```

24 Khon Kaen parcels: 157–228 m, median 166 m. Plausible — city ~185 m, Chum Phae
~230 m.

**Only sampled where the coordinate is the parcel's own.** A subdistrict
centroid's height says nothing about the land being auctioned, so those stay
`NULL` and the UI says "ไม่ทราบ" rather than printing a number.

Stored with `elevation_source` and `elevation_uncertainty_m` (±9.2 m). A height
with no provenance looks authoritative and is not.

---

## 8. Provenance

Every field records its source and observation date in `field_provenance`. Two
sources covering the same field must never silently overwrite one another — the
views `provenance_current`, `provenance_divergence` and `provenance_drift` exist
to make disagreement visible.

This is why area grades, TD assessments and LED prices stay separate columns
rather than being merged into one "price".

---

## 9. What is still open

- A national backfill has not been run; only Khon Kaen is loaded.
- The CRS correction is applied per-database, not centralised in the TD client,
  so enriching new parcels would write uncorrected coordinates. **Fix before the
  next run.**
- น.ส.3ก. remains unsolvable without a ระวาง that LED does not publish.
- The assessprice service is undocumented and may change without notice.
