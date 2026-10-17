import { Calendar, ImageOff, MapPin, ScanEye } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { STATUS } from '../../data/constants';
import { ALL_PARCELS, PARCEL_BY_ID } from '../../data/liveData';
import { useMoney } from '../../hooks/useMoney';
import { fdate, fmtRai, numDate } from '../../lib/format';
import { popupKind } from '../../map/popups';
import { patchApp, useApp } from '../../store/useApp';
import { useLightbox } from '../../store/useLightbox';
import type { Parcel } from '../../types';
import { PriceChart } from '../charts/PriceChart';
import { RangeSlider } from '../charts/RangeSlider';
import { DateButton } from '../ui/DateButton';
import { LandKindIcon } from '../ui/LandKindIcon';
import { pickBtn, pillCls } from '../ui/styles';
import { PriceHeadline } from './PriceHeadline';
import { DetRows, DetSub, DetTop, VPad } from './shared';
import { orderRows } from '../../lib/detailRows';

/* Round status → optional no-buyer flag. A round where nobody placed a bid is marked
   "ไม่มีผู้ซื้อ" so the schedule reads like a real auction log. */
function roundStatus(status: string, seed: number): string {
  if (status === 'กำลังขาย' && seed % 4 === 0) return 'ไม่มีผู้ซื้อ';
  if (status === 'ประกาศขาย' && seed % 5 === 0) return 'ไม่มีผู้ซื้อ';
  return status;
}

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
  const rowOrder = useApp(s => s.detailRowOrder);
  const rowHidden = useApp(s => s.detailRowHidden);
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
  const chipBg = p.status === 'sale' ? popColors.sale : p.status === 'sold' ? popColors.sold : '#2A2F2A';
  const chipInk = '#fff';
  /* Rounds that actually have a date — see the rounds table below. */
  const elev = p.elevation ?? null;
  /* Only rounds LED has actually dated — see the rounds table below. */
  const scheduledRounds = p.rounds.filter((r) => r.date != null);

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
          ['ขนาดที่ดิน', `${fmtRai(p.wah)}`],
          ...tdRow,
          ['ระวาง', td?.rawang],
          ['หลักประกัน', fmt(p.collateral)],
          ...(p.spouseCollateral != null ? [['คู่สมรส หลักประกัน', fmt(p.spouseCollateral)] as [string,string]] : []),
          ...(p.expertPrice != null ? [['ราคา ผู้เชี่ยวชาญ', fmt(p.expertPrice)] as [string,string]] : []),
          ...(p.enforcementOfficerPrice != null ? [['ราคา เจ้าพนักงานบังคับคดี', fmt(p.enforcementOfficerPrice)] as [string,string]] : []),
          ...(p.assessorPrice != null ? [['ราคา เจ้าพนักงานประเมินราคา', fmt(p.assessorPrice)] as [string,string]] : []),
          ...(p.committeePrice != null ? [['ราคา คณะกรรมการ', fmt(p.committeePrice)] as [string,string]] : []),
          // ['การขายรอบถัดไป', nextRound?.date != null ? `${fdate(nextRound.date)} · ${nextRound.status}` : (nextRound?.status ?? '-')],
          ['วันที่ประกาศ', fdate(p.announce)],
          ...(p.soldTs ? [['วันที่ขายออก', fdate(p.soldTs)] as [string, string]] : []),
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
          <span className="whitespace-nowrap rounded-[4px] bg-accent/15 px-1.5 py-[2px] text-[10px] font-semibold text-accent">×{units.length} หน่วยยอด</span>
          <select
            aria-label="เลือกหน่วยยอด"
            value={Math.max(0, units.findIndex(u => u.id === p.id))}
            onChange={e => setPicked(units[Number(e.target.value)])}
            className="min-w-0 flex-1 rounded-[6px] border border-line2 bg-bg px-1.5 py-1 text-[11px] outline-none focus:border-accent"
          >
            {units.map((u, i) => (
              <option key={u.id} value={i}>
                #{i + 1}/{units.length} · {fmtRai(u.wah)} วา · {u.price > 0 ? fmt(u.price) : '-'}
              </option>
            ))}
          </select>
          <button
            type="button" aria-label="หน่วยยอดก่อนหน้า" title="หน่วยยอดก่อนหน้า"
            onClick={() => {
              const i = Math.max(0, units.findIndex(u => u.id === p.id));
              setPicked(units[(i - 1 + units.length) % units.length]);
            }}
            className="size-[22px] flex-none rounded border border-line2 text-[12px] leading-none text-dim hover:border-line3 hover:text-ink"
          >‹</button>
          <button
            type="button" aria-label="หน่วยยอดถัดไป" title="หน่วยยอดถัดไป"
            onClick={() => {
              const i = Math.max(0, units.findIndex(u => u.id === p.id));
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

        {units.length > 1 && (
          <span
            {...useTipProps(`มีอีก ${units.length} ที่ซ้อนกัน`)}
            className="ml-auto rounded border border-line2 bg-panel2 px-[9px] py-0.5 text-[10px] font-medium text-dim"
          >
            x {units.length}
          </span>
        )}
      </DetTop>

      {/* <DetName>{p.name}</DetName> */}

      <div className="mt-0.5">
        <PriceHeadline p={p} />
      </div>

      {hasUpcoming && upcoming?.date != null && kind !== "sold" && (
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
          <div className="px-2 py-1.5">สถานะ</div>
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
          scheduledRounds.map((r, i) => {
            const future = r.date != null && r.date > now;
            /* Once a lot sells, everything from the selling round onward is
               dead: that round happened, and the ones after it never will.
               A future round is left alone even then — its status cell is empty,
               and tinting an empty cell red reads as though it had a status. */
            const sold = highlightSold && p.status === 'sold' ? soldFrom(p) : -1;
            const after = sold >= 0 && i >= sold && !future;
            /* Both tints hang off the same switch. With it off the table is
               uniform, so "no dimming" means genuinely none. */
            const cls = `${after ? 'bg-[#E5484D]/22 text-[#FFB4B4]' : ''} ${future && highlightSold ? 'text-dim2' : ''}`;
            return (
              <div key={r.date ?? i} className={`grid grid-cols-[48px_1fr_1fr] border-t border-line text-[11.5px] ${cls}`}>
                <div className="px-2 py-1.5">{i + 1}</div>
                {/* The date is always shown — it is the one thing a reader needs
                    to place the round. Only the status goes quiet. */}
                <div className="px-2 py-1.5">{r.date != null ? numDate(r.date) : ''}</div>
                <div className="px-2 py-1.5">
                  {future ? '' : isPlaceholderStatus(r.status) ? '-' : roundStatus(r.status, p.id * 7 + i * 3)}
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
