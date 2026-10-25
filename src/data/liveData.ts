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
import { landKindOf } from '../components/ui/LandKindIcon';
import { groupUnitsByParcel, representativeUnit, type CondoUnitOrder } from '../lib/condoUnits';
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
function mapHist(rounds: SellRound[], startPrice: number | null, announceTs: number, now: number): {
  pts: HistPoint[];
  /** Round array index -> index into `pts`, or -1 when that round produced no
   *  point. Without this, callers index `pts` by round position and read the
   *  wrong point. */
  roundToHist: number[];
} {
  const pts: HistPoint[] = [];
  const roundToHist: number[] = rounds.map(() => -1);
  if (startPrice != null && startPrice > 0) {
    pts.push({ d: announceTs, v: startPrice });
  }
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    /* A ถอนการยึด round is LED taking the land out of seizure: the sale
     * sequence ends there. Rows the ledger prints after it are leftovers, not
     * a market the money ever reached, so nothing after this round - not the
     * withdrawal round itself - becomes a chart point. งดขาย is NOT such an
     * end: a suspended round is followed by a real next round, so its points
     * keep flowing. */
    if (r.status.includes('ถอนการยึด')) break;
    if (r.price == null || r.date == null) continue;
    roundToHist[i] = pts.length;
    pts.push({ d: r.date, v: r.price });
  }
  /* Sorted ascending, because the price chart and lastDelta() both assume the
     last element is the most recent point. Without this a lot whose round
     dates overlap its announce date would render inside out.
     Sorting moves points, so the mapping has to be rebuilt by date rather than
     left pointing at pre-sort positions. */
  pts.sort((a, b) => a.d - b.d);
  if (!pts.length && startPrice != null && startPrice > 0) {
    pts.push({ d: now, v: startPrice });
  }
  for (let i = 0; i < roundToHist.length; i++) {
    const k = roundToHist[i];
    if (k < 0) continue;
    /* pts was sorted, so re-find this round's point by identity of value. */
    roundToHist[i] = pts.findIndex(
      (pt) => pt.d === pts[k].d && pt.v === pts[k].v,
    );
  }
  return { pts, roundToHist };
}

/** Event log. Only the two facts the UI actually asserts from live data. */
function mapEvents(status: Status, rounds: SellRound[], roundToHist: number[], announceTs: number): PriceEvent[] {
  const out: PriceEvent[] = [];
  out.push({ idx: 0, label: 'ประกาศขาย', color: '#B8F13F', ink: '#151B06' });
  void announceTs;
  if (status === 'sold') {
    const sold = rounds.find((r) => r.statusCode === 1);
    const at = roundToHist[rounds.indexOf(sold ?? rounds[0])] ?? -1;
    if (at >= 0) out.push({ idx: at, label: 'ขายออกแล้ว', color: '#9BA1A6', ink: '#101211' });
  } else if (status === 'inactive' || status === 'cancelled') {
    /* The last round that actually produced a point. Indexing rounds.length-1
       assumes every round made it into hist, which is false whenever one lacks a
       price or a date - and reading past the end crashed the panel. */
    const last = [...roundToHist].reverse().find(i => i >= 0) ?? -1;
    /* Two labels, not four. Both dead ends used to render as หมดอายุประกาศ ไม่มีผู้สู้ราคา,
       which told the user a listing had run out when in fact the court had lifted
       the attachment - the parcel left the market, the auction did not expire. */
    const dead = status === 'cancelled'
      ? { label: 'ยกเลิกการขาย ไม่ดำเนินการ', color: '#3E4A5C', ink: '#fff' }
      : { label: 'หมดอายุประกาศ ไม่มีผู้สู้ราคา', color: '#5C5247', ink: '#fff' };
    if (last >= 0) out.push({ idx: last, ...dead });
  }
  return out;
}

/* A round that produced no sale at all - LED's own word for it, งดขาย.
 * งดขายไม่มีผู้สู้ราคา is deliberately not one of these: no bidders still means the
 * lot is being auctioned and the next round is a real chance. Only the flat
 * งดขาย says the sale itself was called off. */
export const noSaleRound = (r: SellRound): boolean => r.status.trim() === 'งดขาย';

/* LED leaves a lot `active` after every one of its rounds has come back งดขาย.
 * Nothing is being auctioned, so กำลังขาย would advertise a next date for land
 * that is not going to market. That dead end is หมดอายุประกาศ - the
 * announcement expired with no bidders - never ยกเลิกการขาย, which is kept for
 * the server's own close_reason (court lifted the attachment). */
export const neverOnMarket = (rounds: SellRound[]): boolean => {
  const dated = rounds.filter((r) => r.date != null);
  return dated.length > 0 && dated.every(noSaleRound);
};

function mapStatus(raw: string | null, rounds: SellRound[]): Status {
  if (raw === 'sold' || raw === 'inactive' || raw === 'cancelled') return raw;
  if (raw === 'sale' && neverOnMarket(rounds)) return 'inactive';
  return 'sale';
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
  const status = mapStatus(p.status, rounds);
  const startPrice = (p.startPrice as number | null) ?? p.askingPrice;
  const { pts: hist, roundToHist } = mapHist(rounds, startPrice, announceTs, now);
  const lastPrice = hist.length ? hist[hist.length - 1].v : (p.askingPrice ?? 0);

  /* LED's own "sold" marker: the round carrying status_code 1 is the winning
   * bid, so its date and price are exactly what a printed report would call
   * the sold date and ราคาที่ขายได้. A lot resold after a failed first sale
   * has two such rounds — the most recent one is the live fact. */
  const sold = rounds.filter((r) => r.statusCode === 1).pop() ?? null;

  /* LED publishes a ห้องชุด floor area in the same rai/ngan/wa triple as land, so
     30.35 means square metres on a condo unit. Printing a dash told the reader
     nothing; showing the figure lets them judge it, and ห้องชุด in the row above
     already says which unit is meant. What must not follow is dividing a
     square-metre price by a square-wa divisor and printing ราคา/ตร.ว. */
  const size = p.wah ?? null;
  const land = p.sizeUnit === 'sqm' ? null : (size != null && size > 0 ? size : null);

  return {
    id,
    lotId: (p.lotId as number | null) ?? undefined,
    parcelId: id,
    status,
    wah: size,
    sizeUnit: p.sizeUnit ?? 'wa',
    price: lastPrice,
    perWah: land != null ? Math.round(lastPrice / land) : null,
    lng: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
    name: [p.assetType, p.tambon, p.landTitle].filter(Boolean).join(' ') || `แปลง ${p.id}`,
    deed: p.deed ?? '',
    province: p.provinceName ?? '',
    amp: p.districtName ?? p.amphur ?? '',
    tambon: p.tambon ?? '',
    announce: announceTs,
    soldTs: sold?.date ?? null,
    soldPrice: sold?.price ?? null,
    /* Freshness: when the ingest last confirmed this lot still matches LED.
       Nothing shows when the server predates the column — a missing stamp
       cannot be rendered as an old one. */
    ledTs: isoTs(p.ledSeen),
    hist,
    events: mapEvents(status, rounds, roundToHist, announceTs),
    resell: false,
    imgs: p.imageCount ?? 0,
    /* Real photographs, resolved against the API's static mount. An empty
       array means nothing has been fetched yet — which the carousel renders as
       its no-image state rather than as a broken picture. */
    images: (p.images ?? []).map((n) => `/img/land/${n}`),
    lastTs: now,
    saleByText: '',
    dataSource: 'กรมบังคับคดี',
    landKind: landKindOf(p.assetType),
    ownerFile: p.plaintiff ?? p.owner ?? '',
    propertyType: p.assetType ?? '',
    /* Carried straight through: the marker badge and the unit cycler both key
       off this. Default 1 so an older server without the field behaves as one
       lot rather than as zero. */
    lotCount: p.lotCount ?? 1,
    /* Every lot of one building shares this, so the panel can find its
       siblings without guessing from coordinates. */
    parcelKey: p.parcelId != null ? String(p.parcelId) : undefined,
    /* LED's เลขที่โฉนด, not TD's landNo. Those are different fields and landNo is
       frequently a short fragment (a lot showed '94' where LED's was '72927'),
       so preferring it displayed the wrong deed. */
    deedNo: p.deed ?? p.landNo ?? '',
    court: p.court ?? '',
    caseNo: p.caseNo ?? '',
    /* Group-sale key + text, carried through so select() can auto-select the
       parcels that sell together and the detail panel can show the note. */
    caseNoRaw: p.caseNoRaw ?? null,
    caseYear: p.caseYear ?? null,
    order: p.order ?? '',
    groupCount: p.groupCount ?? 1,
    remark: p.remark ?? '',
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
    /* Carried through because loadParcels gates the map on them. They were sent
     * by the API and then dropped here, so the only two call sites that read
     * them saw undefined forever: `verdictsKnown` was always false and the
     * "only a confirmed match is user-facing" filter never ran. 465 rows with
     * no coordinate of any kind therefore reached the map and were painted at
     * lat/lng 0 - the Gulf of Guinea blob the comment below says was fixed. */
    tdVerdict: p.tdVerdict ?? null,
    dolVerdict: p.dolVerdict ?? null,
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

/* Which unit of a multi-unit parcel stands in for the building wherever a parcel
 * is looked up by id - the popup, the detail panel, the selected row.
 *
 * This used to be "whichever row was written last", because every unit of a
 * building carries the same parcel id and the map iterated them into the index.
 * The dot and the popup could then disagree, and a building with one unit still
 * selling and another already sold could be represented by the finished one.
 * Resolving it here means the call sites cannot get it wrong. */
let unitOrder: CondoUnitOrder = 'sizeDesc';

function reindex() {
  PARCEL_BY_ID.clear();
  for (const group of groupUnitsByParcel(ALL_PARCELS).values()) {
    const rep = representativeUnit(group, unitOrder) ?? group[0];
    if (rep) PARCEL_BY_ID.set(rep.id, rep);
  }
}

/** Apply the user's unit cascade to the lookup index. No-op when unchanged. */
export function setUnitOrder(next: CondoUnitOrder): void {
  if (next === unitOrder) return;
  unitOrder = next;
  reindex();
  listeners.forEach((fn) => fn());
}

const listeners = new Set<() => void>();
const onChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function publish(rows: Parcel[], kind: DataSourceKind) {
  ALL_PARCELS.length = 0;
  for (const p of rows) ALL_PARCELS.push(p);

  reindex();

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
  /** Rows the resolvers could not confirm; kept out of the map and table. */
  hidden?: number;
}> {
  const q = provinceCode != null ? `?province=${provinceCode}` : '';
  const r = await api.get<{ features: Feature[] }>(`/api/parcels${q}`);

  if (!r.ok || !r.data?.features) {
    publish(FALLBACK_PARCELS, 'fixtures');
    return { kind: 'fixtures', count: FALLBACK_PARCELS.length, error: r.error };
  }

  const now = Date.now();
  const rows = r.data.features.map((f) => featureToParcel(f, now)).filter((p): p is Parcel => p != null);

  /* Only a confirmed match is user-facing. A resolver that returned a row has
     not necessarily answered the right one - TD takes a bare deed number and can
     hand back a parcel in the wrong district - and an unresolved parcel has no
     geometry at all, which featureToParcel turns into lat/lng 0. Those would
     otherwise plot as a blob in the Gulf of Guinea rather than going missing.

     The verdict test alone is not enough. Deed 3722 in Phuket was written as a
     match by a resolver run that predates the verdict column, yet no source ever
     gave it a coordinate - geom, td_lat and dol_lat are all null. It passed the
     verdict test and plotted at 0,0. So a row with no coordinate is dropped
     whatever its verdict says; a match with nothing to put on the map is not
     something the user can be shown.

     The rejected ones are not lost: /api/admin/coord-gaps lists them by verdict
     so an admin can see what needs a hand. */
  const shown = rows.filter((p) =>
    (p.tdVerdict === 'match' || p.dolVerdict === 'match')
    && p.lat !== 0 && p.lng !== 0);

  /* The filter above fails closed: an API that predates the verdict column sends
     no tdVerdict at all, every row fails the test, and the map goes blank
     rather than showing everything. That is the worst failure mode - it looks
     like "no data" instead of "wrong build". If nothing carries a verdict,
     show what we have and let the user see stale data rather than nothing. */
  const verdictsKnown = rows.some((p) => p.tdVerdict != null || p.dolVerdict != null);
  const visible = verdictsKnown ? shown : rows;

  publish(visible, 'api');
  return { kind: 'api', count: visible.length, error: null, hidden: rows.length - visible.length };
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
