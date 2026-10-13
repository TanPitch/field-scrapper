/* liveData.ts — real parcels from the API, mapped onto the app's Parcel shape.
 *
 * The app was written against seeded fixtures in mockData.ts. Those are still
 * here and still used, but only as a fallback: when the API is reachable the
 * app shows what the scrapers actually collected, which is the only way to test
 * that the frontend and backend agree.
 *
 * Why this file exists rather than a hook in a component: seven modules read
 * ALL_PARCELS / PARCEL_BY_ID synchronously, including non-React code (the popup
 * builder, the filter pipeline). Converting all of those to async would be a
 * large refactor for no gain. Instead the collection is published as module-level
 * live bindings and React is told to recompute through a version counter in the
 * store — see useParcelData().
 *
 * The fallback is deliberate and visible, never silent: if the API is down the
 * user gets fixtures AND a banner saying so, because a screen full of invented
 * parcels that looks real is worse than an honest empty state.
 */
import { api, type ApiParcelProps, type ApiRound } from '../lib/api';
import type { HistPoint, Parcel, PriceEvent, SellRound, Status } from '../types';
import { FALLBACK_PARCELS } from './mockData';

/** Where the data currently on screen came from. Surfaced in the UI. */
export type DataSourceKind = 'api' | 'fixtures';

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: ApiParcelProps;
}

const isoTs = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
};

interface RoundRow extends ApiRound {}

/**
 * API rounds -> the app's SellRound.
 *
 * An undated round keeps date: null rather than being dropped here. The detail
 * panel decides what to show — it renders a row with an empty status cell for
 * those — and that decision belongs in the view, not in the data layer.
 *
 * status_code is carried through because the price ladder is meaningless
 * without it: only LED code 3 deepens the discount.
 */
function mapRounds(rows: RoundRow[]): SellRound[] {
  return rows.map((r) => ({
    date: isoTs(r.date),
    /* The label from the database is authoritative; "รอประกาศ" arrives here for
       an undated round and the panel blanks that cell rather than printing it. */
    status: r.label ?? '',
    statusCode: r.status_code ?? null,
    price: r.price ?? null,
    discountPct: r.discount_pct ?? null,
  }));
}

/**
 * Price history, oldest first.
 *
 * Built from the rounds that actually have a price, because that is the real
 * sequence. hist[0] is therefore the cascade's opening price, which is what
 * startPriceOf() returns and what the "smart price" column shows.
 */
function mapHist(rounds: SellRound[], startPrice: number | null, announceTs: number, now: number): HistPoint[] {
  const pts: HistPoint[] = [];
  if (startPrice != null && startPrice > 0) {
    pts.push({ d: announceTs, v: startPrice });
  }
  for (const r of rounds) {
    if (r.price == null || r.date == null) continue;
    pts.push({ d: r.date, v: r.price });
  }
  /* Sorted ascending, because the price chart and lastDelta() both assume the
     last element is the most recent point. Without this a lot whose round
     dates overlap its announce date would render inside out. */
  pts.sort((a, b) => a.d - b.d);
  if (!pts.length && startPrice != null && startPrice > 0) {
    pts.push({ d: now, v: startPrice });
  }
  return pts;
}

/** Event log. Only the two facts the UI actually asserts from live data. */
function mapEvents(status: Status, rounds: SellRound[], announceTs: number): PriceEvent[] {
  const out: PriceEvent[] = [];
  out.push({ idx: 0, label: 'ประกาศขาย', color: '#B8F13F', ink: '#151B06' });
  void announceTs;
  if (status === 'sold') {
    const sold = rounds.find((r) => r.statusCode === 1);
    out.push({ idx: Math.max(0, rounds.indexOf(sold ?? rounds[0])), label: 'ขายออกแล้ว', color: '#9BA1A6', ink: '#101211' });
  } else if (status === 'inactive') {
    out.push({ idx: Math.max(0, rounds.length - 1), label: 'หมดอายุประกาศ ไม่มีผู้สู้ราคา', color: '#5C5247', ink: '#fff' });
  }
  return out;
}

function mapStatus(raw: string | null): Status {
  return raw === 'sold' || raw === 'inactive' ? raw : 'sale';
}

/** One API feature -> a Parcel the rest of the app can render unchanged. */
/**
 * The parcel id is the join key for everything downstream — the map feature's
 * property, PARCEL_BY_ID, and the row the table hands to select(). If it ever
 * arrives as a string or NaN, the Map collapses every row onto one key and
 * every click misses. Validate it here rather than discovering it as a silent
 * lookup failure much later.
 */
const parcelId = (raw: unknown): number | null => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function featureToParcel(f: Feature, now: number): Parcel | null {
  const p = f.properties;
  const id = parcelId(p?.id);
  if (id == null) {
    console.warn('[liveData] feature with no usable id, dropped', p?.id);
    return null;
  }

  const announceTs = isoTs(p.publishedDate as string | null) ?? now;
  const rounds = mapRounds((p.rounds as RoundRow[]) ?? []);
  const status = mapStatus(p.status);
  const startPrice = (p.startPrice as number | null) ?? p.askingPrice;
  const hist = mapHist(rounds, startPrice, announceTs, now);
  const lastPrice = hist.length ? hist[hist.length - 1].v : (p.askingPrice ?? 0);

  /* ตร.ว. is null for condo lots, which LED publishes in ตร.ม. Showing them as
     "— ตร.ว." is honest; converting square metres to square wa would be a
     fabrication, since one is an area of land and the other a floor area. */
  const wah = p.sizeUnit === 'sqm' ? null : p.wah;

  return {
    id,
    status,
    wah: wah ?? 0,
    price: lastPrice,
    perWah: wah && wah > 0 ? Math.round(lastPrice / wah) : 0,
    lng: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
    name: [p.assetType, p.tambon, p.landTitle].filter(Boolean).join(' ') || `แปลง ${p.id}`,
    deed: p.deed ?? '',
    province: p.provinceName ?? '',
    amp: p.districtName ?? p.amphur ?? '',
    tambon: p.tambon ?? '',
    announce: announceTs,
    soldTs: null,
    hist,
    events: mapEvents(status, rounds, announceTs),
    resell: false,
    imgs: p.imageCount ?? 0,
    /* Real photographs, resolved against the API's static mount. An empty
       array means nothing has been fetched yet — which the carousel renders as
       its no-image state rather than as a broken picture. */
    images: (p.images ?? []).map((n) => `/img/land/${n}`),
    lastTs: now,
    saleByText: '',
    dataSource: 'กรมบังคับคดี',
    landKind: 'empty',
    ownerFile: p.plaintiff ?? p.owner ?? '',
    propertyType: p.assetType ?? '',
    /* LED's เลขที่โฉนด, not TD's landNo. Those are different fields and landNo is
       frequently a short fragment (a lot showed '94' where LED's was '72927'),
       so preferring it displayed the wrong deed. */
    deedNo: p.deed ?? p.landNo ?? '',
    court: p.court ?? '',
    caseNo: p.caseNo ?? '',
    plaintiff: p.plaintiff ?? '',
    defendant: p.defendant ?? '',
    possessor: p.owner ?? '',
    enforcementOffice: p.department ?? '',
    collateral: p.collateral ?? 0,
    spouseCollateral: p.spouseCollateral ?? null,
    expertPrice: p.expertPrice ?? null,
    enforcementOfficerPrice: p.officerPrice ?? null,
    assessorPrice: null,
    committeePrice: p.committeePrice ?? null,
    rounds,
    mortgage: null,
    geoPrecision: p.geoPrecision ?? null,
    td: p.tdStatus || p.evaPrice != null
      ? {
          perSqWa: p.evaPrice,
          rawang: p.rawang,
          surveyNo: p.surveyNo,
          landNo: p.landNo,
          status: p.tdStatus,
        }
      : null,
    elevation: p.elevation != null
      ? { m: p.elevation, source: p.elevationSource ?? null, uncertaintyM: p.elevationUncertainty ?? null }
      : null,
  };
}

/* ------------------------------------------------------------- publication */

/**
 * The live collection.
 *
 * Both exports are MUTATED IN PLACE, never reassigned. That is the whole point:
 * nine modules read these synchronously, including non-React code, and a
 * reassigned `export let` is only visible to them if the bundler honours live
 * bindings — which it does not everywhere, and which broke silently the first
 * time (the map kept the fixture array while PARCEL_BY_ID had the real rows, so
 * markers rendered but clicking one looked up a parcel that was not there).
 *
 * A getter would also work, but in-place mutation means every existing call site
 * stays correct with no change and no new invariant to remember.
 */
export const ALL_PARCELS: Parcel[] = FALLBACK_PARCELS.slice();
export const PARCEL_BY_ID: Map<number, Parcel> = new Map(FALLBACK_PARCELS.map((p) => [p.id, p]));
export const getDataOrigin = (): DataSourceKind => origin;

let origin: DataSourceKind = 'fixtures';

const listeners = new Set<() => void>();
const onChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function publish(rows: Parcel[], kind: DataSourceKind) {
  ALL_PARCELS.length = 0;
  for (const p of rows) ALL_PARCELS.push(p);

  PARCEL_BY_ID.clear();
  for (const p of rows) PARCEL_BY_ID.set(p.id, p);

  origin = kind;
  listeners.forEach((fn) => fn());
}

/**
 * Fetch real parcels. Resolves even on failure — it falls back to the fixtures
 * and says so, because an unhandled rejection here would leave the app with no
 * data at all rather than obviously-approximate data.
 */
export async function loadParcels(provinceCode?: number): Promise<{
  kind: DataSourceKind; count: number; error: string | null;
}> {
  const q = provinceCode != null ? `?province=${provinceCode}` : '';
  const r = await api.get<{ features: Feature[] }>(`/api/parcels${q}`);

  if (!r.ok || !r.data?.features) {
    publish(FALLBACK_PARCELS, 'fixtures');
    return { kind: 'fixtures', count: FALLBACK_PARCELS.length, error: r.error };
  }

  const now = Date.now();
  const rows = r.data.features.map((f) => featureToParcel(f, now)).filter((p): p is Parcel => p != null);

  /* An empty but successful response is not a reason to show fixtures. If the
     database genuinely holds nothing, the user should see "no data", because
     silently substituting 2,660 invented parcels would be a lie. */
  publish(rows, 'api');
  return { kind: 'api', count: rows.length, error: null };
}

/** Subscribe to "the parcel collection was replaced". */
export const subscribeParcels = onChange;

/**
 * A snapshot of the two collections, for diagnosing "the table has rows but
 * clicking one says it does not exist".
 *
 * Those can only disagree if there are two live copies of this module in the
 * page — one whose ALL_PARCELS the table renders from, another whose
 * PARCEL_BY_ID the click handler reads. `instance` is a per-module random id, so
 * seeing two different values here is the proof, and `rows` vs `mapSize` catching
 * the other half. Kept cheap and allocation-free enough to call from a toast.
 */
const INSTANCE = Math.random().toString(36).slice(2, 8);

export function diagnoseParcels(wantedId?: number): Record<string, unknown> {
  const first = ALL_PARCELS[0];
  return {
    instance: INSTANCE,
    rows: ALL_PARCELS.length,
    mapSize: PARCEL_BY_ID.size,
    firstRowId: first?.id ?? null,
    firstRowIdType: typeof first?.id,
    idsAreNumbers: ALL_PARCELS.every((p) => typeof p.id === 'number' && Number.isFinite(p.id)),
    wanted: wantedId ?? null,
    found: wantedId != null ? PARCEL_BY_ID.has(wantedId) : null,
    sampleIds: ALL_PARCELS.slice(0, 5).map((p) => p.id),
  };
}
