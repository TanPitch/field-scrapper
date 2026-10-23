# Field Scrapper

A land-auction map and data table for Thai enforcement (บังคับคดี) parcels.

This repository holds three things that were once separate: the **React app**, a
**scraper** that collects real auction data from Thai government sites, and a
**PostgreSQL/PostGIS database** plus read API that serves it back.

```
   LED (กรมบังคับคดี)   กรมธนารักย์   AWS Terrain Tiles
          │                  │              │
          └──────── scrapers (test/) ───────┘
                          │
                    PostgreSQL + PostGIS
                          │
                    Express API (server/)
                          │
                  React app (src/)
```

MapLibre GL renders the parcels and overlays; a resizable bottom table lists the
same rows with auction, legal and price-history detail.

Uses [Bun](https://bun.sh) as the package manager and script runner.

---

## Quick start

```bash
# 1. database
docker run -d --name landmap-pg -p 5433:5432 -e POSTGRES_PASSWORD=landmap \
  -e POSTGRES_DB=landmap postgis/postgis:16-3.4

# 2. schema
$env:DATABASE_URL="postgres://postgres:landmap@localhost:5433/landmap"
Get-Content db/migrations/001_core.sql -Raw | docker exec -i landmap-pg psql -U postgres -d landmap
# ... 002 through 009, in order

# 3. app
bun install
bun run dev          # http://localhost:5173

# 4. API, in a second terminal
$env:DATABASE_URL="postgres://postgres:landmap@localhost:5433/landmap"
bun server/index.js  # http://localhost:8787
```

| command | what it does |
|---|---|
| `bun run dev` | Vite dev server on :5173 |
| `bun run build` | typecheck + production build into `dist/` |
| `bun run typecheck` | `tsc -b --noEmit` |
| `bun test` | test runner, 47 tests across 11 files |
| `cd test; bun runs.js reap` | mark scraper runs abandoned by a crash as failed |

---

## Layout

```
┌────────────────────────────────────────────────────────────────────┐
│                header (search, settings, panels)                   │
├──────────┬───────────────────────────────────────┬─────────────────┤
│          │                                       │                 │
│   rail   │                   map                 │   right panel   │
│          │                                       │                 │
│          ├───────────────────────────────────────┴─────────────────┤
│          │               bottom table                              │
└──────────┴─────────────────────────────────────────────────────────┘
```

The right panel is contextual: search results, overlays, drawings, saved filter
areas, or land detail for the selected parcel.

## Data: live, with an honest fallback

The app fetches real parcels from `/api/parcels` and renders what the scrapers
collected. If the API cannot be reached it falls back to seeded fixtures — and
says so, with a banner above the table.

That banner is deliberate. Without it, a user looking for Khon Kaen land who
found none would reasonably conclude the scraper was broken, or worse, believe
2,660 invented parcels were real. The dataset on screen is always named.

An **empty but successful** response is not treated as a failure and does not
trigger the fallback: if the database genuinely holds nothing, the table should
say "no data", not substitute fiction.

Requests go to same-origin `/api`, which Vite proxies to the API process in
development — one origin, no CORS, and the session cookie just works.

---

## Data: where each field comes from

Three government sources, deliberately kept apart. They answer different
questions, and averaging them would be wrong.

| source | supplies | note |
|---|---|---|
| **LED** กรมบังคับคดี | case number, parties, deed/น.ส.3ก., size, the asking-price cascade, sale rounds, photographs | the only source of the auction itself |
| **กรมธนารักย์** | exact per-parcel assessment ฿/ตร.วา, ระวาง, survey number, parcel coordinate | undocumented service; the app's best valuation; coordinates come via the empirical datum in `crs_calibration` (see `docs/KNOWLEDGE.md`) |
| **กรมที่ดิน** | verification of the parcel's identity and point | anonymous API is 20 lookups/day (local ledger CHECK enforces it); the web UI is unlimited and is how the user places the parcels TD cannot — most เมืองขอนแก่น city points came from the user reading the site by hand, recorded with `test/recordDolPoint.js` |
| **AWS Terrain Tiles** | height above sea level, ~9.2 m/px | stored with its source and a stated uncertainty |

Every field records its source and observation date in `field_provenance`, so two
sources covering the same field never silently overwrite one another.

### Precision is stated, not implied

A parcel can hold a กรมธนารักย์ point, or only a subdistrict centroid. The second
exists so an ungeocoded lot is not invisible on the map — but a centroid's
position and height are a *different place*, so `geo_precision` says which, and
the UI will not present a centroid's elevation as the parcel's.

The same honesty applies to กรมธนารักย์ having no figure. Two different reasons,
shown differently:

- **skipped** — the layer cannot serve this title at all (น.ส.3ก. is not on the
  โฉนด layer). A known blind spot, not missing data.
- **unresolved** — it was queried and nothing matched. A real gap someone might
  still close by hand.

### Price

LED publishes a starting price and a ladder of reductions. The rule, in
`test/pricing.js`:

```
discount = min(noBidRoundsBefore × 10%, 30%)
price    = startPrice × (1 − discount/100)
```

Only LED status code 3 (งดขายไม่มีผู้สู้ราคา) deepens the discount, and a no-bid
round is itself held at the *undiscounted* price, so the count increments after
that round's price is computed.

The app shows the **next round's** price as the headline, with the starting price
struck through beside it. Showing the start price as the headline reads as "this
is the price" and overstates every lot that has already come down.

`test/pricing.js` is the authority for that rule because it is what wrote the
numbers in the database. `src/lib/price.ts` mirrors it for the UI, and
`test/priceLadder.agreement.test.js` runs both over all 240 real rounds and fails
on the first disagreement.

---

## Scraping

```bash
cd test
$env:DATABASE_URL="postgres://postgres:landmap@localhost:5433/landmap"

bun scrapeLED.js            # crawl LED listings
bun ingest.js out/rows.json # write to Postgres
bun tdEnrich.js             # add กรมธนารักย์ assessment + coordinates
bun elevation.js            # add height from AWS Terrain Tiles
bun verification.js         # print an LED → TD comparison table
```

`test/` holds the scrapers plus the whole coordinate pipeline, their tests, and
`NOTES.md` as an index of what is still here. Files added since the first cut:

| file | role |
|---|---|
| `scrapeByProvince.js` | per-province LED backfill (Bot 1) |
| `resolveTdParcels.js` | Bot 2's TD leg — UTM from TD, datum-corrected, `DOL_DAILY_LIMIT=0` |
| `tdCadastre.js` | กรมที่ดิน cadastre layers (MapServer 0/1) used during identity resolution |
| `tdCrs.js` | loads `crs_calibration` and re-reads UTM with the measured datum; `--apply` recomputes |
| `sampleCoords.js` / `sampleOffsets.js` | the national datum measurement pair (42 lands, 14 provinces) |
| `recordDolPoint.js` | writes a point read by hand off the กรมที่ดิน web, gated on LED size agreement |
| `resolveNs3k.js` | น.ส.3ก. parcels — only TD's NS3K layer can place them |
| `repairPlaced.js` / `verifyPlaced.js` | admin helpers for placed-point gaps and re-verification |

| file | role |
|---|---|
| `scrapeLED.js` | LED parser and crawler |
| `ledClient.js` | session-aware HTTP client: retries, backoff, jitter, explicit throttling |
| `ingest.js` | idempotent write to Postgres |
| `pricing.js` | the price cascade and lot lifecycle — **the authority** |
| `tdLookup.js` / `tdEnrich.js` | กรมธนารักย์ client and enrichment |
| `elevation.js` | AWS Terrain Tiles sampling |
| `loadBoundaries.js` | subdistrict geometry for the coordinate fallback |
| `tambonResolver.js` | LED ตำบล name → Treasury scope |
| `provenance.js` | per-field source recorder |
| `coordQueue.js` / `resolveCoords.js` / `dolLookup.js` | กรมที่ดิน quota queue (verification path) |
| `imageStore.js` | polite image downloader |
| `runs.js` | records every pass so the status page can show it |
| `scheduler.js` | ICT province schedule |
| `groundTruth.js` | hand-checked rows used to validate the scrapers |

### Politeness

All scrapers share one session per host, pace themselves, and reuse cookies.
`LED_IMG_DELAY_MS` (default 1200) throttles image downloads. These sites are
public but small; the defaults are deliberately slow.

### Bot activity

Every pass opens a row in `scrape_runs` and closes it when done. A row with
`finished_at IS NULL` means "running right now", which is what `/api/status`
serves. If a process is killed outright, `bun runs.js reap` closes the row so the
UI does not claim the scraper is busy forever.

---

## API

Read-only. The scrapers own every write.

| endpoint | returns |
|---|---|
| `GET /api/health` | liveness, parcel count, the image root in use |
| `GET /api/status` | running passes, stuck detection, enrichment backlog, recent history |
| `GET /api/provinces` | coverage per province |
| `GET /api/stats` | parcel / lot / round counts |
| `GET /api/parcels?province=40` | GeoJSON for the map |
| `GET /api/parcels/:id` | one parcel, all lots, rounds, images, provenance |
| `GET /img/land/:file` | stored photograph |

Auth (`/api/auth/*`, `/api/me/*`) uses argon2id passwords and Postgres-backed
sessions. `SESSION_SECRET` is required in production.

Environment:

| variable | default | meaning |
|---|---|---|
| `DATABASE_URL` | — | required |
| `PORT` | `8787` | API port |
| `IMAGE_ROOT` | `test/data/img` | where `lot_images.local_path` resolves from |
| `SESSION_SECRET` | dev fallback | required when `NODE_ENV=production` |
| `AUTH_REQUIRE_INVITE` | unset | `1` closes registration |

---

## Database

Migrations in `db/migrations/`, applied in order. Each is re-runnable — they use
`IF NOT EXISTS` and drop constraints before re-adding them.

| migration | adds |
|---|---|
| `001_core.sql` | provinces, districts, parcels, auction lots, rounds, lot_images |
| `002_valuation_reference.sql` | `eva_land_sheet`, `eva_area_grade` from Treasury open data |
| `003_area_valuation.sql` | area-level assessment columns on parcels |
| `004_provenance.sql` | data_sources, field_provenance and its views |
| `005_coordinate_queue.sql` | กรมที่ดิน quota ledger and queue |
| `006_subdistrict_boundaries.sql` | subdistrict geometry, `geo_precision` |
| `007_td_enrichment.sql` | กรมธนารักย์ assessment, coordinates, status |
| `008_bot_activity.sql` | run stage, progress, outcome |
| `009_users_and_settings.sql` | users, prefs, table layout, named layers, `inactive` status, elevation |
| `010_crs_calibration.sql` | the empirical datum correction for กรมธนารักย์ coordinates, as data |
| `011_parcel_annotations.sql` | allows `parcel` as a named-annotation kind, for the table's name/note columns |

Reference data loaded: 4,858,811 กรมธนารักย์ price rows (2,074,090 distinct
parcels), 31,990 area grades, and 199 Khon Kaen subdistrict boundaries.

---

## Features

- **Map** — parcel dots coloured by status (distinct colours for
  นำกลับมาขายใหม่ and หมดอายุประกาศ), CCTV / water-level / transport pins, flood
  raster + WMS layers, basemap switcher, area filters, and draw/measure tools.
- **Table** — sortable and reorderable columns, per-column resize, pin-to-left,
  column picker, filter dialog, row pinning. Every column can be **renamed and
  annotated** with bold/italic/underline, colours and a leading badge.
- **Land detail** — full auction record, price-history chart with a draggable
  date-range slider, the sale-round schedule (only dated rounds), height above
  sea level, and the exact กรมธนารักย์ assessment.
- **Filters** — land type (กำลังขาย / ขายแล้ว / นำกลับมาขายใหม่ / หมดอายุประกาศ),
  price and size bounds, plus multi-select for จังหวัด, ตำบล, อำเภอ and ประเภททรัพย์.
- **Search** — bbox-scoped Google Geocoding → Places Text Search → Nominatim,
  plus offline matching. Needs a Google key.
- **Annotations** — drawings and display areas each take a name, a note and the
  same rich text as table columns.
- **Settings** — seven themes plus a custom accent, per-status colours, per-kind
  popup fields, marker size, panel layout, and a server pane showing scraper
  activity.

---

## Accounts and settings

Sign-in goes through `POST /api/auth/login`. What the server says is what
happens — if it rejects a password the app does **not** quietly fall back to the
built-in accounts, because that is exactly what makes "I couldn't sign in on my
other device" undiagnosable.

Two failures are treated as different things:

- **server unreachable** → fall back to the local accounts, with a note that
  settings will not sync. Offline use is legitimate.
- **server rejected the password** → say so and stop.

Once signed in, `useSettingsSync` pulls the user's preferences, table layout and
named annotations from Postgres and writes changes back. Writes are debounced
and serialised per key, so dragging a colour picker produces one PUT carrying the
colour you stopped on rather than a dozen racing.

Offline is a normal state: if a write fails it is dropped and the local store
keeps working. An app that stops letting you rearrange your table because a
server restarted would be worse than one whose settings do not sync yet.

---

## Structure

```
server/
  index.js                  Express 5 read API + /img/land static mount
  users.js                  auth, prefs, table layout, named layers
src/
  main.tsx / App.tsx        app grid (header · rail · map · right panel · table)
  index.css                 Tailwind layers, theme variables, popup CSS
  types/index.ts            shared interfaces
  data/
    constants.ts            labels, defaults, column defs, basemaps
    mockData.ts             seeded parcels (the app still reads these, not the API)
    thaiGeo.ts              province/district/subdistrict lookups
  lib/
    api.ts                    the only place the frontend talks to the server
    price.ts                  the price ladder (mirrors test/pricing.js)
    priceHtml.ts              popup price markup
    richText.ts               the one annotation styling shape — flags, never HTML
    visibility.ts             the filter pipeline and sort comparators
  store/
    useApp.ts                 UI state
    useAnnotations.ts         user-authored labels and notes
  hooks/
    useParcels.tsx            visibility pipeline + live data loading
    useSettingsSync.ts        settings in and out of Postgres
    useMapEvents.ts, useMapSync.ts, useMoney.ts, …
  map/                      imperative MapLibre code (not React)
  components/
    panel/                  RightPanel, Detail/Pin/Draw/Area/Results/Overlay views
    table/                  BottomPanel, DataTable, ColumnPicker, FilterPopup,
                            DataSourceBanner
    ui/                     Switch, Seg, Select, ColorButton, Tip, RichText, …
db/migrations/              ordered, re-runnable SQL
test/                       scrapers, enrichment, and their tests
```

---

## Docs

| file | what it is |
|---|---|
| `docs/KNOWLEDGE.md` | domain facts measured against the live sites (codes, quotas, datum) |
| `docs/RELEASE_NOTES.md` | change history |
| `docs/BOT-PLAN.md` | the two-bot ledger process and its real run log |
| `ROADMAP.md` | current status measured from the DB, and what is next |
| `test/NOTES.md` | condensed operational notes for the scraper suite |
| `AGENTS.md` | working conventions for this repo |

---

## Notes

- Colours in `tailwind.config.js` point at CSS variables, so theme switching works
  without a rebuild. Because of that, opacity modifiers such as `bg-accent/20` do
  **not** work — use `bg-accent-dim` or an arbitrary value.
- All UI text renders in Noto Sans Thai.
- MapLibre popups are HTML strings, so their styles (`.pop-*`) are real CSS in
  `src/index.css`.
- Tooltips come from tippy.js via one delegated instance bound to `document.body`.
  Attach one with `useTipProps('…')` or `useClipTip('…')`. Both are hook-free, so
  they are safe inside `.map()`.
- `src/data/mockData.ts` now exports `FALLBACK_PARCELS`. Import `ALL_PARCELS` and
  `PARCEL_BY_ID` from `src/data/liveData.ts`, which is the live collection.
- The splash hero (`public/splash-hero.jpg`) is an Unsplash photograph whose
  licence requires the credit line on the splash. Keep it if you replace the
  image.

