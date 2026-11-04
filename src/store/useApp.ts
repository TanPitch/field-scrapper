import { create } from 'zustand';
import {
  DEFAULT_COL_HIDDEN, DEFAULT_COL_ORDER, DEFAULT_FLOOD, DEFAULT_LB_CFG, DEFAULT_OVERLAYS, DEFAULT_POPUP_CFG,
  DEFAULT_POP_COLORS, MIN_BH, ACCENT, THEME_ACCENT,
} from '../data/constants';
import type { AvatarCfg } from '../components/ui/AvatarPicker';
import type { CondoUnitOrder } from '../lib/condoUnits';
import type {
  BasemapId, BBox, Cascade, CctvPin, ColKey, DrawDistMode, DrawMode, DrawShape, DrawTool, Filters, FilterArea,
  ChartTick, FloodConfig, GlassLevel, LightboxField, LayoutMode, LngLat, MarkerSize, Overlay, OverlayId, PopupConfig, PopupMode, RightView, SensorPin, SortState,
  PopupKind, Status, Theme, TransportPin,
} from '../types';

export const EMPTY_FILTERS: Filters = {
  text: '', status: [], minWah: null, maxWah: null, minPrice: null, maxPrice: null, minElev: null, maxElev: null, province: '',
  provinces: [], tambons: [], amps: [], propertyTypes: [],
};

/**
 * The accent the CSS is actually resolving right now: the user's override when
 * one is set, else the current theme's own accent. Canvas paint (chart line,
 * map paint properties, price-event colours) cannot read CSS vars, so anything
 * that draws by hand resolves through this instead of hard-coding ACCENT —
 * which silently lied under every non-graphite theme.
 */
export function effectiveAccent(): string {
  const s = getApp();
  return s.accentColor || THEME_ACCENT[s.theme] || ACCENT;
}

export interface Toast { id: number; msg: string; warn: boolean; out: boolean }
export type SetTab = 'map' | 'popup' | 'search' | 'look' | 'about' | 'draw' | 'server' | 'user' | 'users' | 'gaps' | 'reports';

export interface AppState {
  /* ----- settings ----- */
  popupMode: PopupMode;
  labelOverlap: boolean;
  labelSold: boolean;
  /** Show the next scheduled selling date on each marker label. Separate from
   *  labelSold, which controls whether SOLD parcels keep a label. */
  labelNextDate: boolean;
  /** Draw a vertical 'today' marker on the price chart. */
  chartTodayLine: boolean;
  /** Draw the dashed, semi-transparent leg to the predicted next-round price. */
  chartForecast: boolean;
  /** Draw the forecast leg in solid ink like the past, instead of dashed/faded. */
  chartForecastSolid: boolean;
  /** Which unit stands in for a condo building on the map. */
  condoUnitOrder: CondoUnitOrder;
  /** Restore the map to wherever it was left, rather than the default view. */
  persistMapView: boolean;
  /** Clicking empty map space clears the selection. Off = the ring and panel
   *  survive stray map clicks; the corner ✕ and panel close still deselect. */
  autoDeselect: boolean;
  /** Last camera position, saved so the next login resumes there. */
  lastView: { lng: number; lat: number; zoom: number } | null;
  /** Collapse the settings sections down to their headers. */
  sectionsCollapsed: boolean;
  /** Detail-panel rows the user has hidden. */
  detailRowHidden: string[];
  /** User-chosen display order for detail-panel rows. */
  detailRowOrder: string[];
  /** Sold lots' headline arrangement: 'sold' = winning bid large (default),
      'open' = open price large with the winning bid demoted. Read by
      PriceHeadline's sold branch; sold land only. */
  soldPriceHeadline: 'sold' | 'open';
  /** Rounds from earlier sale orders (resale history): false = shown dimmed,
      true = hidden. See saleOrderLabels in DetailView. */
  hidePrevSaleRounds: boolean;
  /** The นัดที่ column reads A1, B2 … when a lot was re-listed (grouped by
   *  sale order); off = the plain in-order count, letters dropped. */
  roundGroupLabels: boolean;
  roundsPreview: number | null;
  roundsGroupBorder: boolean;
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
  /**
   * Highlight, in the detail panel's round table, the round a lot sold at and
   * every round after it. On by default: those rounds are dead, and a plain
   * list of dates does not make that obvious. The user can turn it off.
   */
  highlightSoldRounds: boolean;
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
  /** Parcels that sell together with the selected one (same ลำดับการขาย).
   *  Filled by select() when the parcel has group sale siblings; cleared on
   *  deselect so a stale ring never survives a click elsewhere. */
  groupIds: number[];
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
  /** How many run-log lines the server pane keeps visible. */
  logLimit: number;
  /** Ring around the selected parcel (and its dashed group-sale siblings).
   *  Empty = follow the theme accent. */
  ringColor: string;
  /* Account fields, synced to the server account via useSettingsSync. The
     admin sees the hidden management tabs (ผู้ใช้ทั้งหมด, ข้อมูลที่ยังหาไม่เจอ). */
  role: 'user' | 'admin';
  signedIn: boolean;
  userName: string;
  displayName: string;
  twoFa: boolean;
  avatarColor: string;
  /** Icon/colour (or uploaded image) for the profile picture. */
  avatarCfg: AvatarCfg;
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
  labelNextDate: true,
  chartTodayLine: true,
  chartForecast: true,
  chartForecastSolid: false,
  condoUnitOrder: 'statusFirst',
  persistMapView: true,
  autoDeselect: true,
  lastView: null,
  sectionsCollapsed: true,
  detailRowHidden: [],
  detailRowOrder: [],
  soldPriceHeadline: 'sold',
  hidePrevSaleRounds: false,
  roundGroupLabels: true,
  roundsPreview: null,
  roundsGroupBorder: true,
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
  highlightSoldRounds: false,
  /* inactive is ON by default. A withdrawn lot is history the user is actively
     looking for, so hiding it by default would lose rows silently; the land-type
     filter is how you narrow back to live inventory. */
  statusVisible: { sale: true, sold: true, inactive: true, cancelled: true },
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
  rightOpen: false,
  leftOpen: true,
  settingsOpen: false,
  selectedId: null,
  groupIds: [],
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
  cctvOn: false,
  sensOn: false,
  transportOn: false,
  transportOpacity: 0.9,
  glassLevel: 'none',
  layoutMode: 'floating',
  sensOpacity: 0.9,
  markerSize: 'normal',
  searchLimit: 8,
  logLimit: 20,
  ringColor: '',
  role: 'admin',
  signedIn: false,
  userName: 'fieldscrapper',
  displayName: 'ผู้ใช้ Field Scrapper',
  twoFa: false,
  avatarColor: '',
  avatarCfg: { icon: 'user', from: '#4C9AFF', to: '', image: '' },
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

/* Dev-only handle on the store, for driving the app from a headless probe.
   Vite strips import.meta.env.DEV from a production build, so this cannot ship.
   Anything the settings panel writes can be set directly:
   __app.getState().patch({ priceBath: false }) */
if (import.meta.env.DEV) {
  (globalThis as unknown as { __app: typeof useApp }).__app = useApp;
}

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
