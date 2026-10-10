import { create } from 'zustand';
import {
  DEFAULT_COL_HIDDEN, DEFAULT_COL_ORDER, DEFAULT_FLOOD, DEFAULT_LB_CFG, DEFAULT_OVERLAYS, DEFAULT_POPUP_CFG,
  DEFAULT_POP_COLORS, MIN_BH,
} from '../data/constants';
import type { AvatarCfg } from '../components/ui/AvatarPicker';
import type {
  BasemapId, BBox, Cascade, CctvPin, ColKey, DrawDistMode, DrawMode, DrawShape, DrawTool, Filters, FilterArea,
  ChartTick, FloodConfig, GlassLevel, LightboxField, LayoutMode, LngLat, MarkerSize, Overlay, OverlayId, PopupConfig, PopupMode, RightView, SensorPin, SortState,
  ManagedUser, PopupKind, Status, Theme, TransportPin,
} from '../types';

export const EMPTY_FILTERS: Filters = {
  text: '', status: '', minWah: null, maxWah: null, minPrice: null, maxPrice: null, province: '',
  provinces: [], tambons: [], amps: [], propertyTypes: [],
};

export interface Toast { id: number; msg: string; warn: boolean; out: boolean }
export type SetTab = 'map' | 'popup' | 'search' | 'look' | 'about' | 'draw' | 'server' | 'user' | 'users';

export interface AppState {
  /* ----- settings ----- */
  popupMode: PopupMode;
  labelOverlap: boolean;
  labelSold: boolean;
  /** Show the land-kind (ว่าง / มีสิ่งปลูกสร้าง) badge icon. */
  showLandKindIcon: boolean;
  priceBath: boolean;
  priceSpace: boolean;
  showCircleMeta: boolean;
  areaTagsOn: boolean;
  drawDistMode: DrawDistMode;
  reduceMotion: boolean;
  theme: Theme;
  /** User-chosen primary colour (hex). Empty = use the theme's own accent. */
  accentColor: string;
  cascade: Cascade;
  gkey: string;
  restrict: boolean;
  override: boolean;
statusVisible: Record<Status, boolean>;
  /** Kept for backwards-compat with saved state; `re` now lives in popColors. */
  reColor: string;
  popColors: Record<PopupKind, string>;
  popupCfg: PopupConfig;
  lbCfg: Record<LightboxField, boolean>;

  /* ----- data view ----- */
  filters: Filters;
  sort: SortState;
  chartRange: { min: number; max: number } | null;
  /** Price-chart x-axis marker interval. */
  chartTick: ChartTick;
  forceArea: BBox | null;
  basemap: BasemapId;
  pinnedIds: ReadonlySet<number>;
  colOrder: ColKey[];
  colHidden: ReadonlySet<ColKey>;
  colPinned: ReadonlySet<ColKey>;
  colWidths: Partial<Record<ColKey, number>>;

  /* ----- layout / selection ----- */
  rpView: RightView;
  overlaySel: OverlayId;
  setTab: SetTab;
  rightOpen: boolean;
  leftOpen: boolean;
  settingsOpen: boolean;
  selectedId: number | null;
  bottomH: number;

  /* ----- drawing ----- */
  drawTool: DrawTool;
  drawMode: DrawMode;
  editingDraw: number | null;
  drawPts: LngLat[];
  drawCenter: LngLat | null;
  previewR: number;
  drawRadius: number;
  cursorLL: LngLat | null;
  draws: DrawShape[];
  areas: FilterArea[];
  drawSeq: number;
  areaSeq: number;
  drawInfo: string; /* live measurement text shown in the draw bar */

  /* ----- overlays ----- */
  overlays: Overlay[];
  flood: FloodConfig;
  floodV: number;
  floodProbe: boolean;

  /* ----- map ----- */
  mapReady: boolean;
  bounds: BBox | null;
  zoom: number;

  /* ----- pins (land / CCTV / sensors) ----- */
  landOn: boolean;
  cctvOn: boolean;
  sensOn: boolean;
  transportOn: boolean;
  transportOpacity: number;
  glassLevel: GlassLevel;
  layoutMode: LayoutMode;
  sensOpacity: number;
  markerSize: MarkerSize;
  /** Max hits shown for a search, per source group. */
  searchLimit: number;
  /** Reveals the ค้นหา & API settings tab (needs the unlock code from แผนที่). */
  showApiSettings: boolean;
  /** Mockup account fields (ผูใช้ pane) — no backend. */
  /** dmin sees hidden settings tabs without the unlock code. */
  role: 'user' | 'admin';
  signedIn: boolean;
  userName: string;
  displayName: string;
  twoFa: boolean;
  avatarColor: string;
  /** Icon/colour (or uploaded image) for the profile picture. */
  avatarCfg: AvatarCfg;
  /** Mockup account list for จัดการผู้ใช้. */
  managedUsers: ManagedUser[];
  cctvList: CctvPin[];
  sensList: SensorPin[];
  transportList: TransportPin[];
  pinSel: string | null;
  searchPrefill: string;

  /* ----- toasts ----- */
  toasts: Toast[];

  patch: (p: Partial<AppState>) => void;
}

export const useApp = create<AppState>(set => ({
  popupMode: 'active',
  labelOverlap: false,
  labelSold: true,
  showLandKindIcon: true,
  priceBath: false,
  priceSpace: true,
  showCircleMeta: true,
  areaTagsOn: true,
  drawDistMode: 'both',
  reduceMotion: false,
  theme: 'graphite',
  accentColor: '',
  cascade: 'google',
  gkey: '',
  restrict: false,
  override: false,
statusVisible: { sale: true, sold: true },
  reColor: DEFAULT_POP_COLORS.re,
  popColors: { ...DEFAULT_POP_COLORS },
  popupCfg: structuredClone(DEFAULT_POPUP_CFG),
  lbCfg: { ...DEFAULT_LB_CFG },

  filters: { ...EMPTY_FILTERS },
  sort: { key: 'price', dir: 'desc' },
  chartRange: null,
  chartTick: 'none',
  forceArea: null,
  basemap: 'sat',
  pinnedIds: new Set<number>(),
  colOrder: [...DEFAULT_COL_ORDER],
  colHidden: new Set<ColKey>(DEFAULT_COL_HIDDEN),
  colPinned: new Set<ColKey>(),
  colWidths: {},

  rpView: 'results',
  overlaySel: 'flood',
  setTab: 'map',
  rightOpen: true,
  leftOpen: true,
  settingsOpen: false,
  selectedId: null,
  bottomH: 286,

  drawTool: 'poly',
  drawMode: null,
  editingDraw: null,
  drawPts: [],
  drawCenter: null,
  previewR: 0,
  drawRadius: 0,
  cursorLL: null,
  draws: [],
  areas: [],
  drawSeq: 1,
  areaSeq: 1,
  drawInfo: '',

  overlays: structuredClone(DEFAULT_OVERLAYS),
  flood: structuredClone(DEFAULT_FLOOD),
  floodV: 1,
  floodProbe: false,

  mapReady: false,
  bounds: null,
  zoom: 12.35,

  landOn: true,
  cctvOn: true,
  sensOn: true,
  transportOn: true,
  transportOpacity: 0.9,
  glassLevel: 'none',
  layoutMode: 'floating',
  sensOpacity: 0.9,
  markerSize: 'normal',
  searchLimit: 8,
  showApiSettings: false,
  role: 'admin',
  signedIn: false,
  userName: 'fieldscrapper',
  displayName: 'ผู้ใช้ Field Scrapper',
  twoFa: false,
  avatarColor: '',
  avatarCfg: { icon: 'user', from: '#4C9AFF', to: '', image: '' },
  managedUsers: [],
  cctvList: [],
  sensList: [],
  transportList: [],
  pinSel: null,
  searchPrefill: '',

  toasts: [],

  patch: p => set(p),
}));

/* ---------- non-hook helpers (usable from map callbacks) ---------- */
export const getApp = (): AppState => useApp.getState();
export const patchApp = (p: Partial<AppState>): void => useApp.getState().patch(p);

let entityUid = 1;
export const newEntityId = (): number => entityUid++;
let toastUid = 1;

export function toast(msg: string, type: 'ok' | 'warn' = 'ok'): void {
  const id = toastUid++;
  const add = (t: Toast[]) => [...t, { id, msg, warn: type === 'warn', out: false }];
  useApp.setState(s => ({ toasts: add(s.toasts) }));
  setTimeout(() => {
    useApp.setState(s => ({ toasts: s.toasts.map(t => (t.id === id ? { ...t, out: true } : t)) }));
    setTimeout(() => useApp.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 260);
  }, 2400);
}

export const clampBottomH = (px: number, viewportH: number, headerH: number): number =>
  Math.max(MIN_BH, Math.min(px, viewportH - headerH));
