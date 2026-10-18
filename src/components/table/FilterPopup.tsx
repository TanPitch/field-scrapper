import { Check as CheckIcon, RotateCcw, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ALL_PARCELS } from '../../data/liveData';
import { useAboveBelow } from '../../hooks/usePlacement';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { convertShortInput, sizeFromWah, sizeToWah, toggleSizeMode, wahLabel, type SizeValue } from '../../lib/landSize';
import { patchApp, toast, useApp } from '../../store/useApp';
import type { Filters, PopupKind } from '../../types';
import { POP_KINDS } from '../../data/constants';
import { Stepper } from '../ui/Stepper';
import { btn, btnAcc, iconBtn } from '../ui/styles';

type Draft = Omit<Filters, 'text'>;
/** Distinct values of a parcel field, sorted, for the chip filters. */
const uniqueOf = (get: (p: (typeof ALL_PARCELS)[number]) => string): string[] =>
  [...new Set(ALL_PARCELS.map(get).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
const row = 'flex items-center gap-2 border-b border-line py-[9px]';
const lab = 'w-[78px] flex-none text-[10.5px] text-dim2';
const sizeBox = 'h-[26px] w-full min-w-0 rounded-md border border-line2 bg-panel px-1 text-center text-[11px] text-ink outline-none focus:border-accent';
const chipBox = 'inline-flex max-w-full items-center gap-1 rounded-full border border-accent bg-accent-dim py-[3px] pl-2 pr-1 text-[10.5px] text-accent';

/** Custom checkbox — no native HTML5 control. */
function Check({ on }: { on: boolean }) {
  return (
    <span
      className={`grid size-[15px] flex-none place-items-center rounded-[4px] border transition ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line2 bg-bg'}`}
    >
      {on && <CheckIcon size={11} strokeWidth={3} />}
    </span>
  );
}

/**
 * Long click-to-open input: closed state shows the picked values as chips with an
 * × each; opening reveals a search box plus a scrollable option list.
 */
function ChipMulti({ label, options, value, onChange, render }: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Draws one option row. Plain text when absent - which is what province,
   *  district and land type want. Status passes a coloured dot so a kind is
   *  recognisable as the marker's colour before the map is looked at. */
  render?: (v: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /* the list is portalled, so both the trigger and the popup are watched */
  useOutsideClose([btnRef, popRef], () => { setOpen(false); setQ(''); }, open);

  /* drop the list below the trigger, flipping up when it would run off-screen */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = popRef.current?.offsetHeight ?? 240;
    const below = window.innerHeight - r.bottom;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      top: below >= h + 12 ? r.bottom + 4 : Math.max(8, r.top - h - 4),
      w: r.width,
    });
  }, [open, options.length, q]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const shown = q.trim() ? options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase())) : options;

  return (
    <div className="border-b border-line py-[9px]">
      <span className={lab}>{label}</span>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`mt-1 flex min-h-[30px] w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border px-1.5 py-1 text-left transition ${open ? 'border-accent' : 'border-line2 bg-panel hover:border-accent'}`}
      >
        {value.length === 0 && <span className="text-[11px] text-dim2">ทั้งหมด</span>}
        {value.map(v => (
          <span key={v} className={chipBox}>
            <span className="flex min-w-0 items-center gap-1">{render ? render(v) : <span className="max-w-[110px] truncate">{v}</span>}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); onChange(value.filter(x => x !== v)); }}
              onPointerDown={e => e.stopPropagation()}
              className="grid size-[14px] flex-none cursor-pointer place-items-center rounded-full bg-accent/25 text-[11px] leading-none hover:bg-accent hover:text-accent-ink"
            >×</span>
          </span>
        ))}
        {value.length > 0 && <span className="ml-auto flex-none text-[9.5px] text-dim2">{value.length}</span>}
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          data-portal
          className="fixed z-[98] overflow-hidden rounded-lg border border-accent bg-panel shadow-[0_14px_34px_rgba(0,0,0,.6)]"
          style={{ left: pos.left, top: pos.top, width: pos.w }}
        >
          <div className="flex items-center gap-1 border-b border-line px-2">
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`ค้นหา${label}…`}
              className="min-w-0 flex-1 border-0 bg-transparent py-[7px] text-[11.5px] text-ink outline-none placeholder:text-dim2"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="grid size-[18px] flex-none cursor-pointer place-items-center rounded-full text-dim2 hover:bg-panel2 hover:text-ink"><X size={12} /></button>
            )}
          </div>
          <div className="max-h-[168px] overflow-y-auto overscroll-contain p-1">
            {shown.map(o => {
              const on = value.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-panel2 ${on ? 'text-accent' : ''}`}
                >
                  <Check on={on} />
                  {render ? render(o) : <span className="truncate">{o}</span>}
                </button>
              );
            })}
            {!shown.length && <div className="px-1.5 py-1.5 text-[11px] text-dim2">ไม่พบข้อมูล</div>}
          </div>
          <div className="flex gap-1.5 border-t border-line px-1.5 py-1.5">
            <button type="button" onClick={() => onChange(shown)} className="flex-1 cursor-pointer rounded-md bg-panel2 py-1 text-[10.5px] text-dim hover:text-ink">เลือกทั้งหมดที่เห็น</button>
            <button type="button" onClick={() => { onChange([]); setQ(''); }} className="flex-1 cursor-pointer rounded-md bg-panel2 py-1 text-[10.5px] text-dim hover:text-ink">ล้าง</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** One size filter (ต่ำสุด / สูงสุด): single ตร.วา box or 3-box ไร่/งาน/ตร.วา with auto conversion. */
function SizeRow({ label, value, onChange }: { label: string; value: SizeValue; onChange: (v: SizeValue) => void }) {
  return (
    <div className="border-b border-line py-[9px]">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={lab}>{label}</span>
        <button
          type="button"
          className="ml-auto rounded-md border border-line2 bg-panel2 px-2 py-[3px] text-[9.5px] font-semibold text-dim hover:text-ink"
          onClick={() => onChange(toggleSizeMode(value))}
        >{value.mode === 'sets' ? 'เฉพาะ ตร.วา' : '3 ช่อง'}</button>
      </div>
      {value.mode === 'sets' ? (
        <div className="grid grid-cols-3 gap-1.5">
          <label className="text-center">
            <input className={sizeBox} value={value.rai} onChange={e => onChange({ ...value, rai: e.target.value })} placeholder="ไร่" inputMode="numeric" />
            <div className="mt-[3px] text-[9px] text-dim2">ไร่</div>
          </label>
          <label className="text-center">
            <input className={sizeBox} value={value.ngan} onChange={e => onChange({ ...value, ngan: e.target.value })} placeholder="งาน" inputMode="numeric" />
            <div className="mt-[3px] text-[9px] text-dim2">งาน</div>
          </label>
          <label className="text-center">
            <input className={sizeBox} value={value.sq} onChange={e => onChange({ ...value, sq: e.target.value })} placeholder="ตร.วา" inputMode="numeric" />
            <div className="mt-[3px] text-[9px] text-dim2">ตร.วา/ตร.ม.</div>
          </label>
        </div>
      ) : (
        <div>
          <input className={`${sizeBox} text-left`} value={value.single} onChange={e => onChange({ ...value, single: convertShortInput(e.target.value) })} placeholder="ตร.วา/ตร.ม. (เช่น 400 หรือ 5k)" inputMode="text" />
        </div>
      )}
    </div>
  );
}

/** Filter dialog: edits a draft, applies it with a short "filtering…" delay (as in the original UX). */
export function FilterPopup({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const popColors = useApp(s => s.popColors);
  const [fd, setFd] = useState<Draft>(() => {
    const f = useApp.getState().filters;
    return {
      status: f.status, minWah: f.minWah, maxWah: f.maxWah, minPrice: f.minPrice, maxPrice: f.maxPrice,
    minElev: f.minElev, maxElev: f.maxElev,
      province: f.province, provinces: f.provinces ?? [], tambons: f.tambons ?? [], amps: f.amps ?? [], propertyTypes: f.propertyTypes ?? [],
    };
  });
  const [sizeMin, setSizeMin] = useState<SizeValue>(() => sizeFromWah(useApp.getState().filters.minWah));
  const [sizeMax, setSizeMax] = useState<SizeValue>(() => sizeFromWah(useApp.getState().filters.maxWah));
  /* toleratePortals: the chip lists render into <body>, so a click on one of their
options must not read as "outside the dialog" and close it. */
  useOutsideClose([ref, { current: anchor }], () => { if (!busy) onClose(); }, true, true);
  const pos = useAboveBelow(ref, anchor, 400);

  /* The marker kinds, matching the colours used on the map. Order is what the
     user reads top-to-bottom: live inventory first, history last. Built from
     POP_KINDS so a status added there shows up here without a second edit. */
  const STATUS_CHIPS = POP_KINDS.map(([v, label, status]) =>
    ({ v, label, color: popColors[v === 're' ? 're' : status] }));
  const provinceItems = useMemo(() => uniqueOf(p => p.province), []);
  /* tambon/amp lists narrow to the picked provinces so impossible combos are hidden */
  const inProvinces = useMemo(
    () => fd.provinces.length ? ALL_PARCELS.filter(p => fd.provinces.includes(p.province)) : ALL_PARCELS,
    [fd.provinces],
  );
  const tambonItems = useMemo(() => [...new Set(inProvinces.map(p => p.tambon))].sort((a, b) => a.localeCompare(b, 'th')), [inProvinces]);
  const ampItems = useMemo(() => [...new Set(inProvinces.map(p => p.amp))].sort((a, b) => a.localeCompare(b, 'th')), [inProvinces]);
  const typeItems = useMemo(() => uniqueOf(p => p.propertyType), []);
  const upd = <K extends keyof Draft>(k: K, v: Draft[K]) => setFd(d => ({ ...d, [k]: v }));
  const chipCount = fd.provinces.length + fd.tambons.length + fd.amps.length + fd.propertyTypes.length;

  const clearAll = () => {
    setFd({ status: [], minWah: null, maxWah: null, minPrice: null, maxPrice: null, minElev: null, maxElev: null, province: '', provinces: [], tambons: [], amps: [], propertyTypes: [] });
    setSizeMin(sizeFromWah(null));
    setSizeMax(sizeFromWah(null));
  };

  const apply = () => {
    if (busy) return;
    setBusy(true);
    setTimeout(() => {
      patchApp({
        filters: {
          ...useApp.getState().filters,
          ...fd,
          minWah: sizeToWah(sizeMin),
          maxWah: sizeToWah(sizeMax),
        },
      });
      setBusy(false);
      onClose();
      toast(`กรองเสร็จสิ้น · ขนาด ≥ ${wahLabel(sizeToWah(sizeMin))} · ขนาด ≤ ${wahLabel(sizeToWah(sizeMax))}`
          + (chipCount ? ` · เลือกเพิ่ม ${chipCount} ค่า` : ''));
    }, 450);
  };

  return createPortal(
    <div ref={ref} data-portal className="fs-panel fixed z-[78] max-h-[min(78vh,560px)] w-[312px] animate-tin overflow-y-auto overscroll-contain rounded-xl border border-line2 bg-panel shadow-[0_18px_44px_rgba(0,0,0,.55)]" style={pos}>
      <div className="sticky top-0 z-[2] flex items-center bg-panel px-3 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-dim">
        ตัวกรองข้อมูล<button className={`${iconBtn} ml-auto`} onClick={() => { if (!busy) onClose(); }}><X size={17} /></button>
      </div>
      <div className="px-3 pb-2 pt-0.5">
        {/* The same searchable multi-select the province and district rows use,
            so it behaves like them rather than being a second way of doing the
            same thing. The options carry the marker's dot colour. */}
        <ChipMulti
          label="สถานะ"
          options={STATUS_CHIPS.map(c => c.label)}
          value={fd.status.map(v => STATUS_CHIPS.find(c => c.v === v)?.label ?? v)}
          onChange={picked => upd('status', picked.map(l => STATUS_CHIPS.find(c => c.label === l)?.v).filter((v): v is PopupKind => v != null))}
          render={label => {
            const c = STATUS_CHIPS.find(x => x.label === label);
            return <span className="flex min-w-0 items-center gap-1.5"><span className="size-1.5 flex-none rounded-full" style={{ background: c?.color }} />{label}</span>;
          }}
        />
        <SizeRow label="ขนาด ≥" value={sizeMin} onChange={setSizeMin} />
        <SizeRow label="ขนาด ≤" value={sizeMax} onChange={setSizeMax} />
        <div className={row}><span className={lab}>ราคาต่ำสุด<br /><span className="text-[9px]">(บาท)</span></span><Stepper value={fd.minPrice} step={50000} sep onChange={v => upd('minPrice', v)} /></div>
        <div className={row}><span className={lab}>ราคาสูงสุด<br /><span className="text-[9px]">(บาท)</span></span><Stepper value={fd.maxPrice} step={50000} sep onChange={v => upd('maxPrice', v)} /></div>
        <div className={row}><span className={lab}>ความสูงต่ำสุด<br /><span className="text-[9px]">(เหนือระดับน้ำทะเล ม.)</span></span><Stepper value={fd.minElev} step={5} onChange={v => upd('minElev', v)} /></div>
        <div className={row}><span className={lab}>ความสูงสูงสุด<br /><span className="text-[9px]">(เหนือระดับน้ำทะเล ม.)</span></span><Stepper value={fd.maxElev} step={5} onChange={v => upd('maxElev', v)} /></div>
        {/* Setting either bound drops parcels with no elevation. Say so, rather
            than letting rows quietly vanish and looking like a filter bug. */}
        {(fd.minElev != null || fd.maxElev != null) && (
          <div className="px-1 pb-1.5 text-[9.5px] leading-[1.5] text-dim2">
            แปลงที่ยังไม่มีข้อมูลความสูงจะถูกตัดออกจากผลลัพธ์
          </div>
        )}
        <div className="border-b border-line" />
        <ChipMulti label="จังหวัด" options={provinceItems} value={fd.provinces} onChange={v => upd('provinces', v)} />
        <ChipMulti label="ตำบล" options={tambonItems} value={fd.tambons} onChange={v => upd('tambons', v)} />
        <ChipMulti label="อำเภอ" options={ampItems} value={fd.amps} onChange={v => upd('amps', v)} />
        <ChipMulti label="ประเภททรัพย์" options={typeItems} value={fd.propertyTypes} onChange={v => upd('propertyTypes', v)} />
      </div>
      <div className="sticky bottom-0 z-[2] flex gap-2 border-t border-line bg-panel px-3 py-2.5">
        <button className={`${btn} flex-1 justify-center`} onClick={clearAll}><RotateCcw size={14} />ล้างค่า</button>
        <button className={`${btnAcc} flex-1 justify-center`} disabled={busy} onClick={apply}>
          {busy && <span className="spin-keep inline-block size-3 animate-spin2 rounded-full border-2 border-[rgba(21,27,6,.3)] border-t-accent-ink" />}
          {busy ? 'กำลังกรอง…' : 'กรองข้อมูล'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
