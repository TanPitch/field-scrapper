# Reverse-Engineered API — assessprice.treasury.go.th
### ระบบเผยแพร่ราคาประเมินทรัพย์สิน (Property Assessment Price System), Thai Treasury Department

> Reverse-engineered 2026-10-21 from the production site. All endpoints below were **verified live** with working request/response examples. This is public, unauthenticated government data. Use responsibly (rate-limit, identify your client).

---

## 1. Architecture Overview

```
Browser SPA (Vue/Dojo + ArcGIS JS SDK)
        │
        ▼
POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?<target-url>
        │   (same-origin proxy; can be bypassed — see below)
        ▼
WCF DataService:  https://assessprice.treasury.go.th/assessprice/services/DataService.svc/<METHOD>
        │
        ▼
SQL Server stored procedures (GIS5_Q_*, LUT_Q_*, UM_*, GIS_Q_*)   ← the real "API"
```

Key discovery: **the entire data API is one WCF endpoint** (`DataService.svc/DS_TRANSIT`) that dispatches to SQL Server stored procedures named by the `SP` parameter. Everything — parcel search, condo search, lookups, logging — is an SP call.

Secondary endpoints:
- `t17-0040_system5-migrated-ws/api/applog/website-access-log` — analytics logging (POST JSON)
- `assessprice/services/DataService.svc/DS_ENCRYPT_DATA` / `DS_DECRYPT_DATA` — AES-ish blob encrypt/decrypt used for deep-links
- `assessprice/services/DataService.svc/GET_IPADDRESS` — returns client IP JSON
- ArcGIS map services behind the proxy: `https://p-gis.treasury.go.th/arcgis/rest/services/TD_FORMER/.../MapServer`, `TD_ASSET/...` (tile/feature layers)

---

## 2. Calling the API

### Request
```
POST https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT
Content-Type: text/plain            # WCF "raw" mapper — any non-JSON content-type works
                                    # (text/plain and x-www-form-urlencoded both verified)
<key=value&key=value ...>           # form-urlencoded body  — or —  JSON body (also accepted)
```

**Body format rules**
- Standard encoding is `application/x-www-form-urlencoded` (that's what the site sends).
- A raw JSON string body also works (`Content-Type: text/plain`).
- `Content-Type: application/json` FAILS with WCF error *"expected body format value 'Raw'"*.

**Response envelope (always JSON)**
```json
{
  "success": true,          // false usually = bad/missing params for that SP
  "total": 1,               // row count of "data"
  "message": "",
  "data":  [ {...}, ... ],  // primary result set
  "data2": [ ... ], "data3": [ ... ]   // optional secondary result sets (SP-dependent)
}
```
Error (HTTP 200 still): SQL exceptions come back inside `message` (e.g. geometry parse errors).

### Common "session" params (guest, client-side values — verified not enforced)
```
USER_ID=2                      # guest id
USER_TYPE=G                    # guest type
CSRF_TOKEN=BUpOX4Vtg0GfnRwOu2jLZw==   # hardcoded in the JS bundle; some SPs require presence
VISITOR_UUID=<any-guid-like>   # e.g. b104bccbd4f1c6c3b2c05dad3a929eb6
FLAG_DVALUE=1                  # D-VALUE (public disclosure) dataset flag
MB_FLAG=0  WEB_FLAG=1          # mobile/desktop flags
LANGUAGE=TH                    # TH | EN
BEGIN=1  END=20                # pagination window
```
No cookies, no auth headers required. `ASP.NET_SessionId` is optional.

---

## 3. Verified endpoints (SP catalog)

### 3.1 Land parcel search — `GIS5_Q_PARCEL` ⭐ main endpoint
Searches assessed land parcels by deed number, land number, or cadastral map sheet (ระวาง).

```
SP=GIS5_Q_PARCEL
CHANOD_NO=4878          # โฉนด title-deed number        (search type: เลขที่โฉนด)
SURVEY_NO=143           # หน้าสำรวจ survey page          (optional)
LAND_NO=2               # เลขที่ดิน land number          (alternative to CHANOD_NO)
PARCEL_TYPE=1           # 1=ที่ดิน (deed) — "CHANOD"/"NS3K" variants seen in JS
PARCEL_LAYER=PARCEL     # PARCEL | NS3K | CONDO | BUILDING
PERIODS=7               # valuation period id (7 = 2566-2569, from LUT_Q_PERIODS)
PROV_CODE=10            # จังหวัด province code  ← REQUIRED (from AdminPoly widget; NOT CHANGWAT_CODE)
AMPHUR_CODE=13          # อำเภอ (optional)
TUMBON_CODE=01          # ตำบล (optional)
UTM=5136III             # ระวาง combined: UTMMAP1+UTMMAP2 (NS3K flow)
UTM_MAP4=03             # ชิ้นที่ (pad to 2 digits: "0"+x when 1 digit); UTM_MAP3 must be OMITTED
BEGIN=1 END=20          # pagination
```

**Verified example** (chanod 4878, Phra Khanong, Bangkok):
```bash
curl -s -X POST 'https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT' \
  -H 'Content-Type: text/plain' \
  --data-urlencode 'SP=GIS5_Q_PARCEL' \
  --data-urlencode 'CHANOD_NO=4878' --data-urlencode 'SURVEY_NO=143' \
  --data-urlencode 'PARCEL_TYPE=1' --data-urlencode 'PERIODS=7' \
  --data-urlencode 'PROV_CODE=10' --data-urlencode 'PARCEL_LAYER=PARCEL' \
  --data-urlencode 'BEGIN=1' --data-urlencode 'END=20' \
  --data-urlencode 'USER_ID=2' --data-urlencode 'USER_TYPE=G' \
  --data-urlencode 'FLAG_DVALUE=1' --data-urlencode 'CSRF_TOKEN=BUpOX4Vtg0GfnRwOu2jLZw=='
```

**Response row (trimmed):**
```json
{
  "CHANOD_NO": "4878", "LAND_NO": "2", "SURVEY_NO": "143",
  "RAWANG": "5136-III-6814-03",
  "AMPHUR_NAME": "พระโขนง", "TUMBON_NAME": "คลองเตย", "CHANGWAT_CODE": "10",
  "CURR_EVAPRICE": "95,000",                     // ราคาประเมิน บาท/ตร.ว.
  "SHAPE": "POINT (669075.015 1515862.242)", "SRID": 24047,   // UTM 47N
  "DOL_NAME": "สำนักงานที่ดินกรุงเทพมหานคร สาขาพระโขนง",
  "DOL_SHAPE": "POINT (100.64699 13.68394)", "DOL_SRID": 4326,
  "TITLE": "<font ...>ระวาง: ... ราคาประเมิน...</font>",       // pre-rendered HTML popup
  "DETAIL": "<span ...>ราคาประเมิน: 95,000 บาท/ตร.ว.</span>",
  "BRANCH_CODE": "10020000", "OBJECTID": 454436, "PARCEL_TYPE": "1"
}
```
`data2` = contact info block (`PROV_NAME`, `PHONE`) when found.

### 3.2 Map identify (click-on-map lookup) — `GIS5_Q_IDEN` ⭐ easiest data source
Returns the parcel (with assessed price) at a coordinate. Query both cadastral layers in parallel (as the app does):

```
SP=GIS5_Q_IDEN
PARCEL_LAYER=PARCEL            # one call with "PARCEL", one with "NS3K"
GEO_47=POINT (669000 1516000)  # WKT point, EPSG:24047 (UTM 47N old datum)
GEO_48=POINT (578000 1519000)  # WKT point, EPSG:24048 (UTM 48N old datum)
LANGUAGE=TH
```
Response: `data[0]` = same parcel shape as 3.1 including `CURR_EVAPRICE`, `RAWANG`, `CHANOD_NO`, `TITLE`/`DETAIL` HTML. SQL geometry parser → `GEO_*` must be valid WKT (`POINT (x y)`).

### 3.3 Condominium search — `GIS5_Q_CONDO`
```
SP=GIS5_Q_CONDO  PROV_CODE=10  BEGIN=1  END=5  PARCEL_LAYER=CONDO
→ 3,861 condos in Bangkok (total), rows: CONDO_ID, TITLE (name), AMPHUR_NAME, PERIODS_NAME, SHAPE...
```
Detail: `SP=GIS5_Q_CONDO_DESC` with `CONDO_ID` (plus USER_TYPE/USER_ID/FN_ID) → full condo valuation records.

### 3.4 Building / structure type search — `GIS5_Q_CONSTRUCTION`
```
SP=GIS5_Q_CONSTRUCTION  PROV_CODE=10  BEGIN=1  END=5
→ rows: TITLE="บ้านพักอาศัยไม้ชั้นเดียว", DETAIL="8,450.00 บาท/ตร.ม. ...", ID_CONSTR="101"
```
Detail: `SP=GIS5_Q_CONSTRUCTION_DESC` with the report params (ID_CONSTR etc.).

### 3.5 Area autocomplete — `GIS5_Q_AREA_FT`
```
SP=GIS5_Q_AREA_FT  KEYWORD=<free text ≥3 chars>   # Thai address text
→ rows: DISPLAY_TEXT, LAT, LONG   (used for the address autocomplete box)
```

### 3.6 Postcode → admin codes — `GIS5_Q_AREA_POSTCODE`
```
SP=GIS5_Q_AREA_POSTCODE  POSTCODE=10100
→ rows: PROV_CODE, AMPH_CODE, TUMB_CODE, POSTCODE
```

### 3.7 Land office locator — `GIS5_Q_DOL`
```
SP=GIS5_Q_DOL  PROV_CODE=10  BEGIN=1  END=5  USER_ID=2
→ rows: TITLE (office name), ADDRESS, TELEPHONE, AREA (jurisdiction districts), X, Y, SHAPE(4326), DOL_CODE
```

### 3.8 Lookups / metadata
| SP | Params | Returns (verified) |
|----|--------|--------------------|
| `LUT_Q_BND` | `SYS_ID=GIS5` | 77 provinces (`CODE`, `DESCR`) |
| `LUT_Q_DOL` | – | 462 land offices (`CODE`, `DESCR`) |
| `LUT_Q_PERIODS` | – | valuation periods (`PERIODS_ID`, `PERIODS_NAME` = "2566 - 2569") |
| `LUT_Q_MUNICIPAL` | `PROV_CODE` | 50 municipalities for Bangkok |
| `LUT_Q_BH_TYPE` | – | building type lut (empty w/o more params) |
| `GIS5_Q_CONFIG` | `USER_ID`, `MB_FLAG`, `WEB_FLAG` | 41 app configs + data2(15) + data3(253 menu/layer defs) + data5, data6 |
| `GIS5_Q_CHECKSYS` | `SYSTEM=GIS5` | 12 system config rows |
| `GIS_Q_ADMINPOLY_LOCATION` | `PROV_CODE` | admin boundary polygon (`SHAPE` POLYGON, SRID 32647) |
| `GIS_Q_BUFFER` | point + radius | parcels within radius (needs WKT + RADIUS ≤ 20 km) |

### 3.9 Telemetry SPs (observed, write-type)
`GIS5_I_LOG_SEARCH`, `GIS5_I_SUGGESTION`, `GIS5_U_FAVORITE`, `GIS5_Q_FAVORITE`-style calls, `UM_I_LOGIN_HISTORY`, `UM_U_LOGIN_HISTORY`, `GIS5_Q_USER_ONLINE`, `GIS5_U_USER_ONLINE`, `GIS5_D_USER_ONLINE`, `UP_Q_LANGUAGE`, `UP_U_LANGUAGE`.

---

## 4. Non-SP endpoints

### 4.1 Access log (proxy → .NET 8 migrated WS)
```
POST /assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/t17-0040_system5-migrated-ws/api/applog/website-access-log
Content-Type: application/json
{"accessType":"desktop","screenWidth":1440,"browser":"Chrome","url":"https://assessprice.treasury.go.th/", "CLIENT_TYPE":"desktop","SYSTEM_TYPE":"D-VALUE", ...}
→ {"message":"Website access logged successfully."}
```

### 4.2 Encrypt/decrypt (deep-link builder)
```
POST .../DataService.svc/DS_ENCRYPT_DATA      body: DATA=<urlencoded JSON string>
→ {"success":true,"params":{"ENCRYPT_DATA":"2E3A78EAD56B4DCA..."}}
POST .../DataService.svc/DS_DECRYPT_DATA      body: ENCRYPT_DATA=<blob>
→ {"success":true,"params":{"DATA":"<original json>"}}
```

### 4.3 Client IP
```
POST .../DataService.svc/GET_IPADDRESS   → {"IP":"x.x.x.x"}
```

### 4.4 ArcGIS services (via proxy or direct)
- `https://p-gis.treasury.go.th/arcgis/rest/services/TD_FORMER/TD_Former_Staff_ViewData/MapServer`
- `https://p-gis.treasury.go.th/arcgis/rest/services/TD_FORMER/TD_Former_Staff_ViewData_Period4/MapServer`
- `https://p-gis.treasury.go.th/arcgis/rest/services/TD_ASSET/TD_Former_View/MapServer`
Standard ArcGIS REST: `.../MapServer/0/query?where=1=1&outFields=*&f=json`

---

## 5. Code notes (from the JS bundle)

- URL builder: `[host, "services", svcName ?? "DataService.svc", method ?? "DS_TRANSIT"].join("/")`; host = `https://assessprice.treasury.go.th/assessprice` (fallback CUA host: `https://npvcuat.treasury.go.th/assessprice`).
- `Proxy.ashx?<full-url>` is used for same-origin bypass; calling `DataService.svc` **directly** works (CORS: `Access-Control-Allow-Origin: *`).
- `CSRF_TOKEN` cookie read; bundle hardcodes fallback `"BUpOX4Vtg0GfnRwOu2jLZw=="`.
- Parcel search SP requires `PROV_CODE` (AdminPoly widget's `_getValueAttr()` → `{PROV_CODE, ...}`); passing `CHANGWAT_CODE` instead returns `success:true, total:0`.
- `UTM_MAP4` gets left-padded with "0" when 1 digit; `UTM_MAP3` must be omitted for deed search (else `success:false`).
- Config flags: `IS_ENCRYPT:"1"`, `EVAACC_ENABLE:true`, `THAID_ENABLE:true` (ThaID/Paotang OAuth endpoints exist for login flows: `api/AppPaotang/start-authentication`, `AppThaiID/callback`, `imauth.bora.dopa.go.th/api/v2/oauth2/auth/`).

## 6. Quickstart Python client

See `assessprice_client.py` — a minimal **verified working** client with:
`identify(lon, lat)` (map point → parcel), `search_chanod(chanod, prov)` (deed search),
`search_condo(prov)`, `search_construction(prov)`, `land_offices(prov)`, `area_by_postcode()`,
`area_autocomplete()`, `lookup_provinces()`.

Output of its self-test (2026-10-21):
```
Identify at Victory Monument (100.5776, 13.7691)
  ระวาง: 5136 IV 7022 10 | เลขที่โฉนด: 5566 เลขที่ดิน: 641
  price: 59,500 | chanod: 5566
Chanod 4878 in Bangkok -> 95,000 THB/sq.wa
Condos in Bangkok -> 3,861 total (คิว ชิดลม-เพชรบุรี, นิรันดร์คอนโดมิเนียม, ...)
```

## 7. Reference coordinate notes (important!)

- Parcel geometry: **SRID 24047/24048 = UTM 47N/48N on the INDIAN 1975 datum** (Thai omniprojection), meters.
- Land-office / condo geometry: SRID 4326 (lon/lat WGS84).
- WGS84 → SRID 24047 requires both an ellipsoid change (a=6377276.345, 1/f=298.8017) and the Molodensky datum shift (dX=+199, dY=+831, dZ=+317 m). `assessprice_client.py` implements this (closed-loop verified to ~40 m — sufficient for point identify; a ±60 m fallback grid is included).
- Worked example: chanod 4878 → `POINT (669075.015 1515862.242)` @ 24047 ≈ WGS84 (13.7093, 100.5605).
