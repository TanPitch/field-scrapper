# Release Notes

All notable changes to Field Scrapper. Dates are ISO.

## Unreleased

### 2026-11-03 — reviewed-error verdict on ข้อมูลตกหล่น, clearing search really clears

- **ข้อมูลตกหล่น rows can be judged, not only fixed.** Each row ends with two
  buttons: [edit] opens a small popup panel (gap head, resolver's note, LED's
  district reading, deed, case, size, plus lat/lng inputs and save/cancel —
  the inline row editor is gone), and [error] marks the parcel as **erroneous
  data** (`parcels.reviewed_error`, migration `030_parcel_error_review.sql`).
  A marked row disappears from the map and the bottom table immediately — the
  features payload now selects and excludes `reviewed_error` — stays out of
  the pane's work list, and lives behind a new `[error] {n}` filter chip that
  lists reviewed-error rows alone (chip unselected = normal work list).
  Pressing [un-error] on such a row un-marks it; the PATCH treats the boolean
  as a real state (`CASE WHEN $12::bool IS NULL … ELSE $12::bool END`), so
  false is an un-mark, never "not sent".
- **Rows highlight on hover** (and keep a faint error tint while marked).
- **The clear (✕) button in the title search now clears every surface.** The
  old empty-text path patched the dropdown state only: the store's online
  result list stayed as it was, the next render rebuilt its rows from it and
  the internet-hit marker dots stayed on the map. Clearing now aborts the
  in-flight fetch, empties the online list, resets the nationwide-scope flag
  and the right-panel selection, and calls `plotSearch([])` — dropdown, right
  panel and markers all go empty together.
- Fullscreen ข้อมูลตกหล่น: the sticky toolbar row sat at `top-8`, leaving a
  visible gap above it where the list scrolled by. It is `top-0` now, with
  right padding so the fullscreen close button never sits on the controls.

### 2026-11-02 — provenance grouping, the led_label promotion, packed search rows

Root-cause pass over two reported round-table bugs plus the search box, and a
database backfill the panel had been waiting on.

- **Round grouping now walks the row's own source, not a date guess.** The
  ingest gives every lists-schedule row a slot number (`idx`) and leaves
  report-history rows with idx null. Partitioning on that null/non-null split
  is exact; the 2026-11-01 announce-crossing heuristic mislabeled
  ผบE.3247/2567 (lot 221345) because its publish point (19/06) sits two months
  before the live listing's first นัด (19/08), so the previous order's tail —
  the 01/07/2569 row — slid into the live order and printed 1-7. The grouping
  reads `rounds[].idx` now: report rows letter A1-A6, B1-B6 (chunked by the
  same 60-day/<14-day split rules), the live listing always runs plain 1..N.
  Lots with no idx anywhere (older ingests) keep the old announce rule as the
  fallback. Pinned on 221345's real row shape in `test/ladderBoundary.test.js`
  (now 12 tests).
- **The report's outcome promotes into an unsettled round.** ledReport.js
  deliberately writes the LED report's verdict only into `led_label`
  (rewriting status_label is how ผบ.2255/2562's labels crossed between two
  orders). But until the lists ingest catches up, the row still says
  ยังไม่มีการเปิดประมูล/รอประกาศ — a placeholder. That placeholder is an
  absence, not a status: when the report already names an outcome, liveData's
  `mapRounds` promotes it (code 1 for ขายได้, code 3 for ไม่มีผู้สู้ราคา, own
  code otherwise undecidable → null). ผบE.389/2569's round 1/6 now reads
  งดขายไม่มีผู้สู้ราคา in the table, and the ladder prices the next round at
  −10% — no case-id special cases, any future lot ingested the same way gets
  the same treatment.
- **Search rows carry the case and the money.** Title-bar dropdown and the
  ผลการค้นหา panel both show, per land row: case number (ผบ../ปี), ตำบล
  อำเภอ จังหวัด, size (ไร่-งาน-วา), and the open price LED starts the bidding
  at — not just the static price cell. The clear (✕) button also cancels a
  still-pending keystroke search, so wiping the text can no longer fire a
  search for the deleted phrase behind the empty box, and keystroke searches
  wait 400 ms.
- **ระดับความสูง จาก ระดับน้ำทะเล backfiled onto the parcels.** The column was
  empty for every row — `test/elevation.js` gates on
  `geo_precision = 'parcel'`, a label only 231 rows carry, while 5,164 more
  rows have real TD-resolved point geometry with the label null. The gate now
  reads the point itself (`geom IS NOT NULL`), and the AWS Terrarium z14 run
  (~9.2 m/px) filled every parcel the map can actually place. Parcels with no
  coordinate at all stay NULL — those honestly have no height claim to make.
- UI tweaks shipped with the batch (user's own edits): the next-round discount
  badge is a red pill whose tip reads รอบถัดไปลด N%, map label hover tips name
  the property type, the chart's point tooltip drops the date line, popup-kind
  ordering in settings puts ยกเลิก/หมดอายุ before นำกลับมาขายใหม่, and the
  round-table cell's parser pins LED's canonical heads for the hover tip.

### 2026-11-01 — search beyond the view, detail-panel rules, the announce boundary

The 12-item batch plus a root-cause pass over six reported bugs. One idea runs
through most of it: **the current listing's announcement is the boundary.**
Everything dated at/after `p.announce` is the live sale; everything before it is
LED's printed history and no longer drives prices, labels or the chart.

- **Title search now finds land outside the view.** Searching a case number
  (e.g. `ผบE.4642/2568`) first looks inside the visible map area; when matches
  exist there, they are shown as today, and when they do not, a
  **"ค้นในทุกพื้นที่ (N แปลง)"** button appears under the box. Pressing it
  re-runs the match nationwide, the group headers note the scope
  (· พื้นที่ที่เห็น / · ทุกพื้นที่), and hidden match counts are stated. A fresh
  search resets the wide flag. `SearchBox.tsx` matches on `caseNo` too, so a
  case number no longer has to read like a title.
- **Detail-panel rules.**
  - ขนาดห้อง and ขนาดที่ดิน are one setting: the row's built-in label changes
    with the lot (ห้องชุด shows ขนาดห้อง) and the hide/order switch aliases
    both to the canonical ขนาดที่ดิน (`lib/detailRows.ts`).
  - The rounds' status cell keeps LED's canonical phrase (งดขาย, งดขายไม่มีผู้สู้ราคา,
    งดขาย (ป.วิ.อ.แพ่ง มาตรา 309), โจทก์แถลงงดขาย, ถอนการยึด, ขายได้, …) and the
    qualifier the cell has no room for rides the hover tip. The ผลรายงาน line is
    canonical-parsed too and only shows when the phrase or the qualifier
    actually differs from the cell above it.
  - A silent group-sale row speaks through its sibling: hovering an empty/'-'
    status cell on a ขายรวม lot lists the sibling deeds' outcome for the same
    นัด date (LED prints the verdict on some siblings' tables only — ผบ.754/2562
    put งดขายไม่มีผู้สู้ราคา on 24653's rows and left 161371's blank).
- **The discount ladder is per-listing.** Rounds dated before the announcement
  never deepen the discount and keep the ledger's own price; ผบ.754/2562's four
  pre-relist ไม่มีผู้สู้ราคา rows no longer price the live round 2 at −30%.
  Group-sale siblings share the event: `nextRoundPrice` merges the
  ไม่มีผู้สู้ราคา rounds of `groupOf()` siblings inside the same listing window
  (161371 shows −10% with no own verdict row). Non-group lots cost nothing — the
  sibling scan is gated on the group signal. Group helpers moved from
  `store/actions.ts` into map-free `lib/group.ts`. Pinned in
  `test/ladderBoundary.test.js` (9 assertions: boundary, cap, sibling share,
  relist labels).
- **กลุ่มการขาย labels handle adjacent relists.** A new order starts at a >60d
  gap, at a **<14d gap** (LED's in-listing spacing is ~21 days, so a
  near-adjacent pair is a relist landing right behind the last นัด —
  ผบE.3247/2567 lot 221345: last A round 10/03, first B round 13/03), and at
  the announce crossing; inside the current listing nothing splits, even when
  a งดขาย suspension exceeds 60 days. Same-day rows stay in one order.
- **Graph word tags moved out of the plot.** Event pills (งดขาย, นำกลับมาขาย,
  ขายออก…) draw in a reserved band *below* the x-axis labels — 3 rows × 16px
  under `layout.padding.bottom = 60` — with the same 1px-overlap greedy stack
  and edge-arrow pinning. The วันนี้ pill stays inside the plot; dashed date
  lines stay inside the plot. The full wording is still on the price tooltip
  (`PriceChart.tsx`, beforeBody, line 277; interaction defaults live in
  `chartSetup.ts`, lines 12-13, mode `nearest`,
  `intersect: false`).
- **ซ่อนรอบก่อนหน้า now owns the chart.** With the toggle on, history points
  dated before the announcement drop from the line (the announce point
  survives, so the window never empties) and the event pills ride the same
  filter. `plotOf()` gained the hidePrev argument and `applyChartRange` shares
  it, so the y-axis cannot drift from what is drawn.
- **Table: sold lots show no next นัด.** นัดถัดไป (นัดที่ / วันที่ / สถานะ) all
  print `-` when the lot is sold — a sold lot has nothing to buy into.
- **Settings: คลิกพื้นที่ว่างเพื่อยกเลิกเลือก.** A switch in the settings popup
  (หมุดบนแผนที่ section, on by default). Off = a stray click on empty map space
  keeps the selection (rings + panel); panel ✕ and popup close still deselect.
  Synced like the other prefs.
- **RCA fixes (six reported cases, each re-verified after the fix against the
  live dataset through the edited modules):**
  - *Wrong announce date by one day* — `isoDate` sliced UTC, so a publish
    stamped 2026-07-22T17:00Z (23 ก.ค. Bangkok) rendered 22 ก.ค.
    (ผบE.4642/2568). Dates are now formatted in Asia/Bangkok.
  - *Sold lot shown as กำลังขาย* (ผบE.375/2568 lot 294549) — the report sheet
    (028) can carry the winning bid while the close fields still say active.
    The features builder now forces `sold` when the round carrying
    `sold_price` is the listing's LAST dated round; `mapStatus.js` stays the
    pure close-fields rule, so a resell lot's older sale row never freezes a
    live listing.
  - *Stale winning-bid echo in the chart* (ผบE.2141/2567 lot 312583) — LED's
    report stamps the final outcome on every remaining นัด row; the round the
    chart breaks at carried an earlier read (850,000) where the report said
    790,000. `featureToParcel` re-inks every code-1 round *of the current
    listing* with the lot-level soldPrice before the history is built;
    pre-announce rows keep their own order's price.
  - *Pool double-end crash* — Docker's stop sequence sends SIGINT+SIGTERM and
    the second `pool.end()` died as an unhandled rejection; the shutdown is
    now idempotent.
- **Verification:** `tsc` clean, build clean, `bun test` 149 tests / 27 files —
  all pass except the two environmental DB-timeout failures
  (`coordQueue.integration`, network-class). The frontend↔backend ladder
  agreement is 0 mismatches over 58,358 priced rounds; the agreement test's
  stored-price leg still reports pre-existing DB-vs-rule drift on 4 lots
  (9722, 10055 rounding, 10380, 11085/11086 — the จปฐ-vs-committee floor),
  which predates this batch.
- **Browser-visible (confirm on screen):** the ค้นในทุกพื้นที่ flow, the
  autoDeselect switch, ขนาดห้อง hide, price-table and status tips, sibling
  hover, chart bottom tags + padding, hidePrev chart filter, sold `-` cells,
  and the A/B grouping labels on lot 221345.

## Unreleased (previously)

### 2026-10-23 — accounts for real, group-sale rings, price-graph rules

- **Account function works: every setting now follows the user between
  machines.** The synced-preferences list grew from 24 keys to ~50 — base map,
  overlay toggles, flood config, pin layers + their opacities, table column
  (width/order/pinned/hidden), search limit, server-log limit, layout mode,
  2FA/avatar choices, pinned rows. Table-column layout is stored as
  one full row per column (PUT /api/me/tables/lots), and the restore side
  applies visible/pinned/order/width back over local state — server rows win,
  columns the server has not recorded keep local state. Row pins (`pinnedIds`)
  serialise Set⇄array so they sync too.
- **Khon Kaen images: root cause fixed in the data, not the code.** 1,331 KK
  lots had zero cover images because ingest attaches images only to genuinely
  new lots. 2,655 `lot_images` rows were backfilled offline from the LED cache
  (`img-backfill.mjs`, deed-number validated); ~1,978 KK lots and 8 multi-deed
  rows remain and need a future LED listing pass (scrapeLED's
  `landpicture`/`mapjot`/`map` fields).
- **The user manager is real.** `GET/POST/PATCH/DELETE /api/users` +
  `POST /api/users/:id/password`, admin-only, with last-seen (from the session
  store) and each user's own avatar pref joined into the list. Accounts can be
  suspended (`disabled` col, migration 027) and that refuses login after the
  password check — the 403 is unreachable without the correct password, so it
  is not a username oracle. The UI cannot disable/demote/delete yourself and
  the server cannot leave zero active admins; deletion cleans sessions and
  cascades prefs/tables/annotations. All 19 smoke assertions in
  `smoke-users.mjs` pass over real HTTP.
- **ผู้ใช้ pane is functional:** the display name now has an อัปเดต button that
  PUTs to /api/me (disabled until the text differs), and เปลี่ยนรหัสผ่าน /
  ยืนยันตัวตน 2 ขั้นตอน each open their own popup panel (new reusable
  `ui/Modal.tsx`, `data-portal`-tagged and capture-phase ESC so it never
  closes the settings drawer around it). No more mockups in either user pane —
  the "คืนค่ารายชื่อเริ่มต้น" button is gone.
- **Group sales ring their siblings.** Clicking a parcel whose LED remark
  carries "ขายรวม / N แปลง" auto-selects every parcel of the same
  province+case+year+ลำดับการขาย (server now ships `groupCount`), the halo
  filter switches to a `match` over the sibling ids, and the detail panel
  grows a "ขายรวมกลุ่ม N แปลง" chip listing the sibling deeds + LED's own
  remark.
- **Price graph follows the puzzle rules.** Plot = every past round + exactly
  ONE point for the next scheduled round, styled dashed/translucent on the
  forecast leg (5/8 → 6 points; 8/8 → 8; sold out at 3/6 → 3). The
  today-line-in-the-past bug is gone because the range applier and the
  constructor now share one `plotOf()` window instead of two divergent
  computations. New setting รอบถัดไปแบบทึบ draws the forecast in full ink.
- **Settings cleanups:** ปลดล็อคเมนูขั้นสูง + its secret are deleted (the
  search tab was never actually gated by it), server-pane log lines are
  date-stamped `yyyy/mm/dd hh:mm` with a no-wrap headline over a wrapped
  detail, the list is scrollable on its own and capped at a configurable
  count, and the coord-gaps pane keeps its search row pinned while it
  scrolls, never wraps the ขนาด column, and only shows the resolver's
  `geo_note` in fullscreen. พิกาด → พิกัด everywhere.

### 2026-10-23 — datum for the whole country, เมืองขอนแก่น nearly complete

- **The กรมธนารักย์ datum is now measured nationally, not per province.** 42
  lands across 14 provinces (เชียงราย → ยะลา) were sampled by
  `test/sampleCoords.js`; the user read all 42 real points off กรมที่ดิน's site,
  every one agreeing with LED on size/tambon/amphur. One shift per SRID holds:
  24047 = (−50.6 m, +180.5 m) from 29 lands / 11 provinces, 24048 = (−55.4 m,
  +181.3 m) from 11 lands / 5 provinces; per-province spread ≤ 4.2 m. Both
  `crs_calibration` rows were refit and all 5,079 TD-placed markers recomputed
  (`bun tdCrs.js --apply`) — marker error vs กรมที่ดิน dropped from a median of
  8.8 / 6.6 m to **2.4 / 1.6 m**. The old "24048 is Khon Kaen-only" restriction
  is retired.
- **Two parcels disagree with TD by more than 25 m — and it is not a reading
  error.** The user re-read 15188 (จันทบุรี, 74.1 m) and 9866 (ยะลา, 58.6 m) and
  got the same coordinates to eight decimals both times. Genuine
  agency-geometry disagreement; they were held out of the datum fit, and per the
  project rule กรมที่ดิน wins whenever those parcels are ever ingested.
- **เมืองขอนแก่น (อำเภอเมือง): 1,086 / 1,136 parcels placed (95.6%).** The user
  read กรมที่ดิน's web UI by hand (no scripted quota involved) and
  `test/recordDolPoint.js` recorded 8 more lands this day, each gated on LED
  size agreement. 50 remain, 3 of which are น.ส.3ก. known to be absent from both
  TD and DOL's โฉนด layers and parked with a note.
- **Matched parcels: 5,349 / 5,698 (93.9%)** carry a coordinate from TD or DOL.
- **Provider-of-truth clarified in README:** กรมที่ดิน is no longer "removed
  from the pipeline" — its API stays quota-bound at 20/day (local ledger enforces
  the CHECK) while hand reads on its web UI are unlimited and do the parcels the
  scripts cannot reach. `recordDolPoint.js` refuses a hand point whose size
  disagrees with LED, so a wrong-land read cannot enter the database.
- **Admin: the error-lands page can go full screen.** The coordinate-gaps pane
  in Settings gains a เต็มจอ toggle — the table expands over the whole viewport
  (portalled to `<body>` so the settings drawer's animation cannot trap it, ESC
  or the ✕ button closes) so checking the last problem parcels no longer happens
  in a scroll box. RELEASE_NOTES' in-app import also now follows the docs/ move.
- **เมืองขอนแก่น nearly complete: 1,132 / 1,138 (99.5%) placed.** The remaining
  45 queue lands were recorded by hand, every one again gated on LED size.
  101391 is stored at LED's size with a note saying DOL shows 0-3-50.5 — the
  user verified the coordinate against the LED land photo. 58113 and 95938 stay
  unplaced with geo_note warnings (size conflicts that cannot be verified); 4265
  and 4266 remain NS3K. Matched parcels now 5,395 / 5,698 (94.7%).

### The first release with real data

This is the release where the app stops being a mockup over invented data and
starts serving real scraped parcels. It is deliberately grouped by what it
changes, because the version diff is large.

### Backend — new

- **Express 5 read API** in `server/index.js`, backed by PostgreSQL/PostGIS.
  Read-only by design: the scrapers own every write, so there is exactly one
  writer and the API cannot mutate data the scraper is midway through updating.
  - `GET /api/health` — liveness plus the image root actually in use.
  - `GET /api/status` — what the scraper is doing right now (see *Bot activity*).
  - `GET /api/provinces` — coverage per province, for the picker.
  - `GET /api/stats` — parcels, lots, rounds, priced and geocoded counts.
  - `GET /api/parcels?province=40` — GeoJSON FeatureCollection for the map.
  - `GET /api/parcels/:id` — one parcel with every lot, round, image and
    provenance row.
  - `GET /img/land/:file` — stored auction photographs.
- **Users and per-user settings** (`server/users.js`, migration `009`). Identity
  and every personalisation move out of `localStorage` into Postgres, so settings
  follow the account instead of the browser. Argon2id passwords via Bun's native
  implementation (no native module to build), sessions in Postgres via
  `express-session` + `connect-pg-simple`, so a sign-in survives an API restart.
  - `POST /api/auth/register` · `/login` · `/logout`
  - `GET|PUT /api/me`, `POST /api/me/password`
  - `GET|PUT /api/me/prefs` — theme, map style, units and other scalars.
  - `GET|PUT /api/me/tables/:tableKey` — column show/order/size/pinned plus the
    user's own label and note per column.
  - `GET|PUT|DELETE /api/me/layers/:layerId` — named and annotated drawings and
    display areas.
  - Registration is open in development; set `AUTH_REQUIRE_INVITE=1` to close it.
    `SESSION_SECRET` is required when `NODE_ENV=production`.
- **Rich text is stored as jsonb, never HTML.** A note is free text a user typed
  and it is read back in another user's browser, so the style is a fixed set of
  flags and colours (`{b,i,u,bg,fg,badge}`) validated on the way in
  (`normStyle`) and turned into CSS only at render time. Non-colour values are
  dropped rather than escaped.

### Bot activity — new

- **`scrape_runs` now records every pass** (`test/runs.js`). A row with
  `finished_at IS NULL` is the definition of "running now"; the API serves it on
  `/api/status` and the settings pane shows it. Stages: `scrape`, `enrich_td`,
  `enrich_coord`, `images`, `reference`, `other`.
- `bun runs.js reap` marks runs abandoned by a hard kill as failed, so a crashed
  pass cannot leave the UI claiming the bot is busy forever.
- A `run_key` makes a repeatable job idempotent: re-running restarts its own row
  instead of stacking up a row per attempt or failing on the unique index.

### Data — new

- **กรมธนารักย์ per-parcel enrichment.** 24 of 30 Khon Kaen lots carry an exact
  assessment in บาท/ตร.วา plus ระวาง, survey number, land number and a parcel
  coordinate. The service is undocumented, so the client is sequential, paced and
  session-reusing.
- **Elevation from AWS Terrain Tiles** (`test/elevation.js`), z=14 (~9.2 m/px).
  24 parcels sampled, 157–228 m, each stored with its source and a ±9.2 m
  uncertainty so the number is not read as a survey. Only parcels with a genuine
  parcel-level coordinate are sampled — a subdistrict centroid's height is a
  different place, and those stay `NULL`.
- **Auction photographs**: 56 files, 12.1 MB, covering all 30 lots. Paths in
  `lot_images.local_path`, served from `/img/land/`. Some lots genuinely have no
  map image because LED does not publish one.
- **Field provenance**: every field records its source and observation date, so
  overlapping sources never silently overwrite one another.

### Land detail panel

- **Price is now the next round's price, not the opening price.** The number you
  would actually pay leads; the starting price is a struck-through, dimmed aside
  and the discount badge sits beside it. Previously the headline was the opening
  price, which reads as "this is the price" and overstates every lot that has
  already come down.
- **Sale rounds show only the rounds LED has dated.** Undated rounds are not
  scheduled yet, so they are dropped rather than printed — which also removes the
  "รอประกาศ" placeholder word. Row count is now the number of published dates, so
  lots come back with 4, 6 or 8 rounds instead of always 8.
- **Lots with no image get a real empty state** — a dashed frame saying so —
  instead of a broken image or an empty frame that reads as a bug.
- New rows: **height above sea level** with its uncertainty on hover, the exact
  **กรมธนารักย์ assessment** with ระวาง, and a map-precision note when the
  coordinate is a subdistrict centroid rather than the parcel.
- When กรมธนารักย์ has no figure, the row says *which kind of no*: "ไม่มีในชั้นข้อมูลนี้"
  (the layer cannot serve this title) versus "ยังไม่พบข้อมูล" (queried, nothing
  matched). These are different problems and were being presented identically.

### Map popups

- Full popups use the same price treatment as the detail panel.
- Compact popups show the next-round price with its discount percentage. A 0%
  discount renders nothing rather than "-0%".
- Both derive from one shared rule (`src/lib/price.ts`); the popup markup is in
  `src/lib/priceHtml.ts` because MapLibre takes an HTML string, not React.

### Table

- New **height** column, sortable, hidden by default. Missing values are shown
  distinctly: "—" for no DEM coverage, "ไม่ทราบ" when the parcel only has
  subdistrict precision. Sorting puts unknown values last in both directions — an
  unknown height is not the lowest parcel.
- **Every column can be renamed and annotated.** The pencil in the header opens a
  name/note editor with bold, italic, underline, background and text colours, and
  a leading badge. The user's label replaces the built-in one; the note rides as a
  tooltip so headers do not double in height.

### Annotations

- **Drawings and display areas** take a name, a note and the same rich-text
  styling, via the Tag button in each row. Click-away commits rather than
  discards, so a typed note is never lost by clicking the map.
- Annotations live in their own store (`useAnnotations`) because they are content
  the user made, not app settings. The wire shape already matches the API.

### New status — หมดอายุประกาศ

- A lot that ran every round without a buyer and has since been pulled from the
  agency's listing is now `inactive` rather than `sold`. It is history, not
  inventory: still filterable and on the map, in a muted colour, but it never
  shows a "next round" price because there is no round left to buy into.
- The land-type filter now offers all four kinds — กำลังขาย / ขายแล้ว /
  นำกลับมาขายใหม่ / หมดอายุประกาศ — and filters on the marker kind. Previously it
  filtered on the raw status, which meant the "นำกลับมาขายใหม่" option could never
  match, since that is a display distinction on top of a `sale` lot rather than a
  status of its own.
- `inactive` is visible by default. Silently dropping rows the user may be
  looking for is worse than showing them and letting the filter narrow.

### Fixes

- **Land markers could not be hovered or clicked.** `liveData.publish()`
  reassigned the parcel array but mutated the lookup Map, so the synchronous
  readers — the popup builder, the click handler, the detail panel — could hold
  the previous array while the Map held the new rows. Markers rendered, but a
  click looked up a parcel that was not there and `select()` returned early.
  Both are now mutated in place, so no reader can observe a half-updated
  collection. `select()` also toasts instead of failing silently, which is what
  made this so hard to see.
- **The ชื่อกำกับ / หมายเหตุกำกับ cells could not be edited.** The editor popover
  was positioned with `getBoundingClientRect` (viewport coordinates) but rendered
  `absolute` inside the scrolling table, so it opened thousands of pixels
  off-screen. It is now `fixed`, matching the coordinate space, and each cell
  carries an explicit pencil rather than making the whole cell a hit target.
- **Label boxes had spikes at all four corners.** The plate was drawn with
  `globalAlpha`, leaving the rounded corners semi-transparent, and the 9-slice
  (`icon-text-fit: 'both'`) stretched those soft pixels outward. The plate is now
  filled opaque and the translucency comes from `icon-opacity`, so there is
  nothing soft left to smear.
- The จังหวัด column showed `จ.40`. The API now returns the real province name.
- The frontend price ladder disagreed with the backend's on withdrawn lots: it
  only treated `sold` as having no next round, so 74 inactive parcels advertised a
  phantom next-round price.
- A `-0%` discount badge was reachable; it is now suppressed rather than hidden
  with CSS.
- Sorting by height produced `NaN` comparisons for parcels without an elevation.
- `scrape_runs` had no writer at all — runs were never recorded.

### Columns and labels

- `ราคาเปิด (Smart)` → **`ราคาเปิด`**.
- `นัดล่าสุด` → **`นัดก่อนล่าสุด`**, grouped as นัดที่ / วันที่ / สถานะ.
- `ชื่อแปลง` is **hidden by default** — the user's own `ชื่อกำกับ` column is
  the one they actually use. Still available in the column picker.
- Columns whose content is data rather than prose — วันที่ประกาศ, วันประกาศขาย,
  วันที่ล่าสุด, the ไร่/งาน/ตร.วา split and the นัดก่อนล่าสุด group — are now
  **centre-aligned**. Left-aligned digits read as ragged prose, and a
  three-part unit row should line up under its headers.
- Annotation cells show **nothing** when empty rather than a dash, and open on an
  explicit pencil.

### Annotation icons

- The badge strip is now **one button that opens a panel** with the full set —
  shapes first, then emoji — plus an explicit "clear". The old 12-glyph strip
  crowded out the colour rows, and clearing by re-clicking the selected glyph was
  not discoverable.
- Only glyphs that render identically everywhere are offered: no variation
  selectors, no ZWJ sequences, no flag emoji (which render as two letters on
  Windows).

### Toolchain

- `test/` cut from 79 scripts to 32: 53 one-off probes and superseded scripts
  were deleted, along with stale analysis dumps and a `graphify-out/` tool
  directory. Reference samples (`rows.json`, `khonkaen-sample.html`) were kept.
- Added tests: `richText.test.js` (13, including CSS-injection attempts),
  `settings.db.test.js` (16), and `priceLadder.agreement.test.js`.
- The price agreement test runs the frontend ladder and the backend's
  `priceRounds` over all 240 real rounds and fails on the first disagreement, so
  the two implementations of one business rule cannot drift apart unnoticed.
- `pg`, `express`, `cors`, `express-session`, `connect-pg-simple` and `pngjs` are
  now declared dependencies rather than installed ad hoc.

### Live data

- **The app now renders real scraped parcels.** `src/data/liveData.ts` fetches
  `/api/parcels` and maps it onto the app's `Parcel` shape, so the map, the table
  and the detail panel are driven by what the scrapers actually collected. This
  is what makes it possible to test that the frontend and backend agree.
- **A banner names the dataset on screen.** If the API is unreachable the app
  falls back to seeded fixtures and says so, with a retry button. Without it, a
  user looking for Khon Kaen land who found none would reasonably conclude the
  scraper was broken — or worse, believe 2,660 invented parcels were real.
- An **empty but successful** response does not trigger the fallback. If the
  database genuinely holds nothing the table says so.
- `/api/parcels` now aggregates a lot's rounds, prices, parties, image count and
  elevation into one response, so the map, table and rounds column no longer need
  a request per row.
- The server distinguishes `closed` from `inactive` and records why a lot closed,
  so the status mapping uses that reason rather than guessing: a seizure revoked
  or a cancelled remainder is **not** a sale, and labelling it "ขายแล้ว" would be
  a lie.
- Vite proxies `/api` and `/img` to the API in development — one origin, no CORS,
  and the session cookie works without `SameSite` juggling.

### Accounts and settings

- **Sign-in goes through the API.** What the server says is what happens: if it
  rejects a password the app does *not* fall back to the built-in accounts.
  Silently accepting a credential the server refused is what makes "I couldn't
  sign in on my other device" undiagnosable.
- Two failures are treated as different things — **server unreachable** falls back
  to the local accounts and notes that settings will not sync; **server rejected
  the password** stops.
- **`useSettingsSync`** pulls preferences, table layout and named annotations from
  Postgres on sign-in and writes changes back, so settings follow the account
  rather than the browser. Writes are debounced and serialised per key, so
  dragging a colour picker produces one PUT carrying the colour you stopped on.
- Offline is a normal state: a failed write is dropped and the local store keeps
  working.

### Server pane

- The **Server** pane under General settings now reads `/api/status` instead of
  rendering static sample rows. It shows the API connection, what the scraper is
  doing right now, each running pass with its current step and elapsed time, the
  กรมธนารักย์ enrichment backlog, and recent history.
- A pass open far longer than any scrape could take is flagged **stuck** — a
  killed process leaves its row open, and reporting that as "running" forever
  would be worse than saying something went wrong.
- The fake server ping at the bottom of the left rail is **gone**. It was a
  random number between 16 and 68 ms, so it looked like a measurement and told
  the user nothing. That information belongs in the server pane, where it is now.

### Table

- New **ชื่อกำกับ** and **หมายเหตุกำกับ** columns: the user's own name and note
  per parcel, editable by clicking the cell, with the same rich text as everything
  else. Blank means "not written yet", which is deliberately different from the
  official name in the `name` column — these never borrow it.
- New **ราคาเปิด (Smart)** column: the LED cascade's opening price, distinct from
  the headline price, which is the next round's.
- New **minimum / maximum sea-level** filters. Setting either bound excludes
  parcels with no elevation, and the dialog says so — "unknown height" cannot
  satisfy "at least 150 m", and letting those rows through would make the filtered
  count a lie.
- Sorting by height or smart price puts unknown values last in *both* directions.

### Detail panel and popups

- **The "change since last sold" percentage is gone** from the detail panel and
  from both popup kinds. The user asked for the discount against the opening price
  only, and carrying two different percentages in one popup made it ambiguous
  which was which. The -10/-20/-30% ladder is the one number that means anything.
- The rounds table prints an **empty cell** where LED says "รอประกาศ" rather than
  the word. Every published round is listed, including unscheduled ones — the full
  schedule is the information, and an empty date already says what the placeholder
  word said.
- When a lot has **sold**, the round it sold at and every round after it are
  highlighted in red: those rounds are dead, and a plain list of dates does not
  make that obvious. Toggleable in settings (on by default).

### Annotations

- **Name and note are styled independently.** A single shared style made it
  impossible to emphasise a word inside a note without bolding the whole thing.
- Both a toolbar of toggles (bold / italic / underline, background and text
  colours) and a **badge/icon picker** apply per field.
- Drawing and area rows collapse their three actions — tag, edit, delete — into a
  single `[⋯]` button. The row was already carrying a switch, colour swatch,
  shape icon, name and metrics; three more icons read as noise, and the pencil in
  particular looked like the primary action when it was one of three equals.

### Toolchain

- Migration `010_crs_calibration.sql` stores the กรมธนารักย์ datum correction as
  **data** — offset, basis, sample size and residual — rather than inside a
  scraper, and `test/tdCrs.js` applies it on every write. Previously the dev
  database had been corrected by a one-off script, so a re-run would have written
  uncorrected coordinates and silently undone the earlier ones.
- `test/NOTES.md` rewritten from 66 KB to 11 KB — 79 headings with numbering gaps
  became 9 sections, keeping the expensive-to-rediscover facts and dropping the
  research narrative.

### Known gaps

- Only Khon Kaen is loaded — 30 lots from 1 province. A national backfill has not
  been run.
- Annotations for drawings and display areas are not yet rendered as map labels,
  only in the panel list.
- The CRS calibration is measured on 14 Khon Kaen points. National validity is
  unproven and another province needs its own measurement.
- 2FA is still enforced only in the client.


## 2.2.0 - 2026-10-10

Splash/login, a real Google search backend, the search-result panel, and a
settings overhaul (themes, mockup account & server pages).

### Search
- **Google online search is real.** The mocked `POIS` stage is gone, replaced by
  two live stages in `src/lib/onlineSearch.ts`: **Geocoding API** (`bounds` = the
  current map bbox, `region=th`) for addresses, then **Places Text Search (New)**
  (`locationBias.circle` around the view centre) for businesses. Nominatim stays
  the final fallback when both throw or find nothing in the bbox;
  `ZERO_RESULTS` counts as "try the next stage", not an error. Needs a key with
  both APIs enabled in the Cloud Console.
- New **ผลการค้นหา** in the right panel, grouped into sticky sections - แปลงที่ดิน /
  จุดกล้อง / สถานีวัดน้ำ / ขนส่งสาธารณะ-รถ / สถานที่ - each with a count.
  The title-bar dropdown is kept, so both surfaces show the same ranked hits.
- Search markers are drawn for **internet results only**, at the bottom of the
  render stack. Land parcels, cctv, water and bus keep their own markers - they
  were previously being duplicated underneath a second one.
- Internet markers take a glyph from their **place type** (`poiIcon` →
  rasterised onto a black disc as `fs-poi-<iconName>`), and the panel rows show
  the same small icon.
- Selecting a result branches by kind: an **internet** hit gets a persistent green
  ring and a pan/zoom; a **local** hit rings its own marker and replaces the
  results list with that marker's panel. Selecting no longer wipes the other
  markers - the ✕ clear button does.
- Results are a **snapshot of the bbox at search time**; panning no longer
  re-queries or reshuffles the list underneath the user.
- New `onlineSearch.ts` test file covering stage ordering, `ZERO_RESULTS` handling
  and the bbox snapshot.

### Account
- New splash sign-in with remember-me, password reveal, and 6-box 2FA. Roles are
  `admin` / `fieldscrapper`; admins see a **จัดการผู้ใช้** settings tab that
  users do not.
- Mock credentials `admin / admin1234` (2FA required) and
  `fieldscrapper / user1234`. Passwords are compared in the client against these
  constants; nothing is sent anywhere.

### Settings
- **Server tab** (`server` pane) - mockup pass/fail/status rows with inline
  progress bars and edit buttons.
- **Global Settings** - two-column grid with section headers and group labels.
- **Search panel** - region pills, online-search toggle, ordering dropdown
  (Nominatim-first / Google-first) and a budget input, all persisted.
- **Theme picker** - graphite, OLED, slate, sand, forest, rose, mono; the
  accent is a custom colour input, not a fixed value.
- **Status colours** are now editable per status, and the **parcel popup** has a
  per-field configuration for each pin kind.
- **Marker size** control (small / normal / large) scaling pins and their plates.
- **Map style** now switches between OpenStreetMap and satellite tiles.
- **Tile protocols** - XYZ / TMS / WMTS options in the map settings pane.

### Map
- Search result markers now render at the bottom of the render stack.
- `popups.ts` simplified: hover popups no longer duplicate the click popup's
  `setLngLat` chain.

### Toolchain
- Added `test/onlineSearch.test.js`, and `mockData.ts` seeded so results are
  stable across reloads.

## 2.1.0 - 2026-10-08

Auction data model, land detail panel, table columns, filters and tooltips.

### Auction data model
- `SellRound` gained `date` and `status`; rounds are no longer a fixed count.
- `PriceEvent` replaced ad-hoc event colours, so the price chart and the event
  log agree.
- `DataSource` distinguishes the four Thai enforcement agencies.

### Land detail panel
- Price history chart with a draggable date-range slider.
- Event log below the price, so a resale or a price cut is visible without
  opening the chart.
- Mortgage amount and bank surfaced as a detail row.

### Table
- Column reorder with a ghost column preview, per-column resize, pin-to-left,
  and a column picker with sticky action columns.
- Row pinning survives filter changes and viewport moves.

### Filters
- ตร.วา / ตร.ม. single-box and the 3-box ไร่/งาน/ตร.วา form.
- Multi-select chips for จังหวัด, ตำบล, อำเภอ and ประเภททรัพย์, cascading so
  impossible combinations are hidden.

### Tooltips
- One delegated tippy instance on `document.body` via `useTipProps` /
  `useClipTip`, replacing per-element instances.

### Map popups
- Two layouts, `.pop-box` and `.pop-box--compact`, chosen by `countRows()`.

## 2.0.1

Initial modular Vite + React + TypeScript + Tailwind build, refactored from the
single-file `field scraper 2.0.1.html`.
