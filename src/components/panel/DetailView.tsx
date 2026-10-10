import { Calendar } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { STATUS } from '../../data/constants';
import { PARCEL_BY_ID } from '../../data/mockData';
import { useMoney } from '../../hooks/useMoney';
import { fdate, fmtRai, numDate } from '../../lib/format';
import { deltaText, lastDelta } from '../../lib/price';
import { popupKind } from '../../map/popups';
import { patchApp, useApp } from '../../store/useApp';
import { useLightbox } from '../../store/useLightbox';
import type { Parcel } from '../../types';
import { PriceChart } from '../charts/PriceChart';
import { RangeSlider } from '../charts/RangeSlider';
import { DateButton } from '../ui/DateButton';
import { LAND_KIND_LABEL, LandKindIcon } from '../ui/LandKindIcon';
import { pickBtn, pillCls } from '../ui/styles';
import { DetName, DetRows, DetSub, DetTop, VPad } from './shared';

/* Round status → optional no-buyer flag. A round where nobody placed a bid is marked
   "ไม่มีผู้ซื้อ" so the schedule reads like a real auction log. */
function roundStatus(status: string, seed: number): string {
  if (status === 'กำลังขาย' && seed % 4 === 0) return 'ไม่มีผู้ซื้อ';
  if (status === 'ประกาศขาย' && seed % 5 === 0) return 'ไม่มีผู้ซื้อ';
  return status;
}

export const landImg = (p: Parcel, i: number, w: number, h: number): string => `https://picsum.photos/seed/land-${p.id}-${i}/${w}/${h}.jpg`;
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
        {Array.from({ length: n }, (_, k) => (
          <img key={k} src={landImg(p, k, 640, 360)} alt={`ภาพแปลงที่ดิน ${k + 1}`} draggable={false} className="pointer-events-none h-full w-full flex-[0_0_100%] select-none object-cover" />
        ))}
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
  const p = id != null ? PARCEL_BY_ID.get(id) : undefined;

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
  const delta = lastDelta(p);
  const chipBg = p.status === 'sale' ? popColors.sale : p.status === 'sold' ? popColors.sold : '#2A2F2A';
  const chipInk = '#fff';

  return (
    <VPad>
      <Carousel key={p.id} p={p} />
<DetTop>
        <span className="rounded-full px-[9px] py-0.5 text-[10px] font-semibold" style={{ background: chipBg, color: chipInk }}>{STATUS[kind].th}</span>
        {/* data source + land kind badges */}
        <span
          {...useTipProps(`แหล่งข้อมูล: ${p.dataSource}`)}
          className="rounded-full border border-line2 bg-panel2 px-[9px] py-0.5 text-[10px] font-medium text-dim"
        >
          {p.dataSource}
        </span>
        {showKindIcon && (
          <span
            {...useTipProps(LAND_KIND_LABEL[p.landKind])}
            className="inline-flex items-center gap-1 rounded-full border border-line2 bg-panel2 px-[8px] py-0.5 text-[10px] font-medium text-dim"
          >
            <LandKindIcon kind={p.landKind} />
            {LAND_KIND_LABEL[p.landKind]}
          </span>
        )}
        <span className="ml-auto text-[10.5px] text-dim2">{p.deed}</span>
      </DetTop>
      <DetName>{p.name}</DetName>
      <div className="mt-0.5 flex items-center gap-2">
        <div className="text-2xl font-bold text-accent">{fmt(p.price)}</div>
        {delta && (
          <span
            {...useTipProps(`เปลี่ยนแปลงจากราคาเปิดรอบก่อน ${deltaText(delta)}`)}
            className={`rounded-full border px-2 py-[2px] text-[11px] font-semibold ${delta.up ? 'border-[#3F6B2A] bg-[#1B2A12] text-[#B8F13F]' : 'border-[#7A2B2B] bg-[#2A1414] text-[#FF8A8E]'}`}
          >
            {deltaText(delta)}
          </span>
        )}
      </div>
      <div className="mb-2.5 font-display text-[11px] text-dim">{fmt(p.perWah)} / ตร.วา · {p.amp} {p.province}</div>

      <ul>
        {p.events.length ? p.events.map(e => {
          const h = p.hist[e.idx];
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

      <DetRows
        rows={[
          ['ที่ตั้ง', `${p.tambon} ${p.amp} ${p.province}`],
          ['ขนาดที่ดิน', `${fmtRai(p.wah)}`],
          ['ประเภททรัพย์', p.propertyType],
          ['หมายเลขคดี', p.caseNo],
          ['เลขที่โฉนด', p.deedNo],
          ['หลักประกัน', fmt(p.collateral)],
          ...(p.spouseCollateral != null ? [['คู่สมรส หลักประกัน', fmt(p.spouseCollateral)] as [string,string]] : []),
          // ...(p.expertPrice != null ? [['ราคา ผู้เชี่ยวชาญ', fmt(p.expertPrice)] as [string,string]] : []),
          ...(p.enforcementOfficerPrice != null ? [['ราคา เจ้าพนักงานบังคับคดี', fmt(p.enforcementOfficerPrice)] as [string,string]] : []),
          // ...(p.assessorPrice != null ? [['ราคา เจ้าพนักงานประเมินราคา', fmt(p.assessorPrice)] as [string,string]] : []),
          // ...(p.committeePrice != null ? [['ราคา คณะกรรมการ', fmt(p.committeePrice)] as [string,string]] : []),
          // ['การขายรอบถัดไป', nextRound?.date != null ? `${fdate(nextRound.date)} · ${nextRound.status}` : (nextRound?.status ?? '-')],
          // ['วันที่ประกาศ', fdate(p.announce)],
          ...(p.soldTs ? [['วันที่ขายออก', fdate(p.soldTs)] as [string, string]] : []),
          ...(p.mortgage ? [['ติดจำนอง', `${fmt(p.mortgage.amount)} — ${p.mortgage.bank}`] as [string,string]] : []),
        ]}
      />

      {hasUpcoming && upcoming?.date != null && (
        <div className="my-2 flex items-center gap-2 rounded-lg border border-accent bg-accent-dim px-3 py-2 text-[11.5px] font-semibold text-accent">
          <span className="flex-none rounded-full bg-accent px-2 py-[2px] font-display text-[10px] text-accent-ink">
            {daysLeft === 0 ? 'วันนี้' : `อีก ${daysLeft} วัน`}
          </span>
          จะมีการขายทรัพย์ภายใน 10 วัน — นัดวันที่ {numDate(upcoming.date)}
        </div>
      )}
      <div className="mb-2 mt-4 overflow-hidden rounded-[10px] border border-line bg-bg">
        <div className="grid grid-cols-[48px_1fr_1fr] bg-panel2 text-[11px] font-semibold">
          <div className="px-2 py-1.5">นัดที่</div>
          <div className="px-2 py-1.5">วันที่</div>
          <div className="px-2 py-1.5">สถานะ</div>
        </div>
        {p.rounds.map((r, i) => (
          <div key={i} className="grid grid-cols-[48px_1fr_1fr] border-t border-line text-[11.5px]">
            <div className="px-2 py-1.5">{i + 1}</div>
            <div className="px-2 py-1.5">{r.date != null ? numDate(r.date) : '-'}</div>
            <div className="px-2 py-1.5">{roundStatus(r.status, p.id * 7 + i * 3)}</div>
          </div>
        ))}
      </div>
      <DetSub>กราฟราคาประวัติย้อนหลัง</DetSub>
      <RangeRow />
      <div className="rounded-[10px] border border-line bg-bg p-2">
        <div className="h-[170px]"><PriceChart parcel={p} /></div>
        <RangeSlider parcel={p} />
      </div>
      
    </VPad>
  );
}
