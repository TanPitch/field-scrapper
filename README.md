# Field Scrapper

A land-auction map + data table for Thai enforcement (บังคับคดี) parcels. MapLibre
gl renders the parcels and overlays; a resizable bottom table lists the same rows
with auction, legal and price-history detail.

Originally a single-file `field scraper 2.0.1.html`, refactored into a modular
Vite + React + TypeScript + Tailwind project.

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build
```

## Layout

```
┌──────────────────────── header (search, settings, panels) ─────────┐
├── rail ──┬────────────── map ──────────────┬── right panel ──┤
│          └──────── bottom table ───────────┴─────────────────┘
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
- **Settings** — status colours and popup fields per pin kind, price formatting,
  chart axis markers, marker size, panel layout, and map tile protocols.

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
  lib/                        geo, color, format, landSize, parcelColor, visibility
  store/
    useApp.ts                 zustand store (single source of UI state) + toast()
    useSearch.ts, useLightbox.ts
    actions.ts                select/deselect, basemap, overlays, column actions, resetAll
  hooks/
    useParcels.tsx            memoised "which rows are visible" (the filter pipeline)
    useMapEvents.ts           MapLibre events → store/engines
    useMapSync.ts             store → map layers (one-way sync)
    useMoney.ts, useOutsideClose.ts, usePlacement.ts
  map/                        imperative MapLibre code (not React)
    style.ts, layers.ts, protocols.ts (flood + WMS tiles), popups.ts,
    drawEngine.ts (draw/edit/measure), pins.tsx (CCTV/sensor/transport), mapRef.ts
  components/
    header/ (Header, SearchBox, settings/panes)
    rail/Rail.tsx
    map/ (MapView, DrawBar, FloodProbe, Toasts)
    panel/ (RightPanel, Results/Overlay/Draw/Area/Detail/Pin views, Lightbox)
    table/ (BottomPanel, DataTable, ColumnPicker, FilterPopup)
    charts/ (PriceChart, RangeSlider, SensorChart)
    ui/ (Switch, Seg, Stepper, Select, ColorButton, DateButton, Tip, styles)
RELEASE_NOTES.md              changelog
```

## Notes

- Colours in `tailwind.config.js` point at CSS variables, so the graphite/OLED
  theme switch works without rebuilding. Because of that, opacity modifiers such
  as `bg-accent/20` do **not** work — use `bg-accent-dim` or an arbitrary value.
- All UI text renders in Noto Sans Thai.
- MapLibre popups are HTML strings, so their styles (`.pop-*`, popup chrome)
  stay as real CSS in `src/index.css`.
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