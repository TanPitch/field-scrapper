import { Calendar, Crosshair, ImageOff, Link2, MapPin, ScanEye, Wrench, MoreHorizontal } from 'lucide-react';
import { getMap } from '../../map/mapRef';
import { useTipProps } from '../ui/Tip';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { STATUS } from '../../data/constants';
import { ALL_PARCELS, PARCEL_BY_ID, refreshParcel, subscribeParcels } from '../../data/liveData';
import { useMoney } from '../../hooks/useMoney';
import { fdate, fmtRai, numDate, sizeRowLabel } from '../../lib/format';
import { popupKind } from '../../map/popups';
import { patchApp, useApp } from '../../store/useApp';
import { select } from '../../store/actions';
import { useLightbox } from '../../store/useLightbox';
import type { Parcel } from '../../types';
import { PriceChart } from '../charts/PriceChart';
import { RangeSlider } from '../charts/RangeSlider';
import { DateButton } from '../ui/DateButton';
import { LandKindIcon } from '../ui/LandKindIcon';
import { pickBtn, pillCls } from '../ui/styles';
import { Select } from '../ui/Select';
import { PriceHeadline } from './PriceHeadline';
import { ReportButton } from './ParcelReport';
import { DetRows, DetSub, DetTop, VPad } from './shared';
import { orderRows } from '../../lib/detailRows';

/* The old mockup-era roundStatus fabricator (seed % 4 → 'ไม่มีผู้ซื้อ' over
   'กำลังขาย'/'ประกาศขาย' rows) is gone: real round rows already carry LED's own
   outcome label from the ledger — a seeded stamp over invented statuses was
   exactly the kind of "16 rounds that never happened" noise to stop. The cell
   below renders r.status as-is. */

/* กรมธนารักย์ gave us no figure. Say which kind of "no" it is, because the two
   mean very different things: a skipped layer is a known blind spot, an
   unresolved lookup is a genuine gap someone might still be able to close. */
/* LED's placeholder labels — round rows that exist in the schedule but have no
   result to report. They are rendered as an empty cell instead, because the
   phrase reads as a status when it is really the absence of one.
   Both spellings appear in real data: รอประกาศ on some listings,
   ยังไม่มีการเปิดประมูล on others. */
const PLACEHOLDER_STATUSES = new Set(['รอประกาศ', 'ยังไม่มีการเปิดประมูล']);
const isPlaceholderStatus = (s: string): boolean => PLACEHOLDER_STATUSES.has(s.trim());

/* Sale-order grouping. LED re-lists land after a failed sale and its นัด count
   restarts from 1, so one flat 1..N down the whole history misrepresents the
   table (ผบ.754/2562 carries six separate sale orders).

   The listing boundary is provenance, not dates: the ingest gives every
   lists-schedule row a slot number (idx) and leaves report-history rows with
   idx null (ผบE.3247/2567 lot 221345: 12 report rows then the live listing's
   own 6). Partitioning on idx is exact; the announce date only ever knew when
   LED published, not which row belongs to what, and when the publish point
   does not line up with the first นัด (221345's 19/06 publish vs 19/08 first
   นัด) it planted the previous order's tail inside the live one.

   Report rows (idx null) still split among themselves by the two date gaps
   that survived what the data said:
     gap    — longer than 60 days between consecutive dated rounds; LED's own
              นัด spacing inside one order runs weeks while resell gaps measure
              months.
     adjacent — closer than 14 days. LED's minimum in-listing spacing is ~21
              days, so a near-adjacent pair is a relist landing right after the
              old order's last นัด (221345: last A round 10/03, first B round
              13/03 — a 3-day gap no 60-day rule would ever split).
   Lots ingested before the idx column existed have no provenance at all; for
   them the old announce-crossing rule stays as the fallback. That is why the
   `announced` parameter survives.

   Letters count up from the OLDEST order (A, B, C …); the newest order — the
   one still live — keeps plain numbers. Same-day rounds stay in one order:
   only a positive sub-14-day gap is a relist, a 0 gap is duplicate rows. */
const SALE_ORDER_GAP = 60 * 864e5;
const SALE_ORDER_ADJACENT = 14 * 864e5;

export interface OrderRound { date: number | null; idx?: number | null }

/** Exported for the probe check (bun) — same testable-pure-function pattern as
 *  server/mapStatus.js. Rendering stays in the component. */
export function saleOrderLabels(
  rounds: OrderRound[],
  announceTs?: number | null,
): { text: string; plain: string; prev: boolean; sep: boolean }[] {
  /* Provenance mode: at least one row was born from the lists schedule. */
  const hasIdx = rounds.some((r) => r.idx != null);
  const order: number[] = [];
  let g = 0;
  let listingOpen = false;
  let prev: number | null = null;
  rounds.forEach((r) => {
    if (hasIdx) {
      /* Provenance split only holds while the invariant "lists rows = the
         current listing" is true (the 2026-11-02 ingest guarantees it). The
         October full-sweep stamped idx 1..N over the WHOLE printed schedule
         instead — lot 10626 carries 54 lists rows from 2020 onward — so that
         lot rendered one flat order. The rebounds: a lists row dated BEFORE
         the listing's own publish point cannot be part of the current
         listing (LED publishes before the first live นัด), so it joins the
         history partition with the report rows and splits on the same two
         date-gap rules. This is the fallback the announce dates used to run,
         now fenced off to only the rows that claim to be the listing. The
         current listing itself still opens once and never splits — a งดขาย
         suspension past 60 days inside it stays one order. */
      if (r.idx != null) {
        if (r.date != null && announceTs != null && r.date < announceTs) {
          if (prev != null) {
            const gap = r.date - prev;
            if (gap > SALE_ORDER_GAP || (gap > 0 && gap < SALE_ORDER_ADJACENT)) g++;
          }
        } else {
          if (!listingOpen) { g++; listingOpen = true; }
        }
      } else if (r.date != null) {
        /* Gap-split among the report rows only. */
        if (prev != null) {
          const gap = r.date - prev;
          if (gap > SALE_ORDER_GAP || (gap > 0 && gap < SALE_ORDER_ADJACENT)) g++;
        }
      }
      /* A dateless report row keeps its group, and a report row dated after a
         live-listing row would be ingest corruption (ledReport inserts history
         strictly before the lists' minimum date) — it stays put rather than
         inventing an order. */
      order.push(g);
      if (r.date != null) prev = r.date;
      return;
    }
    if (r.date != null) {
      if (prev != null) {
        const entering = announceTs != null && prev < announceTs && r.date >= announceTs;
        const inListing = entering || (announceTs != null && prev >= announceTs);
        if (!inListing) {
          const gap = r.date - prev;
          if (gap > SALE_ORDER_GAP || (gap > 0 && gap < SALE_ORDER_ADJACENT)) g++;
        }
        if (entering) g++;
      }
      prev = r.date;
    }
    order.push(g);
  });
  const within: number[] = [];
  let n = 0;
  order.forEach((cur, i) => {
    n = i > 0 && order[i - 1] !== cur ? 1 : n + 1;
    within.push(n);
  });
  return order.map((cur, i) => ({
    text: cur === g ? `${within[i]}` : `${String.fromCharCode(65 + cur)}${within[i]}`,
    plain: `${within[i]}`,
    prev: cur !== g,
    /* True on the first row of each later sale order — the เส้นประแบ่งกลุ่มรอบ
       setting draws its dashed divider only under a row like this. */
    sep: i > 0 && order[i - 1] !== cur,
  }));
}

/* The status cell shows whatever LED reported, clipped to one line. LED's
   outcome is one canonical phrase followed by a qualifier the cell has no room
   for — มาตรา 309, which นัด the result came from — so the phrase goes into
   the cell and the hover tip carries the qualifier. Longest first: งดขาย must
   match only after every fuller งดขาย… phrase has had its chance. A phrase
   that matched is a deliberate prefix, so the rest is safe to expose as the
   tip; anything that matched nothing is left alone (the ellipsis already
   clips it, and we cannot guess where its phrase ends). */
const STATUS_HEADS = [
  'งดขายในนัดที่เหลือ',
  'งดขายไม่มีผู้สู้ราคา',
  'งดขาย(ส่ง)ประกาศมิชอบ',
  'งดขาย (ส่ง)ประกาศมิชอบ',
  'งดขายส่งประกาศมิชอบ',
  'งดขาย (ป.วิ.อ.แพ่ง มาตรา 309)',
  'งดขาย(ป.วิ.อ.แพ่ง มาตรา 309)',
  'โจทก์แถลงงดขาย',
  'ถอนการยึด',
  'ขายได้',
  'งดขาย',
];

export function splitStatus(s: string): { head: string; rest: string } {
  const t = s.trim();
  for (const ph of STATUS_HEADS) {
    if (t.startsWith(ph)) return { head: ph, rest: t.slice(ph.length).trim() };
  }
  return { head: t, rest: '' };
}

const tdStatusShort = (s: string): string =>
  s.startsWith('skipped') ? 'ไม่มีในชั้นข้อมูลนี้' : 'ยังไม่พบข้อมูล';

const tdStatusHint = (s: string): string =>
  s.startsWith('skipped')
    ? 'ชั้นข้อมูลโฉนดของกรมธนารักย์ไม่มีเอกสารประเภทนี้ (เช่น น.ส.3ก.) — เป็นข้อจำกัดของแหล่งข้อมูล ไม่ใช่ข้อมูลที่หายไป'
    : 'ค้นแล้วไม่พบแปลงที่ตรงกับเลขที่และตำบล — อาจต้องตรวจสอบด้วยตนเอง';

export const landImg = (p: Parcel, i: number, _w?: number, _h?: number): string | null => p.images?.[i] ?? null;
const cbn = 'absolute top-1/2 z-[3] grid size-[30px] -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/25 bg-black/45 font-display text-lg leading-none text-white backdrop-blur hover:bg-black/70';

function Carousel({ p }: { p: Parcel }) {
  const n = p.imgs;
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const sx = useRef<number | null>(null);
  const show = useLightbox(s => s.show);
  const go = (k: number) => setI((k + n) % n);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-cbn]')) return;
    sx.current = e.clientX; setDx(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => { if (sx.current != null) setDx(e.clientX - sx.current); };
  const end = () => {
    if (sx.current == null) return;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    else if (Math.abs(dx) < 8) show(i);
    sx.current = null; setDx(0);
  };

  /* Some lots genuinely have no photograph. LED publishes a photo and a survey
     image for most lots but a map image only for some, so "no image" is normal
     and needs its own state — an empty frame, or a broken <img>, reads as a bug
     and hides the fact that there was nothing to show. */
  if (n <= 0) {
    return (
      <div
        className="mb-2.5 grid h-[150px] place-items-center rounded-[10px] border border-dashed border-line2 bg-panel2 text-center"
        {...useTipProps('ประกาศนี้ไม่มีรูปภาพ')}
      >
        <div className="px-6">
          <ImageOff size={22} className="mx-auto mb-1.5 text-dim2" />
          <div className="text-[11.5px] font-medium text-dim">ไม่มีรูปภาพ</div>
          <div className="mt-0.5 font-display text-[10px] text-dim2">กรมที่ดินยังไม่ได้แนบภาพประกาศนี้</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative mb-2.5 h-[150px] cursor-grab touch-pan-y overflow-hidden rounded-[10px] border border-line2 bg-panel2 active:cursor-grabbing"
      {...useTipProps('คลิกเพื่อขยายภาพ')}
      onPointerDown={n > 1 ? down : undefined} onPointerMove={n > 1 ? move : undefined}
      onPointerUp={n > 1 ? end : undefined} onPointerCancel={n > 1 ? end : undefined}
      onClick={n <= 1 ? () => show(0) : undefined}
    >
      <div
        className={`flex h-full ${sx.current == null ? 'transition-transform duration-[280ms] ease-panel' : ''}`}
        style={{ transform: `translateX(calc(${-i * 100}% + ${dx}px))` }}
      >
        {Array.from({ length: n }, (_, k) => {
          const src = landImg(p, k);
          return (
            <span key={k} className="relative block h-full w-full flex-[0_0_100%]">
              {src
                ? <img src={src} alt={`ภาพแปลงที่ดิน ${k + 1}`} draggable={false} className="pointer-events-none h-full w-full select-none object-cover" />
                /* Listed but not fetched, or the file is missing on disk. Kept
                   distinct from "this lot has no image" so one broken path does
                   not make a real lot look empty. */
                : <span className="grid h-full w-full place-items-center bg-panel2 text-[10.5px] text-dim2">
                    <ImageOff size={16} className="mb-1" />ไม่พบไฟล์ภาพ
                  </span>}
            </span>
          );
        })}
      </div>
      {n > 1 && (
        <>
          <button data-cbn className={`${cbn} left-2`} {...useTipProps('ภาพก่อนหน้า')} onClick={() => go(i - 1)}>‹</button>
          <button data-cbn className={`${cbn} right-2`} {...useTipProps('ภาพถัดไป')} onClick={() => go(i + 1)}>›</button>
          <div className="absolute inset-x-0 bottom-2 z-[3] flex justify-center gap-[5px]">
            {Array.from({ length: n }, (_, k) => (
              <span key={k} data-cbn onClick={() => go(k)} className={`size-1.5 cursor-pointer rounded-full transition ${k === i ? 'scale-125 bg-accent' : 'bg-white/40'}`} />
            ))}
          </div>
        </>
      )}
      <span className="pointer-events-none absolute right-2 top-2 z-[3] rounded-full bg-black/50 px-2 py-0.5 font-display text-[10px] font-semibold text-white backdrop-blur">{i + 1}/{n}</span>
    </div>
  );
}

function RangeRow() {
  const r = useApp(s => s.chartRange);
  const pill = pillCls(!r, true);
  return (
    <div className="mb-2 mt-0.5 flex flex-wrap items-center gap-1.5">
      <button className={pill} onClick={() => patchApp({ chartRange: null })}>ทั้งหมด</button>
      <DateButton
        className={`${pickBtn} !min-w-0`} value={r?.min}
        onPick={ts => patchApp({ chartRange: { min: ts, max: Math.max(ts, useApp.getState().chartRange?.max ?? Date.now()) } })}
      >
        <span className="flex-1">{r ? numDate(r.min) : 'ตั้งแต่'}</span><Calendar size={12} className="text-dim2" />
      </DateButton>
      <DateButton
        className={`${pickBtn} !min-w-0`} value={r?.max}
        onPick={ts => {
          const end = ts + 864e5 - 1, cur = useApp.getState().chartRange;
          patchApp({ chartRange: { min: Math.min(cur?.min ?? ts, end), max: end } });
        }}
      >
        <span className="flex-1">{r ? numDate(r.max) : 'ถึง'}</span><Calendar size={12} className="text-dim2" />
      </DateButton>
    </div>
  );
}

export function DetailView() {
  const id = useApp(s => s.selectedId);
  const popColors = useApp(s => s.popColors);
  const reColor = useApp(s => s.reColor);
  const fmt = useMoney();
  /* every hook must run before the early return below */
  const showKindIcon = useApp(s => s.showLandKindIcon);
  const highlightSold = useApp(s => s.highlightSoldRounds);
  const hidePrev = useApp(s => s.hidePrevSaleRounds);
  /* นัดที่ grouping: on = A1/B1 letters per sale order, off = plain 1..N. */
  const groupRounds = useApp(s => s.roundGroupLabels);
  const rowOrder = useApp(s => s.detailRowOrder);
  const rowHidden = useApp(s => s.detailRowHidden);
  /* Parcels the court is selling with this one (LED group sale); select() fills
     and clears it around every selection. */
  const groupIds = useApp(s => s.groupIds);
  const roundsPreview = useApp(s => s.roundsPreview);
  const roundsGroupBorder = useApp(s => s.roundsGroupBorder);
  const isAdmin = useApp(s => s.role === 'admin');
  const editOpen = useApp(s => s.editOpen);
  /* Which unit of a condominium building this panel is showing.
     null means "whatever the map picked", which is the representative unit, so
     opening a dot shows the same unit the user clicked rather than whichever
     happens to sort first. Picking from the cycler overrides it. */
  const [picked, setPicked] = useState<Parcel | null>(null);
  const base = id != null ? PARCEL_BY_ID.get(id) : undefined;
  const p = picked ?? base;

  /* Siblings sharing this building's parcel. One cadastral parcel sold as
     several units means the table lists each unit while the map draws one dot;
     this is what lets the panel step between them. Grouped on the same parcel
     key the marker layer uses, so the dot and the panel cannot disagree. */
  const units: Parcel[] = base
    ? ALL_PARCELS.filter((x: Parcel) =>
        (base.parcelKey != null && x.parcelKey === base.parcelKey)
        || (x.lng === base.lng && x.lat === base.lat))
    : [];
  /* Reset the override when the selection moves to another building, or a stale
     unit from the previous dot would keep being shown. */
  useEffect(() => { setPicked(null); }, [id]);

  /* One refresh per selection. `?id=` on the server doubles as the on-demand
     LED report sync — the case's report sheet carries the winning bid and the
     per-round ผลการขาย the page scrape flattened — and the returned row
     replaces this parcel in place, so the panel shows LED's numbers right
     after the click instead of after the next reload. In flight the current
     snapshot keeps rendering; a ~3s first click with no spinner is fine.
     Parcels publish in place, so the panel needs its own subscription to
     repaint on the refresh. */
  const [, setRev] = useState(0);
  useEffect(() => subscribeParcels(() => setRev(v => v + 1)), []);
  useEffect(() => { if (id != null) void refreshParcel(id); }, [id]);

  const [morebuttonsOpen, setMoreButtonsOpen] = useState(false);
  /* trigger + the popup pill it opens — both stay open, anything else closes */
  const moreRef = useRef<HTMLDivElement>(null);
  useOutsideClose([moreRef], () => setMoreButtonsOpen(false), morebuttonsOpen);

  if (!p) {
    return (
      <div className="px-6 py-11 text-center text-[12.5px] leading-[1.8] text-dim">
        ยังไม่ได้เลือกแปลง<br />
        <span className="text-[11px] text-dim2">คลิกจุดบนแผนที่ แถวในตาราง หรือผลการค้นหา เพื่อดูรายละเอียดและกราฟราคา</span>
      </div>
    );
  }
  const now = Date.now();
  /* Next selling round = first dated round that has not happened yet; rows with no date
     are still "not yet scheduled" and are used only as a fallback. */
  const upcoming = p.rounds.filter(r => r.date != null && r.date >= now).sort((a, b) => (a.date as number) - (b.date as number))[0];
  const pending = p.rounds.find(r => r.date == null);
  void pending;
  const daysLeft = upcoming != null ? Math.ceil(((upcoming.date as number) - now) / 864e5) : null;
  const hasUpcoming = daysLeft != null && daysLeft <= 10;
  const kind = popupKind(p);
  /* The chip rides the status colour map through popupKind: the resale kind
     ('re') gets its own colour, and 'sale'/'sold'/'cancelled'/'inactive' read
     the same user-tuneable palette the map dots use. The old inline ternary
     let a resale lot wear the sale red under a black dot on the map. */
  const chipBg = popColors[kind] ?? '#2A2F2A';
  const chipInk = '#fff';
  /* Rounds that actually have a date — see the rounds table below. */
  const elev = p.elevation ?? null;
  /* Only rounds LED has actually dated — see the rounds table below. */
  const scheduledRounds = p.rounds.filter((r) => r.date != null);
  /* นัดที่ label per round, plus which rows belong to earlier sale orders.
     The announce point anchors which order is the current one — see
     saleOrderLabels. */
  const roundLabels = saleOrderLabels(scheduledRounds, p.announce);

  /* LED's committee-set price (ราคาที่กำหนดโดยคณะกรรมการกำหนดราคาทรัพย์) reaches
     this component already merged in liveData: led_price first — that is LED's
     own committee figure, and the NAS dataset is exactly where committee_price
     holds a distinct wrong floor, which is what kept printing 80,177,600 where
     the user reads 98,329,928 (ผบ.2545/2562) — then the scraped committee_price
     column when it carries a figure of its own. The officer's number never
     stands in here: ราคาประเมินของเจ้าพนักงานบังคับคดี is a different field
     with its own row below, and printing it under the committee label was the
     very labelling the user called wrong. */
  const committeePrice = p.committeePrice != null && p.committeePrice > 0 ? p.committeePrice : null;

  /* Index of the round the lot sold at, from LED's status code 1. Falls back to
     the first round LED marks as a sale by label, because a parcel can arrive
     from a fixture without status codes. -1 means "not found". */
  function soldFrom(parcel: Parcel): number {
    const byCode = parcel.rounds.findIndex((r) => r.statusCode === 1);
    if (byCode >= 0) return byCode;
    return parcel.rounds.findIndex((r) => r.status.includes('ขายออกแล้ว'));
  }

  const td = p.td;
  const mortgage = p.mortgage;
  const em = elev?.m;
  const eu = elev?.uncertaintyM ?? null;
  const eSrc = elev?.source ?? null;
  /* Assessed value, or the reason there is not one. Written as statements rather
     than a nested ternary because inside the array literal the `td` narrowing
     did not survive and every read needed re-guarding. */
  const tdRow: [string, ReactNode][] = [];
  if (td) {
    if (td.perSqWa != null) tdRow.push(['ราคาประเมิน (กรมธนารักย์)', <>{fmt(td.perSqWa)} / ตร.วา</>]);
    else if (td.status != null) tdRow.push(['ราคาประเมิน (กรมธนารักย์)', <span {...useTipProps(tdStatusHint(td.status))} className="text-dim2">{tdStatusShort(td.status)}</span>]);
  }
  const detRows: [string, ReactNode][] = [
          ['ที่ตั้ง', `${p.tambon} ${p.amp} ${p.province}`],
          ['ประเภททรัพย์', p.propertyType],
          ['หมายเลขคดี', p.caseNo],
          ['เลขที่โฉนด', p.deedNo],
          [sizeRowLabel(p.sizeUnit), `${fmtRai(p.wah, p.sizeUnit)}`],
          ...tdRow,
          ['ระวาง', td?.rawang],
          ['หลักประกัน', fmt(p.collateral)],
          ...(p.spouseCollateral != null ? [['คู่สมรส หลักประกัน', fmt(p.spouseCollateral)] as [string,string]] : []),
          ...(p.expertPrice != null && p.expertPrice > 0 ? [['ราคา ผู้เชี่ยวชาญ', fmt(p.expertPrice)] as [string,string]] : []),
          ...(committeePrice != null ? [['ราคาที่กำหนดโดยคณะกรรมการกำหนดราคาทรัพย์', fmt(committeePrice)] as [string,string]] : []),
          /* The officer's own figure still shows on its own row — hidden when
             it IS the committee row (fallback above), because printing one
             number twice under two names explains nothing. */
          ...(p.enforcementOfficerPrice != null && p.enforcementOfficerPrice > 0 && p.enforcementOfficerPrice !== committeePrice
            ? [['ราคา เจ้าพนักงานบังคับคดี', fmt(p.enforcementOfficerPrice)] as [string,string]] : []),
          ...(p.assessorPrice != null && p.assessorPrice > 0 ? [['ราคา เจ้าพนักงานประเมินราคา', fmt(p.assessorPrice)] as [string,string]] : []),
          // ['การขายรอบถัดไป', nextRound?.date != null ? `${fdate(nextRound.date)} · ${nextRound.status}` : (nextRound?.status ?? '-')],
          ['วันที่ประกาศ', fdate(p.announce)],
          ...(p.soldTs ? [['วันที่ขายออก', fdate(p.soldTs)] as [string, string]] : []),
          ...(p.soldPrice != null ? [['ราคาที่ขายได้', fmt(p.soldPrice)] as [string, string]] : []),
          /* Freshness stamp — how long ago LED last confirmed this data. A row
             the scraper has not refreshed for months then reads as old, not
             as current fact. */
          ...(p.ledTs != null ? [['ข้อมูลจาก LED ณ', fdate(p.ledTs)] as [string, string]] : []),
          ...(mortgage ? [['ติดจำนอง', `${fmt(mortgage.amount)} — ${mortgage.bank}`] as [string,string]] : []),
                    /* Height is only meaningful where the coordinate is the parcel's own.
             For a subdistrict-centroid fallback the row says so instead of
             printing a number, because the centroid's height is not the land's. */
          ...(em != null
            ? [[
                'ความสูงจากระดับน้ำทะเล',
                <>
                  {em.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ม.
                  {eu != null && (
                    <span {...useTipProps(`ความแม่นยำ ±${eu} ม. · ${eSrc ?? 'DEM'}`)} className="ml-1 font-display text-[10px] text-dim2">
                      ±{eu}
                    </span>
                  )}
                </>,
              ] as [string, ReactNode]] as [string, ReactNode][]
            : []),
          ...(p.geoPrecision && p.geoPrecision !== 'parcel'
            ? [[
                'ตำแหน่งบนแผนที่',
                <span {...useTipProps('ยังไม่ได้พิกัดที่ตัวแปลง — ใช้จุดกึ่งกลางตำบลแทน เพื่อไม่ให้แปลงหายไปจากแผนที่')} className="text-dim2">
                  ประมาณจากตำบล (ยังไม่มีพิกัดแปลง)
                </span>,
              ] as [string, ReactNode]] as [string, ReactNode][]
            : []),
          /* Hand the parcel off to the map the user actually uses for a site
             visit. Both open in a new tab so the panel keeps its scroll and the
             working copy stays put. Street View needs heading/pitch to land on
             the right spot, so the parameters are spelled out rather than
             relying on the embed's default. */
          ['เปิดใน Google',
            <span className="flex flex-wrap gap-1.5">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                {...useTipProps('เปิด Google Maps ในแท็บใหม่')}
                className="inline-flex items-center gap-1 rounded-md border border-line2 bg-panel2 px-2 py-1 text-[11px] text-ink hover:border-line3"
              >
                <MapPin size={12} /> แผนที่
              </a>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}&heading=0&pitch=0&fov=90`}
                target="_blank"
                rel="noopener noreferrer"
                {...useTipProps('เปิด Street View ที่พิกัดนี้ในแท็บใหม่')}
                className="inline-flex items-center gap-1 rounded-md border border-line2 bg-panel2 px-2 py-1 text-[11px] text-ink hover:border-line3"
              >
                <ScanEye size={12} /> Street View
              </a>
            </span>,
          ] as [string, ReactNode],
  ];
  return (
    <div data-selectable>
    <VPad>
      {units.length > 1 && (
        <div className="mb-2 flex items-center gap-1.5 rounded-[9px] border border-line2 bg-panel2 px-2 py-1.5">
          <span className="whitespace-nowrap rounded-[4px] bg-accent/15 px-1.5 py-[2px] text-[10px] font-semibold text-accent">{units.length} รายการ</span>
          {/* Units of one building all carry the same parcel id, so they cannot
              be told apart by it - findIndex always answered 0 and the option
              keys collided. They are the same object references out of
              ALL_PARCELS, so position identifies which one is showing. */}
          <Select
            value={String(Math.max(0, units.indexOf(p)))}
            onChange={v => setPicked(units[Number(v)])}
            items={units.map((u, i) => ({
              v: String(i),
              l: `#${i + 1}/${units.length} · ${fmtRai(u.wah, u.sizeUnit)} · ${u.price > 0 ? fmt(u.price) : '-'}`,
            }))}
            className="min-w-0 flex-1 text-[11px]"
          />
          <button
            type="button" title="รายการก่อนหน้า" {...useTipProps(`รายการก่อนหน้า`)}
            onClick={() => {
              const i = Math.max(0, units.indexOf(p));
              setPicked(units[(i - 1 + units.length) % units.length]);
            }}
            className="size-[22px] flex-none rounded border border-line2 text-[12px] leading-none text-dim hover:border-line3 hover:text-ink"
          >‹</button>
          <button
            type="button" title="รายการถัดไป" {...useTipProps(`รายการถัดไป`)}
            onClick={() => {
              const i = Math.max(0, units.indexOf(p));
              setPicked(units[(i + 1) % units.length]);
            }}
            className="size-[22px] flex-none rounded border border-line2 text-[12px] leading-none text-dim hover:border-line3 hover:text-ink"
          >›</button>
        </div>
      )}

      <Carousel key={p.id} p={p} />
      <DetTop>
        <span className="rounded px-[9px] py-0.5 text-[10px] font-semibold" style={{ background: chipBg, color: chipInk }}>{STATUS[kind].th}</span>
        {/* data source + land kind badges */}
        <span
          {...useTipProps(`แหล่งข้อมูล`)}
          className="rounded border border-line2 bg-panel2 px-[9px] py-0.5 text-[10px] font-medium text-dim"
        >
          {p.dataSource}
        </span>
        {showKindIcon && (
          <span
            {...useTipProps(p.propertyType)}
            className="inline-flex items-center gap-1 rounded border border-line2 bg-panel2 px-[8px] py-0.5 text-[10px] font-medium text-dim"
          >
            <LandKindIcon kind={p.landKind} />
            {p.propertyType}
          </span>
        )}

        <div ref={moreRef} className="ml-auto relative inline-block">
          <button
            className="ml-auto inline-flex items-center gap-1 rounded border border-line2 bg-panel2 p-1 text-[10px] font-medium text-dim hover:border-line3 hover:text-ink"
            {...useTipProps('ซูม · รายงาน')}
            onClick={e => { e.stopPropagation(); setMoreButtonsOpen(v => !v); }}
          >
            <MoreHorizontal size={13} />
          </button>

          {morebuttonsOpen && (
            <div
              className="absolute right-0 top-full z-[99] mt-0.5 flex gap-0.5 rounded-[7px] border border-line2 bg-panel p-1 shadow-panel"
              onClick={e => e.stopPropagation()}
            >

              {/* Zoom straight back onto the parcel from wherever the user has panned
                  the map while reading the panel. Centered on the parcel's own
                  coordinate — a subdistrict-fallback dot now, but that is the dot the
                  map draws for it. */}
              <button
                type="button"
                {...useTipProps('ซูมแผนที่ไปยังแปลงนี้')}
                onClick={() => {
                  const map = getMap();
                  if (map && p.lat && p.lng) map.flyTo({ center: [p.lng, p.lat], zoom: 15.5, duration: 850 });
                }}
                className="grid size-[26px] place-items-center rounded-[5px] text-dim hover:bg-panel2 hover:text-ink"
              >
                <Crosshair size={12} />
              </button>

              <ReportButton p={p} />

              {/* Admin editor opens in its own small panel next to this one (EditPanel,
                  grid area `ep`) — it follows this selection, so no extra state. */}
              {isAdmin && (
                <button
                type="button"
                {...useTipProps('แก้ไขข้อมูล (แอดมิน)')}
                onClick={() => patchApp({ editOpen: !useApp.getState().editOpen })}
                className={`grid size-[26px] place-items-center rounded-[5px] ${
                  editOpen ? 'bg-accent-dim text-accent' : 'text-dim hover:bg-panel2 hover:text-ink'
                }`}
                >
                  <Wrench size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {units.length > 1 && (
          <span
            {...useTipProps(`มีอีก ${units.length} ที่ซ้อนกัน`)}
            className="rounded border border-line2 bg-panel2 px-[9px] py-0.5 text-[10px] font-medium text-dim"
          >
            x {units.length}
          </span>
        )}
      </DetTop>

      {/* Group sale ("ขายรวม"): the siblings are already ringed on the map and
          auto-selected — see groupOf() in actions.ts. The chip names them, and
          each deed is a link that moves the selection to that parcel, which
          the user could otherwise only reach by hunting for its dot. */}
      {groupIds.length > 1 && (
        <div className="mt-1.5 rounded-[9px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[11px] leading-[1.7]">
          <div className="flex items-center gap-1.5 font-semibold text-accent">
            <Link2 size={12} className="flex-none" />
            ขายรวมกลุ่ม {groupIds.length} แปลง — จะขายรวมกันในนัดนี้
          </div>
          <div>
            {groupIds.map((gid, i) => {
              const q = PARCEL_BY_ID.get(gid);
              if (!q?.deedNo) return null;
              return (
                <span key={gid}>
                  {i > 0 && ', '}
                  {gid === p.id ? <span className="text-dim">{q.deedNo}</span> : (
                    <button
                      type="button"
                      {...useTipProps('เลือกแปลงโฉนดนี้')}
                      className="text-accent underline decoration-dotted transition hover:decoration-solid"
                      onClick={() => select(gid)}
                    >
                      {q.deedNo}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {p.remark && <div className="mt-0.5 text-[10px] text-dim2">{p.remark}</div>}
        </div>
      )}

      {/* <DetName>{p.name}</DetName> */}

      <div className="mt-0.5">
        <PriceHeadline p={p} />
      </div>

      {/* Only for land still in an auction. Listing every non-sold status here
          was the bug: a scheduled round survives in the data after the court
          lifted the attachment, so ถอนการยึด and งดขายในนัดที่เหลือ both got a
          countdown to a sale that was never going to happen. Gating on the
          status rather than blacklisting the ones we know about means a status
          added later cannot leak through either. */}
      {hasUpcoming && upcoming?.date != null && (kind === "sale" || kind === "re") && (
        <div className="my-2 flex items-center gap-2 rounded-lg border border-accent bg-accent-dim px-3 py-2 text-[11.5px] font-semibold text-accent">
          <span className="flex-none rounded-full bg-accent px-2 py-[2px] font-display text-[10px] text-accent-ink">
            {daysLeft === 0 ? 'วันนี้' : `อีก ${daysLeft} วัน`}
          </span>
          จะมีการขายทรัพย์ — นัดวันที่ {numDate(upcoming.date)}
        </div>
      )}

      <ul>
        {p.events.length ? p.events.map(e => {
          const h = p.hist[e.idx];
          /* Defensive. The event log indexes the price history, and a lot can
             legitimately have an event with no matching point. Rendering the
             rest of the panel matters more than one log line, so skip it rather
             than take the whole panel down. */
          if (!h) return null;
          return (
            <li key={e.idx} className="flex items-center gap-2 pt-[5px] pb-[16px] text-[11.5px]">
              <span className="size-[7px] flex-none rounded-sm" style={{ background: e.label.includes('นำกลับมาขายใหม่') ? reColor : e.color }} />
              <span className="flex-1">{e.label}เมื่อ</span>
              <span className="font-display text-[10.5px] text-dim">{fdate(h.d)}</span>
              <span className="font-display text-[11px] font-semibold">{fmt(h.v)}</span>
            </li>
          );
        }) : <li className="flex justify-center py-[5px] text-[11.5px] text-dim2">ไม่มีเหตุการณ์สถานะพิเศษ</li>}
      </ul>

      <DetRows rows={orderRows(detRows, rowOrder, rowHidden)} />

      <div className="mb-2 mt-4 overflow-hidden rounded-[10px] border border-line bg-bg">
        <div className="grid grid-cols-[48px_1fr_1fr] bg-panel2 text-[11px] font-semibold">
          <div className="px-2 py-1.5">นัดที่</div>
          <div className="px-2 py-1.5">วันที่</div>
          {/* The resale-history switch lives here, over the column it acts on:
              earlier sale orders dim (opaque) or collapse (hide). Only offered
              when the lot actually has an earlier order. */}
          <div className="flex items-center justify-between px-2 py-1.5">
            <span>สถานะ</span>
            {roundLabels.some((l) => l.prev) && (
              <button
                type="button"
                className="rounded-md px-1.5 py-[1px] font-display text-[10px] text-dim2 hover:text-ink"
                onClick={() => patchApp({ hidePrevSaleRounds: !hidePrev })}
              >
                {hidePrev ? 'แสดงรอบก่อนหน้า' : 'ซ่อนรอบก่อนหน้า'}
              </button>
            )}
          </div>
        </div>
{/* Rounds LED has actually dated.
             A round with no date is not scheduled yet and carries no information,
             so the row is dropped rather than shown empty — that is why a lot
             with 6 real rounds shows 6 rows and not 8.
             Per column:
               date   — always shown; it is what places the round in time
               status — blank while the round is still ahead (announced, no
                       result yet), the real label once it has happened, and "-"
                       when LED only has its placeholder phrase to offer.
             "ยังไม่มีการเปิดประมูล" is never rendered verbatim: it reads as a
             status when it is really the absence of one. */}
        {scheduledRounds.length === 0 ? (
          <div className="border-t border-line px-2 py-3 text-center text-[11.5px] text-dim2">
            ยังไม่มีนัดวันขาย
          </div>
        ) : (
          /* The newest sale order always survives hidePrev (its rows are never
             `prev`), so the hidden state cannot empty the table. The map keeps
             the ORIGINAL index — soldFrom() indexes p.rounds, and roundLabels
             is built positionally over scheduledRounds. */
          /* พรีวิวรอบเก่า: a null preview (ทั้งหมด) keeps every round, otherwise
             only the newest N dated rounds across all sale orders survive. Each
             kept row holds its own order letter+number — an A4 after the trim
             is still that order's fourth round, not a renumbered one. */
          scheduledRounds
            .map((r, i) => ({ r, i, lab: roundLabels[i] }))
            .filter(({ i }) => roundsPreview == null || i >= scheduledRounds.length - roundsPreview)
            .filter(({ lab }) => !(hidePrev && lab.prev))
            .map(({ r, i, lab }) => {
            const future = r.date != null && r.date > now;
            /* Once a lot sells, everything from the selling round onward is
               dead: that round happened, and the ones after it never will.
               A future round is left alone even then — its status cell is empty,
               and tinting an empty cell red reads as though it had a status. */
            const sold = highlightSold && p.status === 'sold' ? soldFrom(p) : -1;
            const after = sold >= 0 && i >= sold && !future;
            /* Both tints hang off the same switch. With it off the table is
               uniform, so "no dimming" means genuinely none. Earlier sale
               orders dim only when the sold tint is not already speaking. */
            const cls = `${after ? 'bg-[#E5484D]/22 text-[#FFB4B4]' : lab.prev ? 'text-dim2' : ''} ${future && highlightSold ? 'text-dim2' : ''}`;
            /* What the cell actually says after the placeholder rule — ''
               or '-'. splitStatus then peels LED's canonical outcome phrase:
               งดขาย (ป.วิ.อ.แพ่ง มาตรา 309) shows its phrase in the cell and
               the มาตรา qualifier rides the hover tip instead of pushing the
               line to overflow. */

            const shown_pre = isPlaceholderStatus(r.status) ? (future ? '' : '-') : r.status;
            const shown = shown_pre;
            const st = splitStatus(shown);
            /* LED prints a group sale's verdict on the tables of only SOME of
               the siblings (ผบ.754/2562's งดขายไม่มีผู้สู้ราคา sits on 24653's
               rows alone; 161371's own table shows nothing for that date — the
               same reason its next-round price takes the sibling's verdict).
               When this lot's own cell is silent and the parcels share a
               ขายรวม group, the siblings' rows for the same date speak
               through the tip. */
            let sibTip: string | null = null;
            if (groupIds.length > 1 && (shown === '' || isPlaceholderStatus(r.status))) {
              const parts: string[] = [];
              for (const gid of groupIds) {
                if (gid === p.id) continue;
                const q = PARCEL_BY_ID.get(gid);
                const sr = q?.rounds.find((x) => x.date != null && x.date === r.date);
                if (q?.deedNo && sr) parts.push(`${q.deedNo} — ${isPlaceholderStatus(sr.status) ? '-' : sr.status}`);
              }
              if (parts.length) sibTip = `ขายรวมกัน: ${parts.join(' · ')}`;
            }
            /* The report sheet repeats the lists' verdict for the same date more
               often than not — งดขายในนัดที่เหลือ on the lists and
               งดขายในนัดที่เหลือ เปลี่ยนวิธีขาย on the report is ONE outcome.
               Same canonical phrase → the report's qualifier merges into the
               first line's hover tip and the ผลรายงาน line does not render
               (the lists' word stays the displayed status). A DIFFERENT
               phrase is news — ขายได้ against a งดขาย — and keeps its own
               second line. */
            const rl = r.ledLabel && r.ledLabel.trim() ? splitStatus(r.ledLabel) : null;
            const sameVerdict = rl != null && rl.head === st.head;
            const tipRest = sibTip ??
              ([st.rest, sameVerdict ? rl!.rest : null].filter(Boolean).join(' · ') || null);
            return (
              <div key={r.date ?? i} className={`grid grid-cols-[48px_1fr_1fr] border-t ${lab.sep && roundsGroupBorder ? 'border-dashed border-line2' : 'border-line'} text-[11.5px] ${cls}`}>
                {/* Group on = A2/B1 per sale order; group off = the plain
                    in-order count, the letters dropped. Both variants are the
                    same computation, so a settings flip never re-derives it. */}
                <div className="px-2 py-1.5">{groupRounds ? lab.text : lab.plain}</div>
                {/* The date is always shown — it is the one thing a reader needs
                    to place the round. Only a round LED has nothing to say
                    about goes quiet. */}
                <div className="px-2 py-1.5">{r.date != null ? numDate(r.date) : ''}</div>
                <div className="px-2 py-1.5">
                  {/* Whatever LED reported, shown. Blankness used to be decided by
                      the date - any round dated in the future lost its status cell -
                      and that hid real outcomes: LED publishes งดขาย against rounds
                      that have not arrived yet and its own page shows all six, so we
                      were showing 5 of 6 and 3 of 6 on those. A round is silent
                      because LED has nothing to say about it, not because it is
                      scheduled. Placeholder text is that signal, so it is the only
                      thing that decides this now; a real label is shown whether the
                      round has happened or not. The old seeded ไม่มีผู้ซื้อ fabricator
                      is gone — real rows carry LED's own label. */}
                  {/* One line per row: a long งดขาย phrasing scrolls the table,
                      so it clips with its ellipsis instead. */}
                  <span
                    className="block whitespace-nowrap overflow-hidden text-ellipsis"
                    {...(tipRest ? useTipProps(tipRest) : {})}
                  >
                    {st.head || shown}
                  </span>
                  {/* The report sheet's OWN verdict, shown only when it says
                      something different from the lists (= a different canonical
                      phrase). Same phrase = the qualifier already rode the tip. */}
                  {(() => {
                    if (!r.ledLabel || !r.ledLabel.trim()) return null;
                    const rl = splitStatus(r.ledLabel);
                    if (rl.head === st.head) return null;
                    return (
                      <span
                        {...useTipProps(rl.rest || 'ผลการขายจากรายงานของ LED — อ่านแยกจากป้ายนัดขาย')}
                        className="mt-[1px] block whitespace-nowrap overflow-hidden text-ellipsis text-[10px] leading-[1.35] text-dim2"
                      >
                        ผลรายงาน: {r.ledLabel.trim()}
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
      </div>
      <DetSub>กราฟราคาประวัติย้อนหลัง</DetSub>
      <RangeRow />
      <div className="rounded-[10px] border border-line bg-bg p-2">
        <div className="h-[170px]"><PriceChart parcel={p} /></div>
        <RangeSlider parcel={p} />
      </div>

    </VPad>
    </div>
  );
}
