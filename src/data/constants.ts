import type {
  BasemapId, ColDef, ColKey, FloodConfig, LightboxField, LngLat, Overlay, PopupConfig, PopupField, PopupKind, Status,
} from '../types';

export const MIN_ZOOM = 12;

/* Fixed map stack, bottom → top. The order MapLibre layers are created in *is*
   the render order, so this list is enforced by call order rather than by
   moveLayer():
     overlay → cctv → bus → water → land parcel → parcel label overlay → UI
   Overlays are created in useMapEvents before the pins; the parcel layers are
   created after them (see addCustomLayers). */
export const RENDER_ORDER = ['overlay', 'cctv', 'bus', 'water', 'land parcel', 'panel UI'] as const;
/**
 * Unlock code for the hidden "ค้นหา & API" settings tab. Not the Google API key —
 * this is just a local gate so the tab is not a one-click away. Change it here.
 */

export const ROW_H = 36;
export const HEADER_H = 56;
export const LEFT_W = 76;
export const RIGHT_W = 400;
export const RES_CAP = 100;
export const MIN_BH = 170;
export const PIN_W = 34;
export const RAIL_GAP = 12;
export const ACCENT = '#B8F13F';
export const AREA_COLOR = '#FF7A6B';

/** Multi-script Noto Sans from the MapLibre glyph server (Thai block included). */
export const MAP_FONTS = ['Noto Sans Regular'];

export const STATUS: Record<PopupKind, { th: string }> = {
  sale: { th: 'กำลังขาย' },
  sold: { th: 'ขายแล้ว' },
  inactive: { th: 'หมดอายุประกาศ' },
  cancelled: { th: 'ยกเลิกการขาย' },
  re: { th: 'นำกลับมาขายใหม่' },
};
export const STATUS_KEYS: Status[] = ['sale', 'sold', 'cancelled', 'inactive'];

export const POP_FIELDS: [PopupField, string][] = [
  ['size', 'ขนาดที่ดิน'], ['perWah', 'ราคา/ตร.วา'], ['announce', 'วันประกาศขาย'],
  ['soldTs', 'วันขายออก'], ['resale', 'วันนำกลับมาขาย'], ['deed', 'เลขโฉนด'],
];
/** [popup kind, label, colour source status] */
export const POP_KINDS: [PopupKind, string, Status][] = [
  ['sale', 'กำลังขาย', 'sale'], ['sold', 'ขายแล้ว', 'sold'],
  ['re', 'นำกลับมาขายใหม่', 'sale'], ['cancelled', 'ยกเลิกการขาย', 'cancelled'],
  ['inactive', 'หมดอายุประกาศ', 'inactive'],
];
export const LB_FIELDS: [LightboxField, string][] = [
  ['name', 'ชื่อแปลง'], ['status', 'สถานะ'], ['price', 'ราคา'], ['size', 'ขนาด'], ['deed', 'เลขโฉนด'], ['soldTs', 'วันขายออก'],
];
export const DEFAULT_POPUP_CFG: PopupConfig = {
  sale: { size: true, perWah: true, announce: true, soldTs: false, resale: false, deed: true },
  re: { size: true, perWah: true, announce: true, soldTs: false, resale: true, deed: true },
  sold: { size: true, perWah: true, announce: true, soldTs: true, resale: false, deed: true },
  /* Pulled from the listing, so there is no upcoming round to advertise. The
     useful fields are the schedule it ran and the deed. */
  inactive: { size: true, perWah: false, announce: true, soldTs: false, resale: false, deed: true },
  /* Never sold and never will be on this case - lifted or no sale in the rounds
     left. Price per ตร.ว. is withheld for the same reason as inactive: there is
     no auction left for it to mean anything about. */
  cancelled: { size: true, perWah: false, announce: true, soldTs: false, resale: false, deed: true },
};
export const DEFAULT_LB_CFG: Record<LightboxField, boolean> = {
  name: true, status: true, price: true, size: true, deed: false, soldTs: false,
};
/** Default colour per popup kind. `re` covers นำกลับมาขายใหม่ — a parcel that is
 *  still on sale but was already sold once, so it gets its own kind colour.
 *  `inactive` is deliberately dull and desaturated: it should read as withdrawn
 *  at a glance without being hidden, so it sits between the sold grey and the
 *  background rather than shouting. */
export const DEFAULT_POP_COLORS: Record<PopupKind, string> = {
  sale: '#E5484D', sold: '#8B9096', re: '#242424', inactive: '#5C5247',
  /* Cooler and darker than the inactive brown: cancelled is a dead end rather
     than an expired listing, and the two should be told apart at a glance. */
  cancelled: '#3E4A5C',
};

export const PRESET_COLORS = [
  '#B8F13F', '#F5F6F4', '#E5484D', '#FF7A6B', '#FF9F43', '#F5A623', '#FFD93D', '#9BE564', '#3DDAD7',
  '#4C9AFF', '#5B8DEF', '#B18CFF', '#E37FD8', '#F38BA8', '#8B9096', '#6E746A', '#DCE8DC', '#22371F',
];

export const WMS_BASE =
  'https://ms.longdo.com/mapproxy/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=dol_hd&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=TRUE&SRS=EPSG%3A4326&WIDTH=256&HEIGHT=256';

/** `sw` = CSS background painted as the preview swatch in the basemap popup. */
export const BASEMAPS: Record<BasemapId, { name: string; sw: string }> = {
  road: {
    name: 'ถนน — Google Road',
    sw: 'linear-gradient(90deg,transparent 42%,#F7D27C 42%,#F7D27C 58%,transparent 58%),linear-gradient(0deg,transparent 28%,#FFFFFF 28%,#FFFFFF 37%,transparent 37%),linear-gradient(0deg,transparent 68%,#FFFFFF 68%,#FFFFFF 77%,transparent 77%),#D9E6CB',
  },
  sat: {
    name: 'ดาวเทียม — Google',
    sw: 'radial-gradient(circle at 62% 38%,rgba(140,180,95,.5),transparent 46%),linear-gradient(135deg,#0E2A3A,#143326 55%,#1C4430)',
  },
};

export const DEFAULT_FLOOD: FloodConfig = {
  sea: 2, dry: false, maxDataZoom: 15,
  floodLo: { c: '#2191B9', a: 0.35 }, floodHi: { c: '#083782', a: 1 },
  dryLo: { c: '#1E5020', a: 0.38 }, dryHi: { c: '#DAD9C8', a: 0.38 },
};

export const DEFAULT_OVERLAYS: Overlay[] = [
  { id: 'flood', name: 'แผนที่น้ำท่วม', en: 'Flood (DEM)', color: '#4C9AFF', opacity: 0.75, visible: false, type: 'flood', desc: 'คำนวณจากความสูงภูมิประเทศ' },
  { id: 'cadastre', name: 'ขอบเขตที่ดิน', en: 'WMS · dol_hd', color: '#F5A623', opacity: 0.7, visible: false, type: 'wms', desc: 'WMS กรมที่ดิน' },
  { id: 'zoning', name: 'ผังการใช้ที่ดิน', en: 'Zoning', color: '#B18CFF', opacity: 0.22, visible: false, type: 'zoning', desc: 'โซนการใช้ที่ดินตามผังเมืองรวม' },
];

/** [name, lng, lat, osm category] — stand-in for the "Google" search cascade. */
export const POIS: [string, number, number, string][] = [
  ['ถนนพหลโยธิน', 100.547, 13.846, 'road'], ['ตลาดหมอชิต', 100.56, 13.799, 'market'],
  ['สวนลุมพินี', 100.54, 13.73, 'park'], ['มหาวิทยาลัยเชียงใหม่', 98.955, 18.802, 'school'],
  ['สนามบินภูเก็ต', 98.316, 8.113, 'aerodrome'], ['หาดใหญ่', 100.604, 7.009, 'town'],
  ['ท่าอากาศยานสุวรรณภูมิ', 100.746, 13.69, 'aerodrome'], ['เซ็นทรัลลาดพร้าว', 100.568, 13.806, 'shop'],
  ['บางนา', 100.617, 13.639, 'town'], ['เมืองเก่าเชียงใหม่', 98.984, 18.788, 'town'],
  ['ท่าเรือศรีราชา', 100.93, 13.12, 'harbour'], ['วัดพระธาตุดอยสุเทพ', 98.922, 18.805, 'place_of_worship'],
];

// export const DEFAULT_CENTER: LngLat = [100.5018, 13.7563];
export const DEFAULT_CENTER: LngLat = [102.8283, 16.4404];  // TODO:

/* ---------- table columns ---------- */
export const COL_DEFS: Record<ColKey, ColDef> = {
  no: { label: 'ลำดับที่', w: 92, num: true },
  name: { label: 'ชื่อแปลง', w: 200, sortable: true },
  status: { label: 'สถานะ', w: 96, sortable: true },
  size: { label: 'ขนาดที่ดิน', w: 168, subs: ['ไร่', 'งาน', 'ตร.วา'], sortable: true, sortKey: 'wah', center: true },
  /* Height above sea level. Hidden by default like most descriptive columns,
     because it is only meaningful where the parcel has its own coordinate — for
     the rest the cell says so instead of showing the centroid's height. */
  height: { label: 'ความสูง (ม.)', w: 112, num: true, sortable: true, sortKey: 'height' },
  price: { label: 'ราคา (บาท)', w: 120, sortable: true, num: true },
  /* The LED cascade's opening price — what the lot was first offered at, before
     any of the -10/-20/-30% reductions. Distinct from the headline price, which
     is the next round's. */
  smartPrice: { label: 'ราคาเปิด', w: 132, sortable: true, num: true, sortKey: 'smartPrice' },
  /* User-authored, per parcel. Blank until typed into — which is the point: an
     empty cell means "I have not named this", not "this has no name". */
  pName: { label: 'ชื่อกำกับ', w: 150 },
  pNote: { label: 'หมายเหตุกำกับ', w: 170 },
  perWah: { label: 'ราคา/ตร.วา', w: 108, sortable: true, num: true },
  saleBy: { label: 'จำนอง', w: 190 },
  seller: { label: 'ผู้ขาย', w: 180 },
  ownerFile: { label: 'เจ้าของสำนวน', w: 130 },
  propertyType: { label: 'ประเภททรัพย์', w: 150 },
  deedNo: { label: 'เลขที่โฉนด', w: 120 },
  tambon: { label: 'ตำบล', w: 120 },
  court: { label: 'ศาล', w: 120 },
  caseNo: { label: 'หมายเลขคดี', w: 110, num: true },
  plaintiff: { label: 'โจทก์', w: 130 },
  defendant: { label: 'จำเลย', w: 130 },
  possessor: { label: 'ผู้ถือสิทธิครอบรอง', w: 140 },
  enforcementOffice: { label: 'สำนักงานบังคับคดี/กอง', w: 160 },
  collateral: { label: 'หลักประกัน', w: 110, num: true },
  spouseCollateral: { label: 'คู่สมรส หลักประกัน', w: 130, num: true },
  expertPrice: { label: 'ราคา ผู้เชี่ยวชาญ', w: 130, num: true },
  enforcementOfficerPrice: { label: 'ราคา เจ้าพนักงานบังคับคดี', w: 150, num: true },
  assessorPrice: { label: 'ราคา เจ้าพนักงานประเมินราคา', w: 160, num: true },
  committeePrice: { label: 'ราคา คณะกรรมการ', w: 130, num: true },
  announceDate: { label: 'วันที่ประกาศ', w: 112, center: true },
  amp: { label: 'อำเภอ/เขต', w: 120 },
  announce: { label: 'วันประกาศขาย', w: 112, sortable: true, center: true },
  lastTs: { label: 'วันที่ล่าสุด', w: 112, sortable: true, sortKey: 'lastTs', center: true },
  province: { label: 'จังหวัด', w: 110, sortable: true },
  /* Two round columns, each with one fixed rule, so the table can be read across
     instead of one column whose meaning shifted per row: นัดล่าสุด is the most
     recent round already held, นัดถัดไป the next one still ahead. */
  roundLast: { label: 'นัดล่าสุด', w: 210, subs: ['นัดที่', 'วันที่', 'สถานะ'], center: true },
  /* No status sub-column on นัดถัดไป: a round that has not happened yet has only
     LED's placeholder word for a status, and printing it 30 times down the
     table says nothing. นัดที่ and วันที่ are the parts worth reading. */
  roundNext: { label: 'นัดถัดไป', w: 130, subs: ['นัดที่', 'วันที่'], center: true },
};
export const DEFAULT_COL_ORDER: ColKey[] = ['no', 'status', 'size', 'price', 'smartPrice', 'perWah', 'pName', 'pNote', 'saleBy', 'seller', 'ownerFile', 'propertyType', 'deedNo', 'amp', 'tambon', 'court', 'caseNo', 'plaintiff', 'defendant', 'possessor', 'enforcementOffice', 'collateral', 'spouseCollateral', 'expertPrice', 'enforcementOfficerPrice', 'assessorPrice', 'committeePrice', 'announceDate', 'announce', 'lastTs', 'province', 'roundLast', 'roundNext'];
/* The two annotation columns are visible but empty by default — a user who wants
   them reaches for them immediately, and they are the whole point of the
   feature. Height stays hidden because it is only meaningful where a parcel has
   its own coordinate. */
export const DEFAULT_COL_HIDDEN: ColKey[] = ['amp', 'announce', 'height', 'name'];

export const SORT_LABELS: Record<string, string> = {
  name: 'ชื่อแปลง', status: 'สถานะ', wah: 'ขนาดที่ดิน', price: 'ราคา (บาท)', perWah: 'ราคา/ตร.วา',
  lastTs: 'วันที่ล่าสุด', announce: 'วันประกาศขาย', province: 'จังหวัด',
};

export const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
