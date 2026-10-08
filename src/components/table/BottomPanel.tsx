import { ChevronDown, Crosshair, Filter, Search, Table2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { HEADER_H, MIN_BH } from '../../data/constants';
import { debounce } from '../../lib/format';
import { showRight } from '../../store/actions';
import { clampBottomH, patchApp, useApp } from '../../store/useApp';
import { btn, btnAcc, iconBtn } from '../ui/styles';
import { useTipProps } from '../ui/Tip';
import { ColumnPicker } from './ColumnPicker';
import { DataTable } from './DataTable';
import { FilterPopup } from './FilterPopup';

export function BottomPanel({ small }: { small: boolean }) {
  const filters = useApp(s => s.filters);
  const bottomH = useApp(s => s.bottomH);
  const landOn = useApp(s => s.landOn);
  const [colAnchor, setColAnchor] = useState<HTMLElement | null>(null);
  const [fltAnchor, setFltAnchor] = useState<HTMLElement | null>(null);
  const [flipped, setFlipped] = useState(true);
  const prevH = useRef<number | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const hasFilters = !!(filters.status || filters.province || filters.minWah != null || filters.maxWah != null || filters.minPrice != null || filters.maxPrice != null
    || filters.tambons?.length || filters.amps?.length || filters.propertyTypes?.length);
  const onText = useRef(debounce((v: string) => patchApp({ filters: { ...useApp.getState().filters, text: v.trim() } }), 140)).current;

  /* keep the stored height valid when the viewport shrinks */
  useEffect(() => {
    const h = debounce(() => patchApp({ bottomH: clampBottomH(useApp.getState().bottomH, window.innerHeight, HEADER_H) }), 150);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  /* external reset (Settings → รีเซ็ต) clears the text box too */
  useEffect(() => { if (search.current && !filters.text && search.current.value) search.current.value = ''; }, [filters.text]);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { y: e.clientY, h: panel.current?.offsetHeight ?? bottomH };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current) patchApp({ bottomH: clampBottomH(drag.current.h + (drag.current.y - e.clientY), window.innerHeight, HEADER_H) });
  };
  const snap = () => {
    const cur = panel.current?.offsetHeight ?? bottomH;
    if (cur > MIN_BH + 40) { prevH.current = cur; patchApp({ bottomH: MIN_BH }); setFlipped(false); }
    else { patchApp({ bottomH: prevH.current ?? 286 }); setFlipped(true); }
  };

  return (
    <section
      ref={panel}
      className={`fs-panel relative z-30 flex flex-col overflow-hidden border-t border-line bg-panel [grid-area:bp] ${landOn ? '' : 'hidden'} ${small ? 'fixed inset-x-0 bottom-0 z-[45] shadow-[0_-14px_40px_rgba(0,0,0,.5)]' : ''}`}
      style={small ? { height: bottomH } : undefined}
    >
      <div
        {...useTipProps('ลากเพื่อปรับความสูง')}
        className="group absolute inset-x-0 -top-0.5 z-[35] grid h-2.5 cursor-row-resize touch-none place-items-center"
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }}
      >
        <span className="h-[3px] w-[34px] rounded-[3px] bg-line2 group-hover:bg-accent" />
      </div>
      <div className="flex flex-none items-center gap-2 overflow-x-auto border-b border-line py-1.5 pl-4 pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex h-[30px] w-[min(240px,40vw)] flex-none items-center gap-[7px] rounded-lg border border-line2 bg-bg px-[9px] focus-within:border-accent">
          <Search size={13} className="text-dim2" />
          <input ref={search} placeholder="ค้นหาในตาราง: ชื่อแปลง / เลขโฉนด…" autoComplete="off" onChange={e => onText(e.target.value)} className="min-w-0 flex-1 border-none bg-transparent text-xs text-ink outline-none placeholder:text-dim2" />
        </div>
        <div className="flex-1" />
        <button className={btn} {...useTipProps('ตัวกรองข้อมูล')} onClick={e => setFltAnchor(a => (a ? null : e.currentTarget))}>
          <Filter size={14} />ตัวกรอง{hasFilters && <span className="size-1.5 rounded-full bg-accent" />}
        </button>
        <button className={btn} {...useTipProps('แสดง/ซ่อน/ปักหมุด/เรียง/ปรับความกว้าง')} onClick={e => setColAnchor(a => (a ? null : e.currentTarget))}><Table2 size={14} />คอลัมน์</button>
        <button className={btnAcc} {...useTipProps('เปิดแผงค้นหาในพื้นที่นี้')} onClick={() => { patchApp({ searchPrefill: filters.text || '' }); showRight('search'); }}><Crosshair size={14} />ค้นหาที่ดิน</button>
        <button className={iconBtn} {...useTipProps('ย่อ/ขยายตาราง')} onClick={snap}><ChevronDown size={17} className={`transition-transform duration-200 ${flipped ? '' : 'rotate-180'}`} /></button>
      </div>
      <DataTable />
      {colAnchor && <ColumnPicker anchor={colAnchor} onClose={() => setColAnchor(null)} />}
      {fltAnchor && <FilterPopup anchor={fltAnchor} onClose={() => setFltAnchor(null)} />}
    </section>
  );
}
