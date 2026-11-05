/* liveData.ts — real parcels from the API, mapped onto the app's Parcel shape.
 *
 * The seeded fixture set (mockData.ts) was removed: an unconnected server is an
 * empty map plus the banner's honest reason, never invented land that pretends
 * to be real. 2026-11-04.
 *
 * Why this file exists rather than a hook in a component: seven modules read
 * ALL_PARCELS / PARCEL_BY_ID synchronously, including non-React code (the popup
 * builder, the filter pipeline). Converting all of those to async would be a
 * large refactor for no gain. Instead the collection is published as module-level
 * live bindings and React is told to recompute through a version counter in the
 * store — see useParcelData().
 */
import { api, type ApiParcelProps, type ApiRound } from '../lib/api';
import { landKindOf } from '../components/ui/LandKindIcon';
import { groupUnitsByParcel, representativeUnit, type CondoUnitOrder } from '../lib/condoUnits';
import type { HistPoint, Parcel, PriceEvent, SellRound, Status } from '../types';
import { inkOn } from './constants';
import { effectiveAccent } from '../store/useApp';

/** Where the data currently on screen came from. Surfaced in the UI —
 * 'loading' while the first fetch is in flight, 'error' when it failed.
 * There is no fixture kind any more: the seeded mockup set was removed, so
 * an unconnected server means an empty map with the banner explaining why,
 * never invented land pretending to be real. */
export type DataSourceKind = 'loading' | 'api' | 'error';

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
 * without it: a no-bid round is the ingest's code 3, or LED's own งดขายไม่มีผู้สู้ราคา
 * label (the report sheet's history rows are code 10 but speak through the label).
 *
 * Placeholder promotion (ผบE.389/2569 RCA): the report sync deliberately
 * writes the real outcome only into led_label — rewriting status_label is how
 * ผบ.2255/2562's labels got crossed. When the lists page has not caught up and
 * still says รอประกาศ/ยังไม่มีการเปิดประมูล while the report already names an
 * outcome, the label is the absence of a result — the report's word is the
 * result. Promote it here once, so the table, the popup, the chart and the
 * price ladder (isNoBidRound reads the label) all see the same outcome without
 * each surface growing its own override.
 */
const PLACEHOLDER_STATUSES = new Set(['รอประกาศ', 'ยังไม่มีการเปิดประมูล']);

function mapRounds(rows: RoundRow[]): SellRound[] {
  return rows.map((r) => {
    const status = r.label ?? '';
    const led = (r.led_label ?? '').trim();
    const real = led !== '' && !PLACEHOLDER_STATUSES.has(led);
    const promote = real && PLACEHOLDER_STATUSES.has(status.trim());
  /* LED's outcome vocabulary → the ingest's code. Only the codes other logic
     branches on today: ขายได้ = sold, ไม่มีผู้สู้ราคา = no-bid deepens the
     ladder (lib/price.ts), งดขายในนัดที่เหลือ = the court pulled the sale from
     every remaining นัด — the ingest's own code 26 (test/pricing.js), so the
     panel's กำลังขาย does not sit on a listing LED has already called off.
     ผบE.4642/2568 lot 10489: all six live นัด carry the report's verdict on
     led_label while their own label is the placeholder — without 26 here the
     chip stays กำลังขาย with a countdown to a sale that will not happen.
     Anything else keeps the row's own code. */
    const code = promote
      ? (led.startsWith('ขายได้') ? 1
        : led.includes('ไม่มีผู้สู้ราคา') ? 3
        : led.startsWith('งดขายในนัดที่เหลือ') ? 26
        : r.status_code ?? null)
      : r.status_code ?? null;
    return {
      date: isoTs(r.date),
      /* The label from the database is authoritative; "รอประกาศ" arrives here for
         an undated round and the panel blanks that cell rather than printing it. */
      status: promote ? led : status,
      statusCode: code,
      price: r.price ?? null,
      discountPct: r.discount_pct ?? null,
      /* The winning bid LED's report sheet printed for this round (028) — only
         present on ขายได้ rounds, and only on a server that has ledReport.js. */
      soldPrice: r.sold_price ?? null,
      /* The report sheet's own outcome word for this round (029). History rows
         born from the report carry it as their only label; the panel shows it as
         a second line whenever it disagrees with the lists label. */
      ledLabel: r.led_label ?? null,
      /* Ingest provenance — lists slot number vs report row (null). */
      idx: r.idx ?? null,
      /* The round's own row id — the admin editor writes a price fix against
         it; null when the payload came from an older server. */
      roundId: (r.id as number | null) ?? null,
    };
  });
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
  /* Rounds whose outcome is the sale's end: ขายได้ (won by a bidder),
   * ถอนการยึด (the court withdrew the seizure), and งดขายในนัดที่เหลือ (LED
   * suspended the remaining sessions, e.g. ผบE.2311/2566 "…คู่ความแถลงงด" -
   * LED appends the reason, so the match is substring). Previous rounds plus
   * the terminal round's own point plot; anything the ledger prints behind
   * them is not a market the money ever reached. Plain งดขาย — and งดขายไม่มีผู้สู้ราคา
   * with it — is deliberately NOT here: a suspended round is followed by a
   * real next round, so their points keep flowing, and a case whose every row
   * is งดขาย still plots every one of them. */
  const terminal = (s: string) =>
    s.includes('ขายได้') || s.includes('ถอนการยึด') || s.includes('งดขายในนัดที่เหลือ');
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (r.date != null) {
      const v = r.soldPrice ?? r.price;
      if (v != null) {
        roundToHist[i] = pts.length;
        pts.push({ d: r.date, v });
      }
    }
    if (terminal(r.status)) break;
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
function mapEvents(status: Status, rounds: SellRound[], roundToHist: number[], hist: HistPoint[], announceTs: number): PriceEvent[] {
  const out: PriceEvent[] = [];
  /* The announce badge sits on the announcement's own point — not blind idx 0.
     A case LED suspended-and-relisted carries older report rounds before the
     current announce date, so the oldest point is a history row; stamping
     ประกาศขาย on it told the user the 2025 committee round was an announcement. */
  const announceAt = hist.findIndex((pt) => pt.d === announceTs);
  /* Resolved through the accent store, not a fixed lime hex: the pill must ride
     whatever primary the active theme (or the user's colour pick) resolves to. */
  const acc = effectiveAccent();
  out.push({ idx: announceAt >= 0 ? announceAt : 0, label: 'ประกาศขาย', color: acc, ink: inkOn(acc) });
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
 * the server's own close_reason (court lifted the attachment). The listing's
 * own rows decide (listingRounds): last cycle's no-sale report rows must not
 * vote a fresh listing down. */
export const neverOnMarket = (rounds: SellRound[]): boolean => {
  const listing = listingRounds(rounds);
  return listing.length > 0 && listing.every(noSaleRound);
};

/* The report's งดขายในนัดที่เหลือ rides led_label with code 0 on the lists'
 * own placeholder rows (ผบE.4642/2568 10489); the ingest stamps code 26 for
 * the same verdict when it meets the row on a report table (9638). Every
 * dated round closed that way is a listing LED has removed from the market —
 * ยกเลิกการขาย, not กำลังขาย, before any countdown renders. */
/* The listing's own rows vote on the listing's status; the report-history rows
 * before the current cycle do not. The ingest marks the boundary itself:
 * lists-row slots of the sale order still on the page carry `idx` (1..N), while
 * rows born from the report sheet (ผบ.29/2567's six 2025 งดขายไม่มีผู้สู้ราคา
 * rounds) ride idx null. 32581: every นัด of the CURRENT listing closed on the
 * report's งดขายในนัดที่เหลือ (code 26 after the placeholder promotion), so the
 * chip is ยกเลิกการขาย — but all-dated.every() also counted the 2025 code-10
 * history and kept the chip กำลังขาย. Listing rows only. A lot with no
 * idx-marked rows at all (a listing that exists only as report rows, the
 * 9638-of-2025 shape) IS all history, so the fallback keeps the whole dated set
 * and batch-2's behaviour survives. */
const listingRounds = (rounds: SellRound[]): SellRound[] => {
  const dated = rounds.filter((r) => r.date != null);
  const listed = dated.filter((r) => r.idx != null);
  return listed.length ? listed : dated;
};

export const listingCancelled = (rounds: SellRound[]): boolean =>
  listingRounds(rounds).length > 0 && listingRounds(rounds).every((r) => r.statusCode === 26);

function mapStatus(raw: string | null, rounds: SellRound[]): Status {
  if (raw === 'sold' || raw === 'inactive' || raw === 'cancelled') return raw;
  if (raw === 'sale' && listingCancelled(rounds)) return 'cancelled';
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
  /* 312583: the report sheet stamps the FINAL outcome on every remaining นัด
     row of the listing — six ขายได้ rows here — and one of them (idx1, the
     round the chart breaks at and the ขายออก event anchors on) still carried
     an earlier read's echo, 850,000 where the report's own answer (and the
     lot-level soldPrice) say 790,000. So the last code-1 round inherits the
     lot-level figure BEFORE the history is built — but only inside the
     current listing: a pre-announce code-1 row belongs to an earlier sale
     order with its own reported price (221345-style relist), which a relist
     must not rewrite. The code-1 sold/fallback derivation below is untouched
     (it keys on the code, not the value). */
  if (p.soldPrice != null) {
    for (const r of rounds) {
      if (r.statusCode === 1 && r.date != null && r.date >= announceTs) {
        r.soldPrice = p.soldPrice as number | null;
      }
    }
  }
  const status = mapStatus(p.status, rounds);

  /* LED's committee figure (ราคาที่กำหนดโดยคณะกรรมการกำหนดราคาทรัพย์), merged
   * led-first — the NAS dataset is exactly where committee_price holds a
   * distinct wrong floor: ผบ.2545/2562 carries 80,177,600 there, which is the
   * จปฐ officer appraisal the biddata scrape wrote into the column, while
   * LED's own committee value is 98,329,928. The officer's number never stands
   * in for the committee; it shows under its own ราคา เจ้าพนักงานบังคับคดี
   * label. */
  const led = p.ledPrice ?? null;
  const committeePrice = led != null && led > 0
    ? led
    : p.committeePrice != null && p.committeePrice > 0 ? p.committeePrice : null;

  /* Everything that reads a "start price" anchors on the committee figure when
   * LED has one: the announce point (what the chart plots and the event log
   * prints), and through it startPriceOf() — the ladder base, the PRICE column,
   * the -10% badge and the sold lot's open price. The scraped start_price is
   * the biddata page's number and ผบ.2545 proved it can be the wrong source
   * (จปฐ appraisal 80,177,600 instead of committee 98,329,928), so it demotes
   * to the fallback for lots LED gives no committee figure for. */
  const startPrice = committeePrice ?? ((p.startPrice as number | null) ?? p.askingPrice);
  const { pts: hist, roundToHist } = mapHist(rounds, startPrice, announceTs, now);
  const lastPrice = hist.length ? hist[hist.length - 1].v : (p.askingPrice ?? 0);

  /* led / committeePrice were merged above, ahead of startPrice, because the
   * announce anchor leads with the committee figure too. The headline order:
   *   sold — ราคาขายได้, what the winner actually paid (ผบE.390/2568 sold at
   *          1,540,000 while the ladder's round price holds the scheduled
   *          1,185,780 floor LED corrected). An unsynced server sends null
   *          and the sold views print '-' rather than paste the floor as a
   *          sale.
   *   led  — the committee figure (ผบ.2545/2562 is 98,329,928 there, while its
   *          scheduled rounds carry the scraped 80,177,600 column).
   *   else the ladder's last point, as before. */
  const price = p.soldPrice ?? (led != null && led > 0 ? led : lastPrice);

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
    sizeRai: (p.sizeRai as number | null) ?? null,
    sizeNgan: (p.sizeNgan as number | null) ?? null,
    sizeWa: (p.sizeWa as number | null) ?? null,
    price,
    perWah: land != null ? Math.round(price / land) : null,
    /* The lot's own opening price (auction_lots.start_price) — the figure an
       admin edit must start from, before any ladder discount. p.price above is
       the sale-or-last-rung headline and was the wrong seed for the editor. */
    startPrice: p.startPrice ?? null,
    lng: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
    name: [p.assetType, p.tambon, p.landTitle].filter(Boolean).join(' ') || `แปลง ${p.id}`,
    deed: p.deed ?? '',
    province: p.provinceName ?? '',
    amp: p.districtName ?? p.amphur ?? '',
    tambon: p.tambon ?? '',
    announce: announceTs,
    soldTs: sold?.date ?? null,
    /* The server's lot-level winning bid, synced from LED's report sheet. The
       round-price fallback that used to sit here is gone on purpose: it pasted
       the scheduled floor as a sale for every unsynced sold lot. */
    soldPrice: p.soldPrice ?? null,
    /* Freshness: when the ingest last confirmed this lot still matches LED.
       Nothing shows when the server predates the column — a missing stamp
       cannot be rendered as an old one. */
    ledTs: isoTs(p.ledSeen),
    hist,
    events: mapEvents(status, rounds, roundToHist, hist, announceTs),
    /* Resale in LED's own vocabulary: this listing is on the market again after
       a winning bid was already printed inside it — the `sold` guard above is
       the most recent code-1 round. Determined from the rounds themselves, not
       a server column, because LED marks the relisting that way (a second sale
       order under the same case) and every earlier consumer of `resell` treated
       it as an attribute to be fixed later, which left ขายได้-then-back lots
       wearing a plain กำลังขาย. Not sold/inactive even when such a lot has
       already failed a relist round — those statuses come later and win. */
    resell: status === 'sale' && sold != null,
    imgs: p.imageCount ?? 0,
    /* Served URLs, already final on the server: '/img/land/<file>' for the
       bot's downloads, the stored link for admin-added rows. Prepending the
       mount here again double-prefixed paths into 404s — the alt-text state
       the carousel shows instead of a picture. The server is the one place
       that knows which shape a row is. */
    images: p.images ?? [],
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
    committeePrice,
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
export const ALL_PARCELS: Parcel[] = [];
export const PARCEL_BY_ID: Map<number, Parcel> = new Map();
export const getDataOrigin = (): DataSourceKind => origin;

let origin: DataSourceKind = 'loading';

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
 * Fetch real parcels. There is no fixture fallback any more: a failed fetch
 * publishes an empty collection with kind 'error', and the banner (not fake
 * land) tells the user why the map is empty. Resolving rather than throwing
 * keeps the refresh flow simple.
 */
export async function loadParcels(provinceCode?: number): Promise<{
  kind: DataSourceKind; count: number; error: string | null;
  /** Rows the resolvers could not confirm; kept out of the map and table. */
  hidden?: number;
}> {
  const q = provinceCode != null ? `?province=${provinceCode}` : '';
  const r = await api.get<{ features: Feature[] }>(`/api/parcels${q}`);

  if (!r.ok || !r.data?.features) {
    publish([], 'error');
    return { kind: 'error', count: 0, error: r.error ?? null };
  }

  const now = Date.now();
  /* The น.ส.3 class titles (น.ส.3ก., น.ส.3เลขที่…) are titled land LED carries
     for completeness — not auction assets priced like ฉ.4, and the project has
     deliberately parked the class. The server drops them at the SQL layer
     (WHERE land_title NOT ILIKE '%น.ส.3%'); this mirror keeps an older server
     from leaking them back through the same /api/parcels route. */
  const feats = r.data.features.filter((f) => !f.properties.landTitle?.includes('น.ส.3'));
  const rows = feats.map((f) => featureToParcel(f, now)).filter((p): p is Parcel => p != null);

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
  /* Hidden = everything the features carried but the UI will not: unresolved
     deeds and น.ส.3 titles together. Counted from the raw feature list so a
     title excluded here cannot be counted twice. */
  return { kind: 'api', count: visible.length, error: null, hidden: r.data.features.length - visible.length };
}

/** Subscribe to "the parcel collection was replaced". */
export const subscribeParcels = onChange;

/**
 * Refresh ONE parcel from the API.
 *
 * The detail panel fires this when it opens a parcel, and `?id=` on the server
 * doubles as the on-demand LED report sync, so a click on a never-synced case
 * pulls that case's report sheet - the real winning bid and the per-round
 * ผลการขาย - and the panel shows it now rather than after the next full
 * reload. The fetched rows replace the entry in place, keeping ALL_PARCELS and
 * PARCEL_BY_ID as the only live collections and letting subscribers repaint
 * through the same listener set publish() uses.
 */
export async function refreshParcel(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) return;
  const r = await api.get<{ features: Feature[] }>(`/api/parcels?id=${id}`);
  if (!r.ok || !r.data?.features) return; /* keep what is on screen */
  const now = Date.now();
  const next = r.data.features
    .map((f) => featureToParcel(f, now))
    .filter((p): p is Parcel => p != null)
    .find((p) => p.id === id);
  if (!next) return;
  const i = ALL_PARCELS.findIndex((p) => p.id === id);
  if (i < 0) return; /* the province was switched mid-flight; the next load owns it */
  ALL_PARCELS[i] = next;

  reindex();

  listeners.forEach((fn) => fn());
}

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
