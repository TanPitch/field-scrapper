# Code Audit — field-scrapper

**Last updated:** 2026-10-18
**Branch:** `dev` · **Audit base:** `992ee4d` · **Fixes for this pass:** `7ec4b16`
**Auditor pass:** full-repo end-to-end audit (server, frontend, settings/auth) with live-database verification
**Database snapshot:** `landmap-pg` @ `localhost:5433` — 5,657 parcels · 5,793 lots · 5 provinces

---

## How to use this file

This document is meant to stay alive. When you work on the project later:

1. **Update the `Status` column** on any row you touch: `Fixed` → `Fixed (verified <what>)`, `Open` → `Fixed`. Keep `⚠️ Open` rows that are still open.
2. **Add a new dated entry at the bottom** ("Entry — 2026-07-01") rather than rewriting history. Each entry records what was looked at, what was found, what was fixed, and what was deliberately left alone.
3. **Don't delete the RCA text of a fixed bug.** The next reader needs to know the failure mode so it does not come back. Mark it fixed and move on.
4. **Status legend**
   - ✅ `Fixed` — changed in the repo and verified
   - 🔧 `Fixed (partial)` — root cause narrowed, a deliberate remainder is documented
   - ⚠️ `Open` — real, understood, needs a decision or new work
   - 🚫 `Won't fix` — considered, rejected, with the reason kept

**Baseline verification (must stay green after any change):**

```bash
bun run typecheck            # 0
bun run build                # 0
cd test && bun <each test file>   # run files by name; bare `bun test` does not discover them here
```

> Note: bare `bun test` in `test/` only discovered `priceLadder.agreement.test.js` on this machine
> (Bun 1.3.14). Tests must be invoked by filename. Any DB-backed test needs
> `DATABASE_URL=postgres://postgres:landmap@localhost:5433/landmap` or it skips silently.

---

## Executive summary

The system is architecturally sound — read-only API, one writer (the scrapers), rich text
stored as `jsonb` flags rather than HTML, and a resolver cascade that carries its own
precision. The in-code comments are unusually honest and were treated as the specification
for this audit. That is why nearly every defect found belongs to one class:

> **the code says it does something, and it does not.**

The two severe ones are user-visible:

- **The map plotted 465 parcels in the Gulf of Guinea.** `featureToParcel` never copied
  `tdVerdict`/`dolVerdict` off the API payload, so the gate written specifically to stop
  "an unresolved parcel plotting at lat/lng 0" never fired.
- **The admin "fix a coordinate by hand" endpoint never worked.** `PATCH
  /api/admin/coord-gaps/:id` defaulted `geo_status` to `"manual"`, a value the
  `parcels_geo_status` CHECK constraint rejects. Every request died on `23514` → HTTP 500.

A third pattern repeats in the settings layer: **fields the client sends are silently dropped
on write and never restored on read** (`nameStyle`/`noteStyle`, column
`visible`/`pinned`/`width`), so a personalised layout survives locally and quietly reverts
after signing in from another machine.

Nothing found was an injection or authentication bypass. Rich-text colours are
pattern-validated on both sides, popup HTML escapes caller data, and the session cookie is
`httpOnly` + `SameSite=Lax` — which is what stops the wildcard CORS from becoming a CSRF hole.

| Area | Health |
|---|---|
| Data pipeline (scrape → resolve → publish) | Good, but the final visibility gate was inert |
| API surface | Sound; one 100 %-broken admin route, one wrong aggregate |
| Auth / session | Solid; one timing side channel |
| Settings & annotation sync | Partially wired — silent loss on both sinks |
| Error handling | Weakest layer: no pool error listener, no JSON error handler |

---

## Vulnerability & bug audit table

| # | Component | Issue | Severity | Status |
|---|---|---|---|---|
| 1 | `server/index.js` → `PATCH /api/admin/coord-gaps/:id` | Defaults `geo_status = "manual"`, rejected by the `parcels_geo_status` CHECK → **every** manual coordinate correction returns 500 | **Critical** | ✅ Fixed (verified over HTTP) |
| 2 | `src/data/liveData.ts` + `src/lib/api.ts` | `tdVerdict`/`dolVerdict` never mapped → verdict & zero-coordinate gate never runs → 465 coordinate-less parcels drawn at lat/lng 0 | **Critical** | ✅ Fixed (regression test added) |
| 3 | `server/index.js` → `GET /api/provinces` | `count(DISTINCT p.id)` counts the *provinces* row (always 1) → every province advertised exactly one parcel | High | ✅ Fixed (≈3308 vs 1 for province 40) |
| 4 | `server/index.js` → `pg.Pool` | No `pool.on("error")` listener → an idle client dying emits an unhandled `error` event and terminates the API process | High | ✅ Fixed |
| 5 | `server/index.js` → `PATCH /api/admin/coord-gaps/:id` | `td_lat ?? dol_lat` collapsed two independent sources into one pair → writing DOL coords overwrote TD coords | High | ✅ Fixed (verified over HTTP) |
| 6 | `server/index.js` → `GET /api/parcels` | `dol_lat`/`dol_lon` never in the SELECT list → the documented DOL fallback could never resolve a marker | Medium (latent: 0 DOL-resolved rows today) | ✅ Fixed |
| 7 | `server/users.js` → `PUT /me/layers`, `PUT /me/tables` | `normStyle` whitelist drops `nameStyle`/`noteStyle` → per-field styling lost on reload | Medium | ✅ Fixed (both sinks) |
| 8 | `src/hooks/useSettingsSync.ts` | Column `visible`/`pinned`/`order` sent as constants, `width` never sent → server layout columns can only hold defaults | Medium | 🔧 Fixed (write side; read-back open — see #14) |
| 9 | `server/users.js` `COLOR` vs `src/lib/richText.ts` `COLOR` | `rgb()/rgba()` accepted by the client, rejected by the server → the colour silently reverts | Medium | ✅ Fixed (server aligned) |
| 10 | `server/users.js` → `POST /auth/login` | No hash verify on the "no such user" path → response time is a username oracle (the comment claims otherwise) | Medium | ✅ Fixed |
| 11 | `server/index.js` | No JSON error middleware → HTML + stack trace (dev) for any DB failure | Medium | ✅ Fixed |
| 12 | `src/lib/api.ts` → `request()` | `...init` spread *after* `headers` discarded the merged `Content-Type` for any caller passing headers | Medium | ✅ Fixed |
| 13 | `server/index.js` → `GET /api/parcels` | No `LIMIT`/pagination; the whole estate is one response | Medium | ⚠️ Open — recommendation §4.3.1 |
| 14 | `src/hooks/useSettingsSync.ts` | Saved column layout is never *applied* on sign-in; `visible/pinned/width` are `Set`s so they cannot ride the JSON `prefs` channel | Medium | ⚠️ Open — needs a feature, see §4.3.3 |
| 15 | `server/users.js` → `/auth/register` | Open registration unless `AUTH_REQUIRE_INVITE=1`; no rate limit on login | Medium | ⚠️ Open — deliberate, needs a decision §4.3.2 |
| 16 | `server/index.js` → `GET /api/stats` | `count(DISTINCT case_no\|\|case_year)` — nulls dropped, concatenation collides | Low (latent: same value on today's data) | ✅ Fixed |
| 17 | `server/users.js` → `POST /me/password` | Unguarded `rows[0]` → 500 if the account was deleted under a live session | Low | ✅ Fixed |
| 18 | `server/index.js` → `GET /api/health` | Leaked the absolute `IMAGE_ROOT` path to unauthenticated callers (no consumer) | Low | ✅ Fixed |
| 19 | `server/index.js` | 404 handler registered *after* `app.listen()` | Low | ✅ Fixed |
| 20 | `src/hooks/useSettingsSync.ts` | `SYNCED_PREFS` listed `detailRowHidden`/`detailRowOrder` twice | Low | ✅ Fixed |

---

## RCA & solution breakdown

### 3.1 🔴 Manual coordinate correction was 100 % broken (Critical)

**Component:** `server/index.js`, `PATCH /api/admin/coord-gaps/:id`

**Root cause.** The UPDATE bound `geo_status = COALESCE($10, geo_status)` with
`$10 = req.body?.geo_status ?? "manual"`. The schema is:

```
CHECK (geo_status = ANY (ARRAY['unresolved','verified','mismatch']))
```

`"manual"` is not in that enum, so Postgres raised `23514` on **every** request that reached
the UPDATE — including the shape the admin UI actually sends (`{ td_lat, td_lon,
td_status: 'resolved' }`, `CoordGapsPane.tsx:115`, no `geo_status` → the default applied).

**Blast radius.** The entire "fix a coordinate by hand" feature in the data-quality pane.
Because the server answered a generic 500, the only signal was "internal error" — the
constraint name never reached the user. Invisible to `tsc` and to every unit test: only a
real round trip through Postgres exposes it.

**Fix.** Default to an enum member (`"verified"` — a coordinate a human typed *is* verified)
and validate the client's value against the same enum so a bad value is a 400, not a 500.

```js
/** The values the parcels.geo_status CHECK constraint actually allows. */
const GEO_STATUSES = ["unresolved", "verified", "mismatch"];
...
const geoStatus = String(req.body?.geo_status ?? "verified");
if (!GEO_STATUSES.includes(geoStatus))
    return res.status(400).json({ error: `geo_status must be one of ${GEO_STATUSES.join(", ")}` });
```

**Evidence (real HTTP, real DB, throwaway parcel, cleaned up afterwards):**

```
dol-only patch -> 200 {"td_lat":7,"td_lon":98,"dol_lat":7.5,"dol_lon":98.5,...}
td-only patch (the UI's shape) -> 200 {"td_lat":7.1,"td_lon":98.1,"dol_lat":7.5,...}
bad geo_status -> 400 {"error":"geo_status must be one of unresolved, verified, mismatch"}
```

---

### 3.2 🔴 The visibility gate was inert — 465 markers in the Gulf of Guinea (Critical)

**Component:** `src/data/liveData.ts` (`featureToParcel`), `src/lib/api.ts` (`ApiParcelProps`)

**Root cause.** `loadParcels` documents a two-part filter: show only rows whose resolver
verdict is `'match'`, and drop any row with no coordinate "whatever its verdict says". Both
parts read `p.tdVerdict` / `p.dolVerdict` — fields `featureToParcel` never copied from the
API payload. They were therefore `undefined` for every row, so:

```ts
const verdictsKnown = rows.some((p) => p.tdVerdict != null || p.dolVerdict != null); // always false
const visible = verdictsKnown ? shown : rows;                                          // always rows
```

The "fail open for an old API" branch was the *only* branch that ever ran, and
`return { hidden: rows.length - visible.length }` always reported 0 hidden.
`Parcel.tdVerdict` is declared optional, so `tsc` had nothing to complain about.

**Blast radius.** Quantified against the live database:

| verdict | rows | no coordinate |
|---|---|---|
| `match` | 5,171 | 0 |
| `no_result` | 460 | 460 |
| `district_mismatch` | 21 | 0 |
| `no_result` + `pending_quota` | 5 | 5 |

465 parcels have no coordinate, `featureToParcel` writes `lng/lat = 0` for them, and nothing
else in the frontend filters zero. On the map that is 465 stacked markers at (0, 0) off West
Africa; in the table, 21 parcels from the wrong district presented as confirmed.

**Fix.** Map the two fields through, and declare them on the API type so this cannot be
forgotten again:

```ts
/* src/data/liveData.ts — featureToParcel */
tdVerdict: p.tdVerdict ?? null,
dolVerdict: p.dolVerdict ?? null,
```

```ts
/* src/lib/api.ts — ApiParcelProps */
/** Resolver verdicts. liveData.ts gates what reaches the map on these, so a
 *  field the server sends and this type forgets is a gate that never fires. */
tdVerdict?: string | null;
dolVerdict?: string | null;
```

**Regression test added** — `test/liveDataVerdict.test.js` (stub `fetch`, no DB). It pins the
mapping, the `null` default, and the drop:

```
ok  featureToParcel carries the resolver verdicts through
ok  an unsent verdict becomes null, not undefined
ok  loadParcels drops every row that cannot be a marker
```

Reverting the two lines makes it fail (`[1,2,3,4]` published instead of `[1]`), so the test is
not vacuous.

> **⚠️ Behaviour change to confirm in the browser:** restoring the documented gate removes
> ~486 parcels (465 unplaceable + 21 district mismatches + 5 quota-pending) from the map and
> the table. That is what the function comment asks for, but it is a visible reduction in row
> count — confirm it in the browser before calling the change done. `DataSourceBanner` should
> now report a non-zero `hidden` count.

---

### 3.3 🟠 Every province reported one parcel (High)

**Component:** `server/index.js`, `GET /api/provinces`

```sql
count(DISTINCT p.id) AS parcels   -- p is the provinces table, and p.code is the GROUP BY key
```

`p.id` is constant within each group, so `count(DISTINCT p.id)` is **1 by construction**. The
endpoint returned `{"code":40,"parcels":1,"active":2665}` — the province picker advertised one
parcel for a province holding thousands.

**Fix:** count the joined parcels (`a.id`), which is also what the `HAVING` clause already
used. Verified: province 40 → `parcels=3308`, matching
`SELECT count(DISTINCT id) FROM parcels WHERE province_code=40`.

---

### 3.4 🟠 Postgres restart kills the API process (High)

**Component:** `server/index.js`, pool construction

`pg` emits `'error'` **on the pool** when an *idle* client fails (Postgres restart, failover,
dropped socket). Node/Bun treat an `'error'` event with no listener as unhandled → the process
exits. Every pooled connection going away takes the API down and any in-flight request with it.

**Fix (one line, and `pg` documents it as required):**

```js
pool.on("error", (e) => console.error("[pg pool]", e.message));
```

---

### 3.5 🟠 DOL coordinates overwrote TD coordinates (High)

**Component:** `server/index.js`, `PATCH /api/admin/coord-gaps/:id`

```js
const lat = req.body?.td_lat ?? req.body?.dol_lat ?? null;   // one variable for two sources
```

A body containing only `dol_lat: 7.5` set `lat = 7.5`, and `lat` was then bound to
**`td_lat`**. So entering a DOL coordinate silently rewrote a TD coordinate the admin never
touched — and TD is the source the cascade *prefers*, so the wrong figure became the
authoritative one.

**Fix:** four independent variables, each with its own range check, plus a paired-coordinate
guard (half a coordinate is not a fix — it puts a latitude in the row with no longitude and
reads as resolved downstream):

```js
const tdLat = req.body?.td_lat ?? null;   const tdLng = req.body?.td_lon ?? null;
const dolLat = req.body?.dol_lat ?? null; const dolLng = req.body?.dol_lon ?? null;

for (const [v, limit, what] of [[tdLat,90,"latitude"],[dolLat,90,"latitude"],
                               [tdLng,180,"longitude"],[dolLng,180,"longitude"]]) {
    if (v != null && (!Number.isFinite(Number(v)) || Math.abs(Number(v)) > limit))
        return res.status(400).json({ error: `${what} out of range` });
}
if ((tdLat == null) !== (tdLng == null))
    return res.status(400).json({ error: "td_lat and td_lon must be set together" });
if ((dolLat == null) !== (dolLng == null))
    return res.status(400).json({ error: "dol_lat and dol_lon must be set together" });
```

Proven: a DOL-only PATCH leaves `td_lat`/`td_lon` at 7/98; a TD-only PATCH leaves
`dol_lat`/`dol_lon` intact; a half pair → 400.

---

### 3.6 🟠 The DOL fallback in the resolve cascade was dead (Medium, latent)

**Component:** `server/index.js`, `GET /api/parcels`

The resolver reads `const lat = r.lat ?? r.td_lat ?? r.dol_lat;` under a comment promising
"prefer geom, then TD, then DOL". `p.dol_lat`/`p.dol_lon` were **not in the SELECT list**, so
the third step was `undefined` forever and any parcel whose only coordinate came from DOL
would have `geometry: null` and no marker. Latent today (`dol_match = 0`), and it would have
appeared the moment the DOL resolver ran — the hardest kind of bug to attribute. Fixed by
selecting the columns.

---

### 3.7 🟠 Per-field styling dropped on write, twice (Medium)

**Component:** `server/users.js` (`PUT /me/layers/:id`, `PUT /me/tables/:tableKey`),
`src/hooks/useSettingsSync.ts`

The client sends `nameStyle` and `noteStyle` ("Per-field styles ride alongside; the server
keeps them in the same jsonb so one row carries the whole annotation" —
`useSettingsSync.ts:124`). `normStyle` only knows the six flat keys, so both were discarded on
write; `loadLayers`/`loadColumns` never read them back either. A name styled differently from
its note reverted to the shared `style` after every sign-in.

**Fix:** one shared helper on the server (used by both sinks), and the matching lift on read:

```js
function styleWith(body) {
    const style = normStyle(body?.style);
    for (const k of ["nameStyle", "noteStyle"]) {
        const s = normStyle(body?.[k]);
        if (Object.keys(s).length) style[k] = s;
    }
    return style;
}
```

```ts
/* useSettingsSync.ts — loadLayers / loadColumns */
const raw = (l.style ?? {}) as Record<string, unknown>;
setLayer(String(l.id), { name, note, style: normStyle(raw),
                         nameStyle: normStyle(raw.nameStyle), noteStyle: normStyle(raw.noteStyle) });
```

---

### 3.8 🟠 The saved table layout was a lie (Medium)

**Component:** `src/hooks/useSettingsSync.ts`

```ts
visible: true, pinned: false, order: i,   // constants, and width was never sent
```

`GET /api/me/tables/:tableKey` faithfully serves `visible, pinned, sort_order, width`; the
writer could only ever put the defaults there, and `order` came from annotation-insertion order
rather than the user's `colOrder`. The writer now reports the real state from `useApp`:

```ts
const app = useApp.getState();
const at = app.colOrder.indexOf(key as ColKey);
return { key, label, note, style, nameStyle, noteStyle,
         visible: !app.colHidden.has(key as ColKey),
         pinned: app.colPinned.has(key as ColKey),
         width: app.colWidths[key as ColKey] ?? null,
         order: at < 0 ? i : at };
```

Remaining: the read side (finding #14).

---

### 3.9 🟠 Username oracle in login (Medium)

**Component:** `server/users.js`, `POST /auth/login`

The comment promises "a comparable amount of work either way". In fact the miss path skipped
hashing entirely and returned in microseconds while a hit spent ~100 ms in argon2 — a stopwatch
distinguishes a real account from a fake one. Fixed with a boot-time dummy hash so both paths do
the same work:

```js
const DUMMY_HASH = await hashPassword("timing-equaliser-not-a-real-password");
...
const ok = await verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
if (!ok || !u) return res.status(401).json({ error: "wrong username or password" });
```

(One argon2 hash at boot; the response is unchanged, so no client is affected.)

---

### 3.10 🟠 Colour validation drifted between client and server (Medium)

`richText.ts` accepts `^rgba?\(\s*[\d.\s,%]+\)$` and its own test asserts `rgb(1, 2, 3)` is
valid; `server/users.js` did not, so the server silently dropped a colour the client accepted —
the setting appeared to save and reverted on reload. The server regex is now the same
three-alternative pattern. Still injection-safe: the only new shape accepted is a numeric
`rgb()/rgba()` literal, and both sides still put it through a style-attribute sink unchanged.

---

### 3.11 🟠 Error contract broken at the top of the stack (Medium)

Express 5 (correctly) forwards async rejections, but there was no error middleware — so a DB
failure produced Express's default handler: an **HTML** body (which `lib/api.ts` can only render
as "เซิร์ฟเวอร์ผิดพลาด") plus the stack trace whenever `NODE_ENV !== production`. Added a 4-arg
JSON handler that logs the detail server-side and returns `{ error: "internal error" }`.
Verified: the 23514 failure from §3.1 now logs `[api] … constraint: "parcels_geo_status"`
instead of leaking a stack to the client.

---

### 3.12 🟡 Smaller corrections

- **`src/lib/api.ts` header merge** — `...init` was spread *after* `headers`, so any caller
  passing its own headers replaced the merged object and lost `Content-Type: application/json`.
  Latent today (no caller passes headers), fixed by reordering.
- **`/api/stats` case count** — `count(DISTINCT case_no||case_year)` drops rows with a null
  `case_no` (concat → null) and can merge `('1','23')` with `('12','3')`. Now
  `count(DISTINCT (case_no, case_year))`. Same value (4,721) on current data — reported as
  latent, not as a live overcount.
- **`/me/password`** — reading `rows[0].password_hash` unguarded threw a 500 for a session whose
  account had been deleted; now a 401.
- **`/api/health`** — stopped echoing the absolute `IMAGE_ROOT`; no client reads it.
- **404 registration** — moved above `app.listen()`; it only worked because the request loop
  starts later than the next synchronous line.
- **`SYNCED_PREFS`** — duplicate `detailRowHidden`/`detailRowOrder` removed.

---

## 4. Changed code (2026-10-18 pass)

185 insertions / 32 deletions across 5 files, plus one new test.

| File | Change |
|---|---|
| `server/index.js` | pool error listener · `/api/provinces` count · `/api/stats` case count · `dol_lat/dol_lon` selected · coord-gaps PATCH split + `geo_status` enum + pair guard + range validation · health leak · 404/error-handler ordering |
| `server/users.js` | `DUMMY_HASH` + login verify · `styleWith()` for layers *and* columns · `COLOR` regex aligned · `/me/password` guard |
| `src/lib/api.ts` | `tdVerdict`/`dolVerdict` on `ApiParcelProps` · header-merge order |
| `src/data/liveData.ts` | verdicts carried onto `Parcel` (unblocks the visibility gate) |
| `src/hooks/useSettingsSync.ts` | real column layout written · `nameStyle`/`noteStyle` written *and* read back · `ColKey`/`RichTextStyle` imports · duplicate prefs keys |
| `test/liveDataVerdict.test.js` | **new** — the visibility gate, no DB required |

No unchanged line was rewritten. Every corrected hunk is inline in §3.

### 4.1 Verification evidence

```
bun run typecheck   -> 0
bun run build       -> 0  (4.19 MB bundle, pre-existing chunk warning)
bun <each unit test file>  -> all pass
    richText 13 · filterPass · condoUnits · pricing · landKind · landtitle
    groupSale · imageStore · ledClient · tambonResolver · chartWindow
bun test/liveDataVerdict.test.js -> 3 pass (and fails correctly with the fix reverted)
server booted on :8899 against the live DB:
  /api/health 200 · /api/stats 200 · /api/status 200 · /api/provinces 200 (parcels now 3308)
  /api/nope -> 404 {"error":"unknown endpoint"}
  /api/admin/coord-gaps unauthenticated -> 401
  PATCH dol-only -> 200 with td_lat preserved · half pair -> 400 · bad geo_status -> 400
  throwaway test parcel deleted, leftover = 0
```

### 4.2 Not changed, on purpose

- **Rich/popup HTML escaping** — audited, correct (`esc()` on every caller-supplied value;
  `data-tip` percentages inside the quoted attribute).
- **`cors()` wildcard + cookie session** — not exploitable as a CSRF hole because `SameSite=Lax`
  blocks cookies on cross-site POST/PUT/PATCH, and `credentials: 'same-origin'` in `api.ts`.
  Worth narrowing the origin allow-list before any public deployment.
- **`styleToCss` dropping `fg` when `bg` is set** — deliberate and tested; left alone.
- **`condoUnits` cascade / `priceLadder` mirror** — reviewed, consistent with their stated
  invariants and their tests.

### 4.3 Open recommendations (not bugs to fix silently)

1. **`GET /api/parcels` has no `LIMIT`/pagination** (finding #13). One response holds the entire
   estate (the client bundle is already 4.19 MB). A viewport bbox or an `ETag`/cursor is the next
   scalability step; changing it now would change what the map shows, so it needs a decision.
2. **Login rate limiting and `AUTH_REQUIRE_INVITE`** (finding #15) — registration is open unless
   the env var is set. Fine for local dev; needs a decision before this is reachable from
   anywhere else.
3. **Column layout read-back** (finding #14, §3.8) — the remaining half of the layout sync, and
   the reason `visible/pinned/width` are still server-side write-only.

---

## Entry log

### 2026-10-18 — full-repo audit, first pass

- Audited `server/`, `src/`, and both settings sinks against the live database.
- Found 20 issues (2 Critical, 3 High, 7 Medium, 5 Low) + 3 open recommendations.
- Fixed 19; left 3 open by decision (13, 14, 15).
- Added `test/liveDataVerdict.test.js`.
- Changes were committed as `7ec4b16` on `dev` (not yet verified in the browser).
- **Still open before this pass can be called closed:** confirm §3.2 in the browser — the
  map/table row count drops by ~486 now that the visibility gate works.
