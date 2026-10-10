# Field Scrapper

A land-auction map + data table for Thai enforcement (บังคับคดี) parcels. MapLibre
gl renders the parcels and overlays; a resizable bottom table lists the same rows
with auction, legal and price-history detail.

Originally a single-file `field scraper 2.0.1.html`, refactored into a modular
Vite + React + TypeScript + Tailwind project.

Uses [Bun](https://bun.sh) as the package manager and script runner.

```bash
bun install
bun run dev        # http://localhost:5173
bun run typecheck
bun run build
bun run preview    # serve the production build
```

`bun.lock` is the lockfile. If you are coming from npm, `bun install` migrates an
existing `package-lock.json` automatically; once `bun.lock` exists, delete
`package-lock.json` so there is a single source of truth.

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

## Features

- **Map** — parcel dots coloured by status (with a distinct colour for
  นำกลับมาขายใหม่), CCTV / water-level / transport pins, flood raster + WMS
  layers, basemap switcher, area filters, and freehand draw/measure tools.
- **Table** — sortable and reorderable columns, per-column resize, pin-to-left,
  column picker with sticky actions, filter dialog, and row pinning. Dragging a
  header shows a ghost column and an opaque drop slot; neighbours slide aside to
  preview the result.
- **Land detail** — full auction record (court, parties, case number,
  collateral, the four price estimates), a price-history chart with a draggable
  date-range slider, the 1–8 sale-round schedule, and an event log.
- **Filters** — status, price bounds, size bounds (single ตร.วา/ตร.ม. or the
  3-box ไร่/งาน/ตร.วา form), plus multi-select chips for จังหวัด, ตำบล, อำเภอ and
  ประเภททรัพย์.
- **Search** — bbox-scoped online lookup through Google Geocoding → Google Places
  Text Search → Nominatim (the first that answers wins), plus offline matching
  over parcels, CCTV, water sensors and transport pins. Results land in the
  right panel and as map markers.
- **Account** — splash/sign-in screen with remember-me, password reveal, 6-box
  2FA, admin/user roles and an admin-gated settings tab. Mockup accounts:
  `admin / admin1234` (2FA required), `fieldscrapper / user1234`.
- **Settings** — seven themes plus a custom primary colour, status colours and
  popup fields per pin kind, price formatting, chart axis markers, marker size,
  panel layout, mockup user-management and server-task pages, and map tile
  protocols.

## Structure

```
index.html                    fonts + #root (body[data-theme] drives the theme)
tailwind.config.js            theme colours → CSS variables, fonts, keyframes
src/
  main.tsx / App.tsx          app grid (header · rail · map · right panel · table)
  index.css                   Tailwind layers, theme variables, MapLibre/popup CSS
  types/index.ts              shared interfaces (Parcel, SellRound, DrawShape, …)
  data/
    constants.ts              labels, defaults, column defs, basemaps, POIs
    mockData.ts               seeded mock parcels (swap for an API client)
    thaiGeo.ts                province/district/subdistrict lookups
    geo/*.json                Thai administrative-area source data
    searchOptions.ts          seller agencies, property types, cascading dropdowns
  lib/                        geo, color, format, landSize, parcelColor, price,
                              onlineSearch (Google→Nominatim), changelog
  store/
    useApp.ts                 zustand store (single source of UI state) + toast()
    useSearch.ts, useLightbox.ts
    actions.ts                select/deselect, basemap, overlays, column actions, resetAll
  hooks/
    useParcels.tsx            memoised "which rows are visible" (the filter pipeline)
    useMapEvents.ts           MapLibre events → store/engines
    useMapSync.ts             store → map layers (one-way sync)
    useMoney.ts, useOutsideClose.ts, usePlacement.ts, useConfirm.tsx
  map/                        imperative MapLibre code (not React)
    style.ts, layers.ts, protocols.ts (flood + WMS tiles), popups.ts,
    drawEngine.ts (draw/edit/measure), pins.tsx (CCTV/sensor/transport/search),
    parcelLabels.ts, mapRef.ts
  components/
    auth/Splash.tsx           sign-in screen
    header/ (Header, SearchBox, settings/panes + Server/User/UserManage panes)
    rail/Rail.tsx
    map/ (MapView, DrawBar, FloodProbe, Toasts)
    panel/ (RightPanel, Results/Overlay/Draw/Area/Detail/Pin views, Lightbox)
    table/ (BottomPanel, DataTable, ColumnPicker, FilterPopup)
    charts/ (PriceChart, RangeSlider, SensorChart)
    ui/ (Switch, Seg, Stepper, Select, ColorButton, DateButton, Tip, Confirm,
         AvatarPicker, LandKindIcon, styles)
RELEASE_NOTES.md              changelog (rendered in-app under เกี่ยวกับ)
```

## Notes

- Colours in `tailwind.config.js` point at CSS variables, so the graphite/OLED
  theme switch works without rebuilding. Because of that, opacity modifiers such
  as `bg-accent/20` do **not** work — use `bg-accent-dim` or an arbitrary value.
- All UI text renders in Noto Sans Thai.
- MapLibre popups are HTML strings, so their styles (`.pop-*`, popup chrome)
  stay as real CSS in `src/index.css`. The parcel popup has two layouts —
  `.pop-box` and `.pop-box--compact` — chosen automatically by `countRows()` in
  `src/map/popups.ts`.
- Tooltips are provided by [tippy.js](https://atomiks.github.io/tippyjs/) via one
  delegated instance bound to `document.body` in `src/components/ui/Tip.tsx`.
  Attach one with `useTipProps('…')` (always shown) or `useClipTip('…')` (only when
  the text is actually truncated). Both are hook-free, so they are safe inside
  `.map()`. Theme overrides for the `fs` tippy theme live in `src/index.css`.
- `useOutsideClose(refs, onClose, enabled, toleratePortals)` — pass
  `toleratePortals` only when the surface legitimately hosts portalled popups of
  its own (the settings panel, the filter dialog). Enabling it elsewhere makes
  dropdowns impossible to dismiss.
- Mock parcels live in `src/data/mockData.ts`; the CCTV/sensor seeds are in
  `src/map/pins.tsx#seedPins`.
- Thai place data: drop the real `provinces.json` / `districts.json` /
  `subDistricts.json` exports into `src/data/geo/` with the same field names and
  the cascading dropdowns and mock generation pick them up unchanged.
- `SETTINGS_SECRET` in `src/data/constants.ts` gates the hidden ค้นหา & API tab.
  It is a local convenience gate, not security — it ships in the bundle. Admins
  bypass it via `role === 'admin'`.
- The splash, the user-management pane and the server pane are **mockups**:
  credentials are hard-coded in `src/components/auth/Splash.tsx` and account data
  lives in local state. Nothing is sent anywhere.
- `public/` holds static assets served at the base path. `splash-hero.jpg` is a
  photograph from [Unsplash](https://unsplash.com/photos/eyeglasses-on-map-qoAIlAmLJBU)
  by [oxana v](https://unsplash.com/@arttravelling); their licence requires the
  credit line shown on the splash, so keep it if the image is replaced.