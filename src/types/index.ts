export type LngLat = [number, number];
export type BBox = [number, number, number, number]; /* west, south, east, north */

/** Auction status of a parcel: currently on the block, or already sold. */
export type Status = 'sale' | 'sold';
/** Marker kind — resale parcels are "นำกลับมาขายใหม่" until they sell again. */
export type PopupKind = Status | 're';

export interface HistPoint { d: number; v: number }
export interface PriceEvent { idx: number; label: string; color: string; ink: string }
export interface SellRound { date: number | null; status: string }
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
  imgs: number;
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

interface DrawBase { id: number; no: number; name: string; color: string; visible: boolean }
export interface PathDraw extends DrawBase { type: 'poly' | 'line'; coords: LngLat[] }
export interface CircleDraw extends DrawBase { type: 'circle'; center: LngLat; r: number }
export type DrawShape = PathDraw | CircleDraw;

export interface FilterArea { id: number; no: number; coords: LngLat[]; enabled: boolean }

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
  status: '' | Status;
  minWah: number | null;
  maxWah: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  province: string;
  /** Multi-select chip filters (empty array = no restriction). */
  provinces: string[];
  tambons: string[];
  amps: string[];
  propertyTypes: string[];
}

/** Price-chart x-axis marker interval (labels + gridline spacing). */
export type ChartTick = 'none' | 'year' | 'm6' | 'm4' | 'm3';

export type SortKey = 'name' | 'status' | 'wah' | 'price' | 'perWah' | 'lastTs' | 'announce' | 'province';
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
  | 'no' | 'name' | 'status' | 'size' | 'price' | 'perWah'
  | 'saleBy' | 'seller' | 'ownerFile' | 'propertyType' | 'deedNo' | 'tambon'
  | 'court' | 'caseNo' | 'plaintiff' | 'defendant' | 'possessor'
  | 'enforcementOffice' | 'collateral' | 'spouseCollateral'
  | 'expertPrice' | 'enforcementOfficerPrice' | 'assessorPrice'
  | 'committeePrice' | 'announceDate' | 'amp' | 'announce' | 'lastTs' | 'province'
  | 'roundLast';
export interface ColDef {
  label: string;
  w: number;
  sortable?: boolean;
  num?: boolean;
  subs?: string[];
  sortKey?: SortKey;
}

/* ---------- pins ---------- */
export type MarkerSize = 'small' | 'normal' | 'large';

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
