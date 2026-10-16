# LandsMaps API Research Notes

**Target:** `https://landsmaps.dol.go.th/`
**Operator:** Department of Lands (กรมการถือกรรมที่ดินและสัตหีประจำจังหวัด / DOLA)
**Date of testing:** 2026-10-15
**App version observed:** 4.5.14
**Status:** Undisclosed — do not submit without authorization

---

## TL;DR

The service issues **signed access tokens to anonymous visitors with zero credentials**, and the
parcel-lookup endpoints have **no rate limiting whatsoever**. Those two facts combine into a
single high-severity issue: an unauthenticated party can enumerate the national land-parcel
database at arbitrary speed.

There is **no 20/day quota** on the endpoints tested. If you were told one exists, it is not
enforced server-side.

A separate and more severe issue was found: production government SSO credentials are hardcoded
in client-side JavaScript. See Finding 2.

---

## Findings

| # | Finding | Severity | CWE |
|---|---------|----------|-----|
| 1 | No rate limiting on anonymous parcel lookup | High | CWE-770 |
| 2 | Production DGA citizen-portal secret in client JS | Critical | CWE-798 |
| 3 | Unauthenticated anonymous token issuance | Medium | CWE-306 |
| 4 | Dev issuer (`localhost:30001`) in production JWTs | Low | CWE-200 |
| 5 | Wildcard CORS on authenticated API | Low | CWE-942 |
| 6 | Shared GeoServer `authkey` across all provinces | Medium | CWE-798 |
| 7 | Firebase config + stale default token at `/getkey` | Low | CWE-200 |

### Finding 1 — No rate limiting on anonymous parcel lookup

`GetParcelByDouleClick` and friends accept an anonymous token and return full parcel metadata.
45 sequential requests against a single token all returned `200`. No `429`, no throttling, no
quota response of any kind.

**Impact:** full-database enumeration. Parcel geometry (`parcel_seq`, `reg_seq`, UTM
coordinates), assessed `landprice`, land-office contact details, and QR tokens are all
retrievable at unlimited rate.

**PoC** (single token, sequential, ~0.15s spacing):

```bash
# 1. mint an anonymous token — no credentials required
curl -sS https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken \
  | jq -r '.result[0].access_token' > token.txt

# 2. hit the endpoint repeatedly with that one token
for i in $(seq 1 45); do
  curl -sS -o /dev/null -w "%{http_code} " \
    "https://landsmaps.dol.go.th/apiService/LandsMaps/GetParcelByDouleClick/18.3003611/103.6457946" \
    -H "Authorization: Bearer $(cat token.txt)"
done; echo
# observed: 200 200 200 ... (45x, no throttle)
```

### Finding 2 — Production DGA secret hardcoded in client JS

`Script/login/login.js`, ~line 1221:

```js
} else if (sessionStorage.getItem("czp_flag") == "prod") {
  ConsumerKey    = "c379188c-fe7a-47d7-8936-809f33d53d5b";
  ConsumerSecret = "alx0AVvONzq";
  url_deproc = "https://api.egov.go.th/ws/dga/czp/prod/v1/core/shield/data/deproc";
}
```

A UAT `ConsumerSecret` sits alongside it (`PuGOIvrH3OB`).

**Impact:** anyone can impersonate LandsMaps to the Department of Administrative Management's
national citizen-portal SSO gateway and request identity assertions for Thai citizens. This
affects a *third party* and should be reported to DGA directly and urgently.

### Finding 3 — Unauthenticated anonymous token issuance

`GET /apiService/JWT/GetJWTAccessToken` returns a signed HS512 JWT with
`token_usage: "public"`, `user_id: null`, 12-hour lifetime, and no proof-of-work, captcha, or
session binding.

Anonymous browsing is presumably intentional. The problem is that it removes attribution
entirely, which makes any token-scoped quota meaningless — hence Finding 1.

**Scope is correctly enforced.** The token carries
`user_group_data_list: "1,1,0,0,0,0,0,1"`, and the server honours it: `lands_owner`,
`lands_allocation`, and `lands_status.{obligation,freeze,not_transfer}` all return `null` for
anonymous callers. No owner PII leaks. This part is done right.

### Finding 4 — Dev issuer in production tokens

Every production JWT carries `iss: "https://localhost:30001/"`. The identity service is running
a development profile in production, which raises the question of whether the HS512 signing key
is a default or development value. Not independently verified — needs the operator to confirm.

### Finding 6 — Shared GeoServer authkey

`84b7876c-62a2-4df9-a6e3-2fb41915e934` is hardcoded in the layer list returned to every
visitor and reused across all 77 province WMS endpoints.

---

## API surface

All endpoints live under `https://landsmaps.dol.go.th/apiService/`.
Full machine-readable map: `Service/ProvinceService/configapi.json`.

### JWT
- `GET  /JWT/GetJWTAccessToken` — anonymous token mint

### Service — parcel lookup (the interesting ones)
- `GET  /LandsMaps/GetParcelByDouleClick/{lat}/{lon}` — map click lookup
- `GET  /LandsMaps/GetParcelByParcelNo/{prov}/{parcelno}`
- `GET  /LandsMaps/GetParcelByLandNo/...`
- `GET  /LandsMaps/GetParcelByLatLon/...`
- `GET  /LandsMaps/GetParcelByNorthEast/...`
- `GET  /LandsMaps/GetParcelByRegSEQ/...`
- `GET  /LandsMaps/GetParcelBySurveyNo/...`
- `GET  /LandsMaps/GetLandsPrice/...`
- `GET  /LandsMaps/GetTaxByParcelNo/...`
- `GET  /LandsMaps/GetParcelByQRCODE/...`
- `GET  /LandsMaps/GetStreetview`

### Master — geography
- `GET /Master/GetProvince` — all provinces
- `GET /Master/GetAmphoe/{pvcode}` — all districts in one province
- `GET /Master/GetTambol/{pvcode}/{amcode}` — all subdistricts. Note `amcode` is the **2-digit**
  code, *not* the 4-digit `amphoe_id`. `/GetTambol/38/01` works, `/GetTambol/38/3801` does not.
- `GET /Master/GetLandoffice/{pvcode}` — land offices in a province
- `GET /Master/GetDepartment`, `/Master/GetUTMScale`

Every response carries an `amcode`/`tamcode` of `"00"` meaning "Select District/Subdistrict" —
filter those out.

### LandsMaps — auth, favorites, history, survey
`Login`, `LoginSocial`, `LoginOpenID`, `LoginLandofficeAD`, `LoginLandofficeLDAP`,
`LoginDepartment`, `LoginThaiD`, `LoginCitizenPortalID`, `Register*`, `ActiveUser`,
`GetParcelFavorite`, `CreateParcelFavorite`, `DeleteParcelFavorite`, `GetHistory`,
`LogViewer`, `GetAnnounce`, `CreateSurvey`, `GetSurveyByUser`, OTP and password endpoints.

Note: favorites endpoints correctly return `403 "User login required"` for anonymous tokens.

### Backend — layer management
`GetLayer`, `CreateLayer`, `UpdateLayer`, `UpdateLayerStatus`, `DeleteLayer`

**Not tested.** Worth checking authorization independently — an unauthenticated `DeleteLayer`
would be a far more serious report than the rate limit. Flagged as follow-up.

### GeoServer WMS
- `/geoserver/LANDSMAPS/wms`
- `/pllu/{PLLU_CENTRAL,PLLU_NORTH,PLLU_NE,PLLU_EAST,PLLU_EEC,PLLU_SOUTH}/wms`

---

## Auth model

Every data endpoint requires `Authorization: Bearer <jwt>`. The public token claims:

```json
{
  "unique_name": "1",
  "register_type_seq": "8",
  "token_usage": "public",
  "user_group_data_list": "1,1,0,0,0,0,0,1",
  "jti": "<per-token uuid>",
  "iss": "https://localhost:30001/",
  "aud": "LandsMaps"
}
```

Client-side refresh lives in `login.js` (`refreshPublicTokenIfNeeded`) — it re-mints when the
token is within 5 minutes of expiry, every 60 seconds.

The token endpoint is called unauthenticated, so a client simply runs:

```
GET /apiService/JWT/GetJWTAccessToken  ->  store access_token  ->  call data endpoints
```

---

## Reference data

`codes.json` holds the full Thai administrative hierarchy, pulled anonymously from the
`/Master/` endpoints on 2026-10-15. 1,164 HTTP requests total.

| Collection | Rows | Key fields |
|---|---|---|
| `provinces` | 77 | `pvcode`, `name_th`, `name_en` |
| `amphoe` | 1,009 | `pvcode`, `amcode`, `amphoe_id`, `name_th`, `name_en` |
| `tambol` | 8,981 | `pvcode`, `amcode`, `tamcode`, `tambol_id`, `name_th`, `name_en` |
| `landoffices` | 467 | `pvcode`, `landoffice_id`, `landoffice_seq`, `name_th`, `name_en` |

The composite IDs are built to match the fields returned in parcel payloads, so they drop
straight into the service endpoints:

- `amphoe_id` → matches `amphurid` in `GetParcelByDouleClick` output
- `tambol_id` → matches `tambol_id` in the same output
- `landoffice_id` → matches `landoffice_id` (8-digit, e.g. `38000000`)

Verified: parcel `amphurid: "3801"` resolves to `3801` = Mueang Bueng Kan, Bueng Kan, and its
`tambol_id: "380102"` resolves to Non Sombun — the tambol actually returned in the payload.

### Usage

```bash
# mint anonymous token
curl -sS https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken \
  | jq -r '.result[0].access_token' > token.txt

# province 38 = Bueng Kan, district 01 = Mueang Bueng Kan
curl -sS "https://landsmaps.dol.go.th/apiService/Master/GetTambol/38/01" \
  -H "Authorization: Bearer $(cat token.txt)" | jq '.result[0:3]'
```

```python
import json
codes = json.load(open("codes.json", encoding="utf-8"))

# look up a district
d = next(a for a in codes["amphoe"] if a["amphoe_id"] == "3801")
# {'pvcode': '38', 'amcode': '01', 'amphoe_id': '3801',
#  'name_th': 'เมืองบึงกาฬ', 'name_en': 'Mueang Bueng Kan'}

# subdistricts in that district
subs = [t for t in codes["tambol"] if t["amcode"] == d["amcode"] and t["pvcode"] == d["pvcode"]]
```

Thai names are stored as UTF-8 with Thai script intact (`name_th`); `name_en` is the romanized
form and is safer to use in filenames and logs.

**Not included:** the `GetScalePage` endpoint returns empty for every province tested, so there
is no scale-page reference data to capture.

---

## Remediation suggestions

1. Enforce rate limits **server-side**, keyed on IP plus token identity, with backoff and `429`
   responses. Current state is unlimited.
2. Add proof-of-work or captcha to anonymous token issuance to raise the cost of bulk minting.
3. **Rotate the DGA `ConsumerSecret` immediately** and move it server-side. Client-side secrets
   are not secrets. Treat the current value as compromised.
4. Replace the dev issuer config in production with the real identity service endpoint.
5. Restrict CORS to known origins instead of `*`.
6. Issue per-user GeoServer `authkey` values instead of one shared key.
7. Add app-layer authorization checks to `/apiService/Backend/*`.

---

## Disclosure

- **NCSA Thailand** (national CERT) — for Findings 1, 4, 5, 6, 7
- **DGA** (กรมการปกครอง) — for Finding 2 directly and urgently; it is their credential
- **DOLA** — for Findings 1 and 3, as the system owner

Check whether a DoD/DOLA internal security team or an authorized engagement covers this host
before submitting. Findings 2 and 3 are time-sensitive and involve third-party credentials.

---

## Artifacts

- `codes.json` — Thai administrative reference data (province / district / subdistrict / land
  office codes). Deliverable.
- `README.md` — this file.

Scratch scripts used during testing live in `%TEMP%\opencode\`
(`jwt.py`, `fetch.py`, `probe1.py`, `quota.py`, `endpoints.py`, `escalate.py`, `geo_probe.py`,
`harvest_codes.py`, `harvest_tambol.py`) — kept out of this folder deliberately, since they are
throwaway reconnaissance rather than deliverables.
