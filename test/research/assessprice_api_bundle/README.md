# assessprice.treasury.go.th — API Bundle

Reverse-engineered API of the Thai Treasury Department land assessment price site
(ระบบเผยแพร่ราคาประเมินทุนทรัพย์ — กรมธนารักษ์). Guest mode: no login, no CSRF, no API key.

## Quick start — the one endpoint

Every dropdown and parcel search is a single POST:

```
POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

SP=LUT_Q_BND&SYS_ID=GIS5                          -> 77 provinces        {CODE, DESCR}
SP=LUT_Q_BND&SYS_ID=GIS5&PROV_CODE=81             -> districts of Krabi  {CODE, DESCR}
SP=LUT_Q_BND&SYS_ID=GIS5&PROV_CODE=81&AMPH_CODE=01 -> subdistricts of เมืองกระบี่
SP=GIS5_Q_PARCEL&PERIODS=7&...                     -> land parcel + ราคาประเมิน
```

District codes are 2-digit amphoe codes **within** the province — always pair with `PROV_CODE`
(composite `81`+`01` = `8101` เมืองกระบี่).

## Files

| File | What it is |
|---|---|
| `assessprice_API.md` | Full API reference — every endpoint, param, verified examples |
| `provinces_districts.json` | All 77 province codes + all 928 district codes (grouped by province) + period |
| `assessprice_client.py` | Python client, stdlib only: `get_provinces() get_districts() get_subdistricts() get_land_offices() search_parcel_chanod() search_parcel_land_no()` |
| `assessprice_client.js` | Node 18+ client, no deps, same functions |

## Run the clients

```bash
python3 assessprice_client.py     # demo: BKK districts + a real parcel lookup
node assessprice_client.js
```

Note: the endpoint has no CORS headers for foreign origins — call it server-side
(the clients do). Rate-limit politely; it is a government service.
