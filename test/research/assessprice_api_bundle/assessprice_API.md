# assessprice.treasury.go.th — Internal API Reference

**Service:** ระบบเผยแพร่ราคาประเมินทุนทรัพย์ (Land/Asset Assessment Price) — กรมธนารักษ์, กรมที่ดิน
**Base site:** <https://assessprice.treasury.go.th/>
**Status:** Reverse-engineered from the site's own XHR traffic and verified with live requests (Oct 2026). Guest mode — **no login, no CSRF token, no API key** required.

---

## 1. The single endpoint everything goes through

The whole SPA (Vite + Angular + ArcGIS) sends **one POST request shape** for all dropdown data and parcel searches — a stored-procedure "transit" service wrapped by an ASP.NET proxy:

```http
POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Accept: application/json
Origin: https://assessprice.treasury.go.th
Referer: https://assessprice.treasury.go.th/

SP=<PROCEDURE_NAME>&<PARAM>=<VALUE>&...
```

Notes:

* The **query string after `Proxy.ashx?` is the real target URL**, then a second trailing `?` (the app appends it as a cache-buster). Keep both `?`.
* Body is form-urlencoded. Empty-string / null params are stripped (the site's own request class does the same), so omit unused fields.
* Response is always:

```json
{
  "success": true,
  "total": 77,
  "message": "",
  "data": [ { "...": "..." } ]
}
```

* Rate-limit politely — this is a government service. One request per dropdown level per user action mirrors what the website itself does.

---

## 2. จังหวัด / อำเภอ / ตำบล dropdown data (`LUT_Q_BND`)

One stored procedure serves the whole cascading dropdown. `PROV_CODE` / `AMPH_CODE` decide which level you get (details & code semantics in the "District codes" subsection below):

| Level | POST body | Returns |
|---|---|---|
| **จังหวัด (77)** | `SYS_ID=GIS5&SP=LUT_Q_BND` | `[{CODE, DESCR}, ...]` |
| **อำเภอ/เขต** | `PROV_CODE=10&SYS_ID=GIS5&SP=LUT_Q_BND` | districts of that province |
| **ตำบล/แขวง** | `PROV_CODE=10&AMPH_CODE=04&SYS_ID=GIS5&SP=LUT_Q_BND` | subdistricts of that district |

Optional `LAYER=PARCEL` on the district call reproduces the deed-form behaviour (for Bangkok it adds a pseudo-entry `98:กรุงเทพมหานคร` meaning "whole province" — used to search across all BKK land offices; total becomes 68 for BKK).

### curl — province list

```bash
curl -s -X POST \
  "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "Origin: https://assessprice.treasury.go.th" \
  -H "Referer: https://assessprice.treasury.go.th/" \
  --data "SYS_ID=GIS5&SP=LUT_Q_BND"
```

Response (first entries):

```json
{"success":true,"total":77,"message":"","data":[
  {"CODE":"81","DESCR":"กระบี่"},
  {"CODE":"10","DESCR":"กรุงเทพมหานคร"},
  {"CODE":"71","DESCR":"กาญจนบุรี"},
  {"CODE":"46","DESCR":"กาฬสินธุ์"},
  {"CODE":"62","DESCR":"กำแพงเพชร"}
]}
```

### Province codes

`CODE` is the standard Thai province code (รหัสจังหวัด 2 หลัก, same as the first two digits of postcode/ID-card system). Examples: `10` กรุงเทพมหานคร, `81` กระบี่, `71` กาญจนบุรี, `84` สุราษฎร์ธานี, `50` เชียงใหม่, `40` ขอนแก่น. **Full 77-province + all-district list is in `provinces_districts.json` (companion file).**

### District codes — where they come from

Districts (อำเภอ / เขต) are **not a separate endpoint** — it is the *same* `LUT_Q_BND` procedure, with one extra parameter: **`PROV_CODE`**. That is the whole trick the website's cascading dropdown uses:

```http
PROV_CODE=10&SYS_ID=GIS5&SP=LUT_Q_BND
```

### curl — district list (อำเภอ/เขต) of one province

```bash
curl -s -X POST \
  "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "Origin: https://assessprice.treasury.go.th" \
  -H "Referer: https://assessprice.treasury.go.th/" \
  --data "PROV_CODE=81&SYS_ID=GIS5&SP=LUT_Q_BND"
```

Response (Krabi, 8 districts — verified live Oct 2026):

```json
{"success":true,"total":8,"message":"data":[
  {"CODE":"03","DESCR":"เกาะลันตา"},
  {"CODE":"02","DESCR":"เขาพนม"},
  {"CODE":"04","DESCR":"คลองท่อม"},
  {"CODE":"06","DESCR":"ปลายพระยา"},
  {"CODE":"01","DESCR":"เมืองกระบี่"},
  {"CODE":"07","DESCR":"ลำทับ"},
  {"CODE":"08","DESCR":"เหนือคลอง"},
  {"CODE":"05","DESCR":"อ่าวลึก"}
]}
```

Row shape is identical to provinces: `CODE` + `DESCR`. The parameter that selects the level is presence/absence of `PROV_CODE` / `AMPH_CODE`:

| You send | You get back |
|---|---|
| `SP=LUT_Q_BND` only | 77 provinces |
| `+ PROV_CODE=<pv>` | districts (อำเภอ/เขต) of that province |
| `+ PROV_CODE=<pv>&AMPH_CODE=<am>` | subdistricts (ตำบล/แขวง) of that district |

### District code semantics

* `CODE` is the **2-digit amphoe code inside its own province** (01–99, zero-padded).
* ⚠️ **An `AMPH_CODE` is NOT unique nationally.** `01` is the “เมือง…” (capital district) of nearly every province — Krabi `01` is เมืองกระบี่, Chiang Mai `01` is เมืองเชียงใหม่, etc. Always pair it with its `PROV_CODE`.
* The **composite 4-digit code** `PROV_CODE + AMPH_CODE` is the standard Thai administrative code and *is* unique nationally (same numbering the Civil Registration / postcode systems use). Examples:

| Composite | Meaning |
|---|---|
| `10` + `04` = `1004` | กรุงเทพมหานคร → เขตบางรัก |
| `10` + `33` = `1033` | กรุงเทพมหานคร → เขตคลองเตย |
| `50` + `01` = `5001` | เชียงใหม่ → อำเภอเมืองเชียงใหม่ |
| `81` + `03` = `8103` | กระบี่ → อำเภอเกาะลันตา |
| `30` + `01` = `3001` | นครราชสีมา → อำเภอเมืองนครราชสีมา |

Verified live counts: Bangkok `10` → 50 เขต, Chiang Mai `50` → 25 อำเภอ, Krabi `81` → 8 อำเภอ, Nakhon Ratchasima `30` → 32 อำเภอ, Songkhla `90` → 16 อำเภอ. Nationwide: **928 districts over 77 provinces**.

### All district codes offline — `provinces_districts.json`

You don't need to crawl the API province-by-province: the companion file already contains every code, fetched from the live API (identical when re-verified):

```json
{
  "provinces":  [ {"CODE": "81", "DESCR": "กระบี่"}, ... 77 rows ... ],
  "districts_by_province": {
    "81": [ {"CODE": "03", "DESCR": "เกาะลันตา"}, ... ],
    "10": [ {"CODE": "33", "DESCR": "คลองเตย"}, ... 50 rows ... ],
    ... 77 keys ...
  },
  "periods": [ {"PERIODS_ID": 7, "PERIODS_NAME": "2566 - 2569"} ]
}
```

Lookup pattern — province name → code → district list:

```python
import json
data = json.load(open("provinces_districts.json"))
prov = next(p for p in data["provinces"] if p["DESCR"] == "เชียงใหม่")   # {"CODE": "50", ...}
districts = data["districts_by_province"][prov["CODE"]]                  # 25 rows
amph = next(d for d in districts if d["DESCR"] == "เมืองเชียงใหม่")     # {"CODE": "01", ...}
```

### Subdistrict codes (ตำบล/แขวง) — third level

Add `AMPH_CODE` to cascade one level further. Verified live — subdistricts of เขตบางรัก (`PROV_CODE=10&AMPH_CODE=04`): `04` บางรัก, `01` มหาพฤฒาราม, `02` สีลม, `05` สี่พระยา … (5 total). Same `CODE`/`DESCR` shape, 2-digit tambon code within the district; composite `10` + `04` + `02` = `100402` แขวงสีลม. Subdistricts are **not** included in `provinces_districts.json` (928 × ~8 rows would make it huge) — call the API per district when you need them, or crawl once with `get_subdistricts()` from the sample clients.

---

## 3. Supporting lookups

| Purpose | POST body | Notes |
|---|---|---|
| **สำนักงานที่ดิน (land office)** | `PROV_CODE=10&SP=LUT_Q_DOL` | BKK → 17 offices, `CODE` = 8-digit branch code e.g. `10000000` สำนักงานที่ดินกรุงเทพมหานคร, `10110000` สาขาดอนเมือง |
| **ช่วงเวลาประเมิน (periods)** | `SP=LUT_Q_PERIODS` | currently `[{PERIODS_ID: 7, PERIODS_NAME: "2566 - 2569"}]` → pass `PERIODS=7` |
| เขตปกครอง (มิวนิทิพัล) | `PROV_CODE=..&AMPH_CODE=..&SP=LUT_Q_MUNICIPAL` | municipality list |
| Province polygon (map zoom) | `PROV_CODE=10&SP=GIS_Q_ADMINPOLY_LOCATION` | returns `SHAPE` (WKT) + `SRID` |

---

## 4. Land-parcel search — `GIS5_Q_PARCEL`

This is the query behind **"ค้นหาจากข้อมูลเอกสารสิทธิ"** (search by deed document). Two modes, selected by `PARCEL_TYPE`:

### 4.1 Search by เลขที่โฉนด (title-deed number)

```http
SP=GIS5_Q_PARCEL
PERIODS=7              (2566-2569)
CHANOD_NO=29139        เลขที่โฉนด
SURVEY_NO=18637        หน้าสำรวจ (optional but recommended — see note)
PARCEL_TYPE=CHANOD_NO
PROV_CODE=10
PROV_DESCR=กรุงเทพมหานคร   (optional display string)
PARCEL_LAYER=PARCEL    (PARCEL = ที่ดิน น.ส.4จ; use NS3K for น.ส.3ก)
LANGUAGE=TH
USER_ID=2              (guest)
BEGIN=1&END=20         (row pagination)
VISITOR_UUID=<any-random-32-hex>
FLAG_DVALUE=1
```

> **VISITOR_UUID is required** for `GIS5_Q_PARCEL` (lookup SPs work without it). Any random 32-char hex string works — the site generates one client-side for analytics. Verified with random UUIDs.
>
> **โฉนด numbers are not unique.** The same number exists in several land offices. Without `SURVEY_NO` or `DOL_CODE`, chanod `29139` in BKK alone returns 20 rows — paginate with `BEGIN/END` or disambiguate with `SURVEY_NO` (หน้าสำรวจ) or `DOL_CODE`.

### 4.2 Search by เลขที่ดิน (land number) + ระวาง

The site's form fields map like this:

| Form field (Thai) | Param | Example |
|---|---|---|
| เลขที่ดิน | `LAND_NO` | `1693` |
| แผนที่ภูมิประเทศ | `UTM` and `UTM_MAP1` | `5136III` |
| ระวาง | `UTM_MAP3` | `6414` |
| แผ่นที่ | `UTM_MAP4` | `04` |
| จังหวัด | `PROV_CODE` | `10` |

Send `PARCEL_TYPE=LAND_NO` plus the same common params as 4.1. (If you type the topo map with a dash, e.g. `5136-III`, the site splits it into `UTM_MAP1=5136&UTM_MAP2=III` — either shape is accepted; sending `UTM=5136III&UTM_MAP1=5136III` is what the live UI actually emitted.)

### 4.3 Verified example (curl)

```bash
curl -s -X POST \
  "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "Origin: https://assessprice.treasury.go.th" \
  -H "Referer: https://assessprice.treasury.go.th/" \
  --data-urlencode "SP=GIS5_Q_PARCEL" \
  --data-urlencode "PERIODS=7" \
  --data-urlencode "CHANOD_NO=29139" \
  --data-urlencode "SURVEY_NO=18637" \
  --data-urlencode "PARCEL_TYPE=CHANOD_NO" \
  --data-urlencode "PROV_DESCR=กรุงเทพมหานคร" \
  --data-urlencode "PROV_CODE=10" \
  --data-urlencode "PARCEL_LAYER=PARCEL" \
  --data-urlencode "LANGUAGE=TH" \
  --data-urlencode "USER_ID=2" \
  --data-urlencode "BEGIN=1" \
  --data-urlencode "END=20" \
  --data-urlencode "VISITOR_UUID=0123456789abcdef0123456789abcdef" \
  --data-urlencode "FLAG_DVALUE=1"
```

Response (trimmed to the useful fields of `data[0]`):

```json
{
  "success": true, "total": 1,
  "data": [{
    "CHANOD_NO": "29139",
    "LAND_NO": "1693",
    "LAND_NO_TH": "๒๙๑๓๙",
    "SURVEY_NO": "18637",
    "RAWANG": "5136-III-6414-04",
    "AMPHUR_NAME": "บางรัก",
    "TUMBON_NAME": "บ้านทวาย",
    "DOL_NAME": "สำนักงานที่ดินกรุงเทพมหานคร",
    "CURR_EVAPRICE": "120,000",
    "BRANCH_CODE": "10000000",
    "CHANGWAT_CODE": "10",
    "PARCEL_TYPE": "CHANOD_NO",
    "LAYER_NAME": "PARCEL_47_POINT",
    "RN": 10001305,
    "TITLE": "...(HTML card)...",
    "DETAIL": "...ราคาประเมิน: 120,000 บาท/ตร.ว....",
    "SHAPE": "POINT (665990.28 1515535.74)", "SRID": 24047
  }]
}
```

`CURR_EVAPRICE` = ราคาประเมิน บาท/ตร.วา (baht per square wah). `RAWANG` = full map-sheet reference. `TITLE`/`DETAIL` are pre-rendered HTML used by the result list.

---

## 5. Other parcel layers

| What | `PARCEL_LAYER` | Extra params |
|---|---|---|
| ที่ดิน น.ส.4จ (deed land) | `PARCEL` | as above |
| น.ส.3ก (NS3K) | `NS3K` | `NS3A_ID` (เลขที่ น.ส.3ก.), `UTM_MAP1..4`; SP still `GIS5_Q_PARCEL` |
| ห้องชุด (condo) | `CONDO` | SP `GIS5_Q_CONDO`, fields `CONDO_NAME`, `AMPH_CODE`, `TUMB_CODE` … |
| สิ่งปลูกสร้าง (construction) | — | SP `GIS5_Q_CONSTRUCTION` |

Map identification (click-on-map) uses SP `GIS5_Q_IDEN` with `PARCEL_LAYER`, `GEO_47`/`GEO_48`, `BRANCH_CODE`, `PROV_CODE`.

---

## 6. Browser-side usage (CORS)

The endpoint **does not send CORS headers for foreign origins**, so browser JS on your own domain cannot call it directly. Options:

1. **Server-side proxy** (recommended) — call it from your backend (Python/Node/PHP) as in the sample clients.
2. Serverless function (Vercel/Cloudflare Worker) forwarding the POST.
3. In Thailand-department context you can ask กรมธนารักษ์ for the official web service (the site also exposes a SOAP-ish gateway at `p-portal.treasury.go.th/land/web_service/SUMMARY/` for summary data).

## 7. Companion files

All files (plus a single `assessprice_api_bundle.zip` containing all of them) ship together:

| File | Content |
|---|---|
| `assessprice_API.md` | This document — full endpoint reference |
| `assessprice_client.py` | Tested Python client (stdlib only) with all functions + demo |
| `assessprice_client.js` | Tested Node 18+ client (no deps) with all functions + demo |
| `provinces_districts.json` | All 77 provinces + all 928 district codes (grouped by province) + current period |
| `README.md` | Quick start / file map |
