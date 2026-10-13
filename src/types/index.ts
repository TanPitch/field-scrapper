import type { RichTextStyle } from '../lib/richText';

export type LngLat = [number, number];
export type BBox = [number, number, number, number]; /* west, south, east, north */

/**
 * Auction status of a parcel.
 *
 *   sale     — currently on the block
 *   sold     — sold
 *   inactive — ran every round without a buyer and has since been pulled from
 *              the agency's listing. It is history, not inventory: still worth
 *              showing and filterable, but it must not read as available, and
 *              it is excluded from live views.
 */
export type Status = 'sale' | 'sold' | 'inactive';
/**
 * Marker kind — resale parcels get "นำกลับมาขายใหม่" until they sell again, which
 * is a display distinction layered on top of `Status`, not a separate status.
 */
export type PopupKind = Status | 're';

export interface HistPoint { d: number; v: number }
export interface PriceEvent { idx: number; label: string; color: string; ink: string }

/**
 * One scheduled round. `date` is null until LED announces it — an undated round
 * is "not yet scheduled", not "scheduled with no date shown", and the UI omits
 * those entirely rather than printing a blank row.
 *
 * `statusCode` is LED's raw code. It is optional so existing fixtures keep
 * working, but the price ladder cannot be computed without it: only code 3
 * (งดขายไม่มีผู้สู้ราคา) deepens the discount. See lib/price.ts.
 */
export interface SellRound {
  date: number | null;
  status: string;
  statusCode?: number | null;
  /** Round price from the backend; authoritative when present. */
  price?: number | null;
  /** Discount in force for this round, in percent. */
  discountPct?: number | null;
}

export interface Mortgage { amount: number; bank: string }

/** Agency that published the auction. */
export type DataSource = 'กรมบังคับคดี' | 'ธนาคาร' | 'กรมการคลัง' | 'กองทุนสินครและสงคราม';
/** What sits on the parcel. */
export type LandKind = 'empty' | 'building';

export interface Parcel {
  id: number;
  status: Status;
  wah: number;
  price: number;
  perWah: number;
  lng: number;
  lat: number;
  name: string;
  deed: string;
  province: string;
  amp: string;
  tambon: string;
  announce: number;
  soldTs: number | null;
  hist: HistPoint[];
  events: PriceEvent[];
  resell: boolean;
  /** How many images this lot has. */
  imgs: number;
  /**
   * Stored image paths, served by the API at /img/land/<name>.
   *
   * Undefined means the dataset has not supplied paths (the seeded fixtures do
   * not have any); an empty array means the lot genuinely has none. The
   * carousel treats those differently, so one is not silently rendered as the
   * other.
   */
  images?: string[];
  lastTs: number;
  saleByText: string;
  /** Which agency published the auction. */
  dataSource: DataSource;
  /** What is on the land — drives the small badge icon. */
  landKind: LandKind;
  ownerFile: string;
  propertyType: string;
  deedNo: string;
  court: string;
  caseNo: string;
  plaintiff: string;
  defendant: string;
  possessor: string;
  enforcementOffice: string;
  collateral: number;
  spouseCollateral: number | null;
  expertPrice: number | null;
  enforcementOfficerPrice: number | null;
  assessorPrice: number | null;
  committeePrice: number | null;
  rounds: SellRound[];
  mortgage: Mortgage | null;

  /* ---------- provenance-aware enrichment ----------
     Populated from the backend. Every one of these is optional because the
     frontend also runs against fixtures that predate the enrichment, and a
     missing value must render as "unknown", never as a fabricated zero. */
  geoPrecision?: GeoPrecision | null;
  /** กรมธนารักย์ exact assessment for this parcel. */
  td?: TdAssessment | null;
  /** Height above sea level. Null for subdistrict-only parcels: a centroid's
      height says nothing about the land being auctioned. */
  elevation?: Elevation | null;
}

export interface Region {
  province: string;
  center: LngLat;
  spread: number;
  pricePerWah: [number, number];
  count: number;
  amphoes: string[];
}

/* ---------- drawing ---------- */
export type DrawTool = 'poly' | 'line' | 'circle';
export type DrawMode = 'draw' | 'area' | null;
export type DrawDistMode = 'both' | 'seg' | 'round' | 'off';

/**
 * User-authored label + note for anything on the map or in the table the user
 * can point at. `style` is the rich-text shape in lib/richText — flags and
 * colours, never markup. `note` is plain text.
 *
 * nameStyle / noteStyle exist because a name and a note are different kinds of
 * text: bolding a whole note to emphasise a word inside it is not what someone
 * wants. Applying one style to both was the wrong shape, so each gets its own.
 */
export interface Annotation {
  name?: string | null;
  note?: string | null;
  /** Style for the name. Falls back to `style` when unset, for older data. */
  nameStyle?: RichTextStyle;
  /** Style for the note. Falls back to `style` when unset. */
  noteStyle?: RichTextStyle;
  style?: RichTextStyle;
}

interface DrawBase { id: number; no: number; name: string; color: string; visible: boolean }
export interface PathDraw extends DrawBase { type: 'poly' | 'line'; coords: LngLat[] }
export interface CircleDraw extends DrawBase { type: 'circle'; center: LngLat; r: number }
export type DrawShape = PathDraw | CircleDraw;

/** A display area. Named and annotated the same way a drawing is. */
export interface FilterArea {
  id: number;
  no: number;
  coords: LngLat[];
  enabled: boolean;
  name?: string | null;
  note?: string | null;
}

/* ---------- settings ---------- */
export type PopupMode = 'active' | 'all';
export type BasemapId = 'road' | 'sat';
export type Cascade = 'google' | 'nominatim';
export type Theme = 'graphite' | 'oled' | 'slate' | 'sand' | 'forest' | 'rose' | 'mono';
export const THEMES: readonly (readonly [Theme, string])[] = [
  ['graphite', 'กราไฟต์'],
  ['oled', 'ดำ (OLED)'],
  ['slate', 'สเลต'],
  ['sand', 'ทราย'],
  ['forest', 'ป่า'],
  ['rose', 'กุหลาบ'],
  ['mono', 'ขาวดำ'],
];

export type PopupField = 'size' | 'perWah' | 'announce' | 'soldTs' | 'resale' | 'deed';
export type PopupConfig = Record<PopupKind, Record<PopupField, boolean>>;
export type LightboxField = 'name' | 'status' | 'price' | 'size' | 'deed' | 'soldTs';

export interface Filters {
  text: string;
  /* Filters on the marker kind, not the raw status: 're' (นำกลับมาขายใหม่) is a
     display distinction on top of a 'sale' lot, so it can never appear as a
     p.status value. Filtering on p.status would make that option match nothing.
     '' means no status filter. */
  status: '' | PopupKind;
    minWah: number | null;
    maxWah: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    /* Height above sea level, in metres. Null bound = unbounded on that side.
       Parcels with no elevation are excluded once either bound is set, because
       "unknown height" cannot satisfy "at least 150 m" and should not appear
       to. */
    minElev: number | null;
    maxElev: number | null;
  province: string;
  /** Multi-select chip filters (empty array = no restriction). */
  provinces: string[];
  tambons: string[];
  amps: string[];
  propertyTypes: string[];
}

/** Price-chart x-axis marker interval (labels + gridline spacing). */
export type ChartTick = 'none' | 'year' | 'm6' | 'm4' | 'm3';

export type SortKey = 'name' | 'status' | 'wah' | 'height' | 'price' | 'smartPrice' | 'perWah' | 'lastTs' | 'announce' | 'province';
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

/* ---------- overlays ---------- */
export type OverlayId = 'flood' | 'cadastre' | 'zoning';
export interface Overlay {
  id: OverlayId;
  name: string;
  en: string;
  color: string;
  opacity: number;
  visible: boolean;
  type: 'flood' | 'wms' | 'zoning';
  desc: string;
}
export interface RGBA { c: string; a: number }
export interface FloodConfig {
  sea: number;
  dry: boolean;
  maxDataZoom: number;
  floodLo: RGBA;
  floodHi: RGBA;
  dryLo: RGBA;
  dryHi: RGBA;
}
export type FloodColorKey = 'floodLo' | 'floodHi' | 'dryLo' | 'dryHi';

/* ---------- right panel ---------- */
export type RightView =
  | 'results' | 'overlay' | 'draw' | 'area' | 'detail'
  | 'cctv' | 'sensor' | 'pins-settings' | 'transport' | 'transport-settings' | 'search';

/* ---------- table columns ---------- */
export type ColKey =
  | 'no' | 'name' | 'status' | 'size' | 'height' | 'price' | 'smartPrice' | 'perWah'
  /* pName / pNote are the user's own name and note for the parcel, not its
     official ones — they are columns of user text, hence the p prefix. */
  | 'pName' | 'pNote'
  | 'saleBy' | 'seller' | 'ownerFile' | 'propertyType' | 'deedNo' | 'tambon'
  | 'court' | 'caseNo' | 'plaintiff' | 'defendant' | 'possessor'
  | 'enforcementOffice' | 'collateral' | 'spouseCollateral'
  | 'expertPrice' | 'enforcementOfficerPrice' | 'assessorPrice'
  | 'committeePrice' | 'announceDate' | 'amp' | 'announce' | 'lastTs' | 'province'
  | 'roundLast' | 'roundNext';
export interface ColDef {
label: string;
    w: number;
    sortable?: boolean;
    num?: boolean;
    subs?: string[];
    sortKey?: SortKey;
    /**
     * Centre the cell instead of left-aligning it. Applied to columns whose
     * content is a number, a date, or a 3-part unit split (ไร่/งาน/ตร.วา,
     * นัดที่/วันที่/สถานะ) — those read as data, not prose, and left-aligned
     * digits make a column look ragged.
     */
    center?: boolean;
  }

/* ---------- pins ---------- */
export type MarkerSize = 'small' | 'normal' | 'large';

/**
 * How exactly a parcel's map position is known. Shown in the UI because a point
 * that is really a subdistrict centroid should not look like a surveyed
 * boundary.
 *
 *   parcel      — the parcel's own coordinate (กรมธนารักย์ / กรมที่ดิน)
 *   subdistrict — the centre of its ตำบล, shown only so it is not invisible
 */
export type GeoPrecision = 'parcel' | 'subdistrict';

/** กรมธนารักย์ per-parcel assessment, บาท/ตร.วา. Null when TD has no record. */
export interface TdAssessment {
  perSqWa: number | null;
  rawang: string | null;
  surveyNo: string | null;
  landNo: string | null;
  /**
   * Why TD coordinates are absent. 'skipped:*' means the layer cannot serve
   * this title at all (น.ส.3ก. is not on the โฉนด layer); 'unresolved:*' means it
   * answered but nothing matched. Unresolved is a real gap, skipped is not, and
   * the UI must not present them the same way.
   */
  status: string | null;
}

/** Height above mean sea level, sampled from a DEM. */
export interface Elevation {
  /** Metres above sea level, or null where nothing covers the point. */
  m: number | null;
  source: string | null;
  /** Metres of uncertainty, so the number is not read as a survey. */
  uncertaintyM: number | null;
}

/** Mockup account row for the จัดการผู้ใช้ pane. */
export interface ManagedUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
  twoFa: boolean;
  lastSeen: string;
}
export type LayoutMode = 'docked' | 'floating';
export type GlassLevel = 'none' | 'transparent';
export interface CctvPin { id: string; name: string; ll: LngLat }
export interface SensorPin {
  id: string;
  type: 'flood' | 'dam';
  name: string;
  detail: string;
  ll: LngLat;
  lv: number;
  crit: number;
  hist: { t: number; lv: number }[];
}
export type SearchKind = 'land' | 'cctv' | 'sensor' | 'place' | 'transport';
export interface TransportPin { id: string; name: string; mode: 'bus' | 'metro' | 'train' | 'car'; ll: LngLat }
export interface SearchHit { kind: SearchKind; id: string; ll: LngLat; name: string; sub: string }
