import { ChevronUp, Pin } from 'lucide-react';
import { useClipTip, useTipProps } from '../ui/Tip';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { COL_DEFS, PIN_W, ROW_H, STATUS } from '../../data/constants';
import { useMoney } from '../../hooks/useMoney';
import { useParcels } from '../../hooks/useParcels';
import { fdate, splitWah } from '../../lib/format';
import { parcelDot } from '../../lib/parcelColor';
import { applyReorder, select, toggleColPin, togglePinRow } from '../../store/actions';
import { patchApp, useApp } from '../../store/useApp';
import type { ColKey, Parcel, SellRound, SortKey } from '../../types';

const HEAD_H = 48;
interface LayCell { key: ColKey | '_fill'; sub?: number; left: number; w: number }

/* ---------- column geometry ---------- */
let measureCtx: CanvasRenderingContext2D | null = null;
const minColW = (k: ColKey): number => {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = '600 11px "Noto Sans Thai"';
  }
  return Math.ceil(measureCtx?.measureText(COL_DEFS[k].label).width ?? 60) + 52;
};

const stickyStyle = (left: number): CSSProperties => ({ position: 'sticky', left, zIndex: 2 });

/* ---------- body row ---------- */
/** Full text for cells that get truncated, so hovering reveals the whole value. */
function cellTip(key: ColKey, p: Parcel): string | undefined {
  switch (key) {
    case 'saleBy': return p.mortgage ? `ติดจำนอง ${p.mortgage.bank}` : undefined;
    case 'name': return p.name;
    case 'ownerFile': return p.ownerFile;
    case 'plaintiff': return p.plaintiff;
    case 'defendant': return p.defendant;
    case 'possessor': return p.possessor;
    case 'enforcementOffice': return p.enforcementOffice;
    case 'court': return p.court;
    case 'caseNo': return p.caseNo;
    case 'propertyType': return p.propertyType;
    case 'deedNo': return p.deedNo;
    case 'tambon': return p.tambon;
    case 'amp': return p.amp;
    case 'province': return p.province;
    default: return undefined;
  }
}

/**
 * Auction case numbers look like "12-716" / "349-62": a group number and a running
 * sequence within it. Built from the row number so it is stable per parcel.
 */
export function caseNoOf(n: number): string {
  const group = (n % 350) + 12;
  const seq = (n * 37) % 900 + 17;
  return `${group}-${seq}`;
}

/**
 * The one sale round worth showing in the table: the round that is currently selling,
 * otherwise the nearest one after today, otherwise the latest dated round.
 */
function latestRound(p: Parcel): { index: number; round: SellRound } | null {
  const now = Date.now();
  const selling = p.rounds.findIndex(r => r.status === 'กำลังขาย');
  if (selling >= 0) return { index: selling, round: p.rounds[selling] };
  const future = p.rounds
    .map((r, i) => ({ i, r }))
    .filter(x => x.r.date != null && x.r.date >= now)
    .sort((a, b) => (a.r.date as number) - (b.r.date as number))[0];
  if (future) return { index: future.i, round: future.r };
  let last = -1;
  p.rounds.forEach((r, i) => { if (r.date != null) last = i; });
  return last >= 0 ? { index: last, round: p.rounds[last] } : null;
}

interface RowProps {
  p: Parcel; lay: LayCell[]; gridW: number; pinned: boolean; selected: boolean; colPinned: ReadonlySet<ColKey>;
  dot: string; fmt: (v: number) => string; dragging: ColKey | null; no: number;
  /** px to slide this row's cells while a column drag is in flight. */
  shiftOf: (key: ColKey) => number;
  /** true for the column currently being dragged (masked out). */
  isSrcOf: (key: ColKey) => boolean;
}
const Row = memo(function Row({ p, lay, gridW, pinned, selected, colPinned, dot, fmt, dragging, no, shiftOf, isSrcOf }: RowProps) {
  const bg = selected ? 'bg-accent-dim' : pinned ? 'bg-[rgba(184,241,63,.05)]' : 'bg-panel hover:bg-panel2';
  const edge = selected || pinned ? 'shadow-[inset_2px_0_0_var(--accent)]' : '';
  const pinBg = selected || pinned ? 'bg-[#1B2213]' : 'bg-panel group-hover:bg-panel2';
  const content = (c: LayCell): React.ReactNode => {
    switch (c.key) {
      case 'no': return no ? caseNoOf(no) : '';
      case 'name': return p.name;
      case 'status': return <><span className="inline-block size-[7px] flex-none rounded-full" style={{ background: dot }} />&nbsp;{STATUS[p.status].th}</>;
      case 'size': return splitWah(p.wah)[c.sub ?? 0];
      case 'price': return fmt(p.price);
      case 'perWah': return fmt(p.perWah);
      case 'saleBy': {
        /* show the mortgage amount only; the bank name is the hover title */
        if (p.mortgage) return p.mortgage.amount.toLocaleString('en-US');
        return 'ปลอดการจำนอง';
      }
      case 'ownerFile': return p.ownerFile;
      case 'propertyType': return p.propertyType;
      case 'deedNo': return p.deedNo;
      case 'tambon': return p.tambon;
      case 'court': return p.court;
      case 'caseNo': return p.caseNo;
      case 'plaintiff': return p.plaintiff;
      case 'defendant': return p.defendant;
      case 'possessor': return p.possessor;
      case 'enforcementOffice': return p.enforcementOffice;
      case 'collateral': return fmt(p.collateral);
      case 'spouseCollateral': return p.spouseCollateral != null ? fmt(p.spouseCollateral) : '-';
      case 'expertPrice': return p.expertPrice != null ? fmt(p.expertPrice) : '-';
      case 'enforcementOfficerPrice': return p.enforcementOfficerPrice != null ? fmt(p.enforcementOfficerPrice) : '-';
      case 'assessorPrice': return p.assessorPrice != null ? fmt(p.assessorPrice) : '-';
      case 'committeePrice': return p.committeePrice != null ? fmt(p.committeePrice) : '-';
      case 'announceDate': return fdate(p.announce);
      case 'amp': return p.amp;
      case 'announce': return fdate(p.announce);
      case 'lastTs': return fdate(p.lastTs);
      case 'province': return p.province;
      case 'roundLast': {
        const r = latestRound(p);
        if (!r) return '-';
        if (c.sub === 0) return r.index + 1;
        if (c.sub === 1) return r.round.date != null ? fdate(r.round.date) : '-';
        return r.round.status;
      }
      default: return null;
    }
  };
  return (
    <div data-id={p.id} className={`group flex h-9 cursor-pointer items-stretch border-b border-line text-[12.5px] ${bg} ${edge}`} style={{ width: gridW }}>
      <div className={`flex flex-none items-center overflow-hidden px-2 shadow-[inset_-1px_0_0_var(--border2),3px_0_8px_-3px_rgba(0,0,0,.4)] ${pinBg}`} style={{ width: PIN_W, ...stickyStyle(0), zIndex: 3 }}>
        <button data-pinrow={p.id} {...useTipProps('ปักหมุด/เลิกปักหมุดแถว')} className={`grid size-full cursor-pointer place-items-center border-none bg-transparent hover:text-ink ${pinned ? 'text-accent' : 'text-dim2 opacity-45 hover:opacity-100'}`}><Pin size={12} /></button>
      </div>
      {lay.map((c, i) => {
        if (c.key === '_fill') return <div key={i} className="flex-none" style={{ width: c.w }} />;
        const dx = shiftOf(c.key);
        const d = COL_DEFS[c.key], cp = colPinned.has(c.key);
        const num = d.num || c.key === 'size';
        return (
          <div
            key={i} data-td
            {...useClipTip(cellTip(c.key, p))}
            className={`flex min-w-0 flex-none items-center overflow-hidden text-ellipsis whitespace-nowrap px-2 ${num ? 'justify-end text-xs' : ''} ${cp ? `shadow-[inset_-1px_0_0_var(--border2),3px_0_8px_-3px_rgba(0,0,0,.4)] ${pinBg}` : ''} ${isSrcOf(c.key) ? 'invisible' : ''} ${dragging ? 'transition-transform duration-200 ease-out' : ''}`}
            style={{ width: c.w, transform: dx ? `translateX(${dx}px)` : undefined, ...(cp ? stickyStyle(c.left) : {}) }}
          >{content(c)}</div>
        );
      })}
    </div>
  );
});

/* ---------- table ---------- */
const GripIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-[10px] flex-none opacity-80">
    <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" />
    <circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
  </svg>
);

export function DataTable() {
  const { pinRows, normRows, viewRows, emptyWhy } = useParcels();
  const fmt = useMoney();
  const colOrder = useApp(s => s.colOrder);
  const colHidden = useApp(s => s.colHidden);
  const colPinned = useApp(s => s.colPinned);
  const colWidths = useApp(s => s.colWidths);
  const sort = useApp(s => s.sort);
  const selectedId = useApp(s => s.selectedId);

  const scroll = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(640);
  const [ch, setCh] = useState(240);
  const [scrollTop, setScrollTop] = useState(0);
  
  const [dragging, setDragging] = useState<ColKey | null>(null);
  /** Ghost column that follows the pointer while reordering: key, pointer pos, drop index. */
  const [ghost, setGhost] = useState<{ key: ColKey; x: number; y: number; idx: number } | null>(null);
  const [resizing, setResizing] = useState<ColKey | null>(null);

  /* viewport size */
  useEffect(() => {
    const el = scroll.current; if (!el) return;
    const ro = new ResizeObserver(() => { setCw(el.clientWidth || 640); setCh(el.clientHeight || 1); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wOf = useCallback((k: ColKey) => colWidths[k] ?? COL_DEFS[k].w, [colWidths]);
  const cols = useMemo<ColKey[]>(
    () => [...colOrder.filter(k => colPinned.has(k) && !colHidden.has(k)), ...colOrder.filter(k => !colPinned.has(k) && !colHidden.has(k))],
    [colOrder, colPinned, colHidden],
  );

  const { lay, gridW } = useMemo(() => {
    const others = cols.filter(k => k !== 'name').reduce((s, k) => s + wOf(k), 0);
    const nameW = cols.includes('name') ? Math.max(150, cw - PIN_W - others) : 0;
    const out: LayCell[] = [];
    let x = PIN_W;
    cols.forEach(k => {
      const d = COL_DEFS[k], w = k === 'name' ? nameW : wOf(k);
      if (d.subs) {
        const sw = Math.floor(w / d.subs.length);
        let xx = x;
        d.subs.forEach((_, i) => {
          const ww = i === d.subs!.length - 1 ? w - sw * (d.subs!.length - 1) : sw;
          out.push({ key: k, sub: i, left: xx, w: ww });
          xx += ww;
        });
      } else out.push({ key: k, left: x, w });
      x += w;
    });
    if (x < cw) { out.push({ key: '_fill', left: x, w: cw - x }); x = cw; }
    return { lay: out, gridW: x };
  }, [cols, cw, wOf]);

  /* ----- sort ----- */
  const toggleSort = (k: ColKey) => {
    const sk = (COL_DEFS[k].sortKey ?? k) as SortKey;
    const cur = useApp.getState().sort;
    patchApp({ sort: cur.key === sk ? { key: sk, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key: sk, dir: 'desc' } });
  };

  /* ----- resize ----- */
  const startResize = (e: RPointerEvent<HTMLElement>, k: ColKey) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = wOf(k), min = minColW(k);
    setResizing(k);
    const mv = (ev: PointerEvent) => patchApp({ colWidths: { ...useApp.getState().colWidths, [k]: Math.max(min, Math.min(640, w0 + (ev.clientX - x0))) } });
    const up = () => { window.removeEventListener('pointermove', mv); setResizing(null); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  };

  /* ----- drag-reorder / click-sort ----- */
  const insertIdx = (x: number, key: ColKey): number => {
    const zone = colPinned.has(key);
    const stickL = head.current?.getBoundingClientRect().left ?? 0;
    const reps = new Map<ColKey | '_fill', LayCell>();
    lay.forEach(c => { if (!reps.has(c.key)) reps.set(c.key, c); });
    const z = cols.filter(k => colPinned.has(k) === zone);
    for (let i = 0; i < z.length; i++) {
      const c = reps.get(z[i]);
      if (c && x < stickL + c.left + c.w / 2) return i;
    }
    return z.length;
  };
  const startHeaderDrag = (e: RPointerEvent<HTMLElement>, key: ColKey) => {
    if ((e.target as HTMLElement).closest('[data-hrs],[data-hpin]')) return;
    e.preventDefault();
    const st = { x0: e.clientX, moved: false, idx: 0 };
    const mv = (ev: PointerEvent) => {
      if (!st.moved && Math.abs(ev.clientX - st.x0) > 8) { st.moved = true; setDragging(key); }
      if (!st.moved) return;
      st.idx = insertIdx(ev.clientX, key);
      setGhost({ key, x: ev.clientX, y: ev.clientY, idx: st.idx });
    };
    /* continuous edge autoscroll: rAF loop keeps scrolling while the pointer rests
       near an edge, which a per-move scrollBy cannot do */
    const EDGE = 72;
    let raf = 0, dir = 0;
    const spin = () => {
      if (!dir) { raf = 0; return; }
      scroll.current?.scrollBy({ left: dir * 16, behavior: 'auto' });
      raf = requestAnimationFrame(spin);
    };
    const edgeMv = (ev: PointerEvent) => {
      dir = ev.clientX < EDGE ? -1 : ev.clientX > window.innerWidth - EDGE ? 1 : 0;
      if (dir && !raf) raf = requestAnimationFrame(spin);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointermove', edgeMv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dir = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      setDragging(null);
      setGhost(null);
      if (st.moved) applyReorder(key, st.idx); else if (COL_DEFS[key].sortable) toggleSort(key);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointermove', edgeMv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ----- virtual window ----- */
  const off = HEAD_H + pinRows.length * ROW_H;
  const st = Math.max(0, scrollTop - off);
  const s0 = Math.max(0, Math.floor(st / ROW_H) - 4);
  const e0 = Math.min(normRows.length, Math.ceil((st + ch) / ROW_H) + 4);
  const slice = normRows.slice(s0, e0);
  /* stable 1-based row numbers over the current view order, so ลำดับที่ is contiguous */
  const noOf = useMemo(() => new Map(viewRows.map((p, i) => [p.id, i + 1])), [viewRows]);
  const raf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollTop(scroll.current?.scrollTop ?? 0));
  };

  /* ----- body events (delegated) ----- */
  const onBodyClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const pb = t.closest<HTMLElement>('[data-pinrow]');
    if (pb) { togglePinRow(Number(pb.dataset.pinrow)); return; }
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id) select(Number(id), { fly: false });
  };

  const isSrcOf = (key: ColKey): boolean => ghost?.key === key;
  const rowProps = (p: Parcel, pinned: boolean) => (
    <Row key={p.id} p={p} lay={lay} gridW={gridW} pinned={pinned} selected={selectedId === p.id} colPinned={colPinned} dot={parcelDot(p)} fmt={fmt} dragging={dragging} no={noOf.get(p.id) ?? 0} shiftOf={shiftFor} isSrcOf={isSrcOf} />
  );

  /**
   * How far a header cell should slide while a drag is in flight: a column sitting
   * between the origin and the drop index shifts by one slot width, so the gap opens
   * where the column will land.
   */
  const shiftFor = (key: ColKey): number => {
    if (!ghost || ghost.key === key) return 0;
    const zone = colPinned.has(key);
    if (zone !== colPinned.has(ghost.key)) return 0;
    const z = cols.filter(k => colPinned.has(k) === zone);
    const from = z.indexOf(ghost.key), to = ghost.idx;
    if (from < 0 || to < 0) return 0;
    if (from < to && z.indexOf(key) > from && z.indexOf(key) <= to) return -wOf(key);
    if (from > to && z.indexOf(key) >= to && z.indexOf(key) < from) return wOf(key);
    return 0;
  };

  /* ----- header cells ----- */
  const headCells: React.ReactNode[] = [
    <div key="pin" {...useTipProps('ปักหมุดแถว')} className="relative z-[2] flex items-center justify-center overflow-hidden border-r border-line bg-panel text-dim2" style={{ gridColumn: 1, gridRow: '1 / 3', width: PIN_W, ...stickyStyle(0) }}><Pin size={12} /></div>,
  ];
  let ci = 2;
  cols.forEach(k => {
    const d = COL_DEFS[k], cp = colPinned.has(k);
    const cs = lay.filter(c => c.key === k);
    const w = cs.reduce((s, c) => s + c.w, 0);
    const sk = (d.sortKey ?? k) as SortKey;
    const dir = d.sortable && sort.key === sk ? sort.dir : null;
    /* While dragging, columns between the origin and the drop slot slide aside so the
user sees the result before releasing. The transition class only exists mid-drag:
on release the table snaps to the new order with no movement. */
    const shift = shiftFor(k);
    /* the source column is fully masked (header text included) while dragging, so the
       sliding neighbours can never overlap it */
    const isSrc = isSrcOf(k);
    const base = `hcell group relative flex items-center justify-center gap-[3px] overflow-hidden whitespace-nowrap border-r border-line text-[11px] font-semibold ${ghost ? 'transition-transform duration-200 ease-out' : ''} ${d.sortable ? 'cursor-pointer text-dim hover:text-ink' : 'text-dim'} ${cp ? 'bg-panel shadow-[inset_-1px_0_0_var(--border2),3px_0_8px_-3px_rgba(0,0,0,.45)]' : ''} ${isSrc ? 'invisible' : ''}`;
    const inner = (
      <>
        <span className="overflow-hidden text-ellipsis">{d.label}</span>
        {d.sortable && <ChevronUp size={10} className={`flex-none text-accent transition ${dir ? 'opacity-100' : 'opacity-0'} ${dir === 'desc' ? 'rotate-180' : ''}`} />}
        <button data-hpin {...useTipProps('ปักหมุดคอลัมน์')} onPointerDown={ev => { ev.preventDefault(); ev.stopPropagation(); toggleColPin(k); }}
          className={`absolute right-[3px] top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0.5 ${cp ? 'inline-flex text-accent' : 'hidden text-dim2 group-hover:inline-flex'}`}><Pin size={10} /></button>
        {k !== 'name' && (
          <div data-hrs {...useTipProps('ลากเพื่อปรับความกว้าง')} onPointerDown={ev => startResize(ev, k)}
            className={`hrs absolute -right-[3px] bottom-0 top-0 z-[4] w-[7px] cursor-col-resize touch-none ${resizing === k ? 'active' : ''}`} />
        )}
      </>
    );
    if (d.subs) {
      headCells.push(
        <div key={k} className={`${base} px-[22px]`} style={{ gridColumn: `${ci} / span ${d.subs.length}`, gridRow: 1, width: w, transform: shift ? `translateX(${shift}px)` : undefined, ...(cp ? stickyStyle(cs[0].left) : {}) }} onPointerDown={ev => startHeaderDrag(ev, k)}>{inner}</div>,
      );
      cs.forEach((c, i) => headCells.push(
        <div key={k + '-' + i} className={`flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-line px-2 text-[10px] text-dim2 ${ghost ? 'transition-transform duration-200 ease-out' : ''} ${isSrc ? 'invisible' : ''} ${cp ? 'bg-panel' : ''}`} style={{ gridColumn: ci + i, gridRow: 2, width: c.w, transform: shift ? `translateX(${shift}px)` : undefined, ...(cp ? stickyStyle(c.left) : {}) }}>
          <span>{d.subs![c.sub ?? 0]}</span>
        </div>,
      ));
      ci += d.subs.length;
    } else {
      headCells.push(
        <div key={k} className={`${base} px-[22px]`} style={{ gridColumn: ci, gridRow: '1 / 3', width: w, transform: shift ? `translateX(${shift}px)` : undefined, ...(cp ? stickyStyle(cs[0].left) : {}) }} onPointerDown={ev => startHeaderDrag(ev, k)}>{inner}</div>,
      );
      ci++;
    }
  });
  const fill = lay.find(c => c.key === '_fill');
  if (fill) headCells.push(<div key="fill" style={{ gridColumn: ci, gridRow: '1 / 3', width: fill.w }} />);
  const template = [PIN_W + 'px', ...lay.filter(c => c.key !== '_fill').map(c => c.w + 'px'), ...(fill ? ['1fr'] : [])].join(' ');

  /* drop-slot geometry: where the dragged column will land, in header coordinates */
  const dropSlot = useMemo(() => {
    if (!ghost) return null;
    const zone = colPinned.has(ghost.key);
    const reps = new Map<ColKey | '_fill', LayCell>();
    lay.forEach(c => { if (!reps.has(c.key)) reps.set(c.key, c); });
    const z = cols.filter(k => colPinned.has(k) === zone);
    const target = z[ghost.idx];
    const w = target ? wOf(target) : 120;
    let left: number;
    if (target) {
      const c = reps.get(target);
      left = c ? c.left : PIN_W;
    } else {
      const last = reps.get(z[z.length - 1]);
      left = last ? last.left + last.w : PIN_W;
    }
    return { left, w };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost, lay, cols, colPinned, colWidths]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroll} className="absolute inset-0 overflow-auto bg-panel [overscroll-behavior:contain]" onScroll={onScroll} onClick={onBodyClick}>
        <div ref={head} className="sticky top-0 z-[6] select-none border-b border-line bg-panel" style={{ width: gridW }}>
          <div className="grid grid-rows-[24px_24px]" style={{ gridTemplateColumns: template, width: gridW }}>{headCells}</div>
          {/* drop slot: opaque column box that covers the cells sliding underneath */}
          {ghost && dropSlot && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-[8] animate-tin rounded-md border-2 border-dashed border-accent bg-[#1B2213]"
              style={{ left: dropSlot.left, width: Math.max(dropSlot.w, 46) }}
            >
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-accent px-1.5 py-[1px] text-[10px] font-semibold text-accent-ink">
                วางที่นี่
              </span>
            </div>
          )}
        </div>
        {pinRows.length > 0 && (
          <div className="sticky z-[5] bg-panel shadow-[0_8px_12px_-8px_rgba(0,0,0,.6)]" style={{ top: HEAD_H, width: gridW }}>{pinRows.map(p => rowProps(p, true))}</div>
        )}
        <div className="relative" style={{ width: gridW, height: normRows.length * ROW_H }}>
          <div className="absolute left-0" style={{ top: s0 * ROW_H }}>{slice.map(p => rowProps(p, false))}</div>
          {/* opaque body band so the shifting cells never show through the slot */}
          {ghost && dropSlot && (
            <div
              className="pointer-events-none absolute top-0 z-[7] bg-panel"
              style={{ left: dropSlot.left, width: Math.max(dropSlot.w, 46), height: normRows.length * ROW_H }}
            />
          )}
        </div>
      </div>
      {viewRows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center bg-panel text-center text-[12.5px] text-dim">
          <div>ไม่มีรายการในมุมมองนี้<small className="mt-[3px] block text-[11px] text-dim2">{emptyWhy}</small></div>
        </div>
      )}
      {/* ghost column following the pointer while reordering */}
      {ghost && (() => {
        const d = COL_DEFS[ghost.key];
        const w = Math.max(wOf(ghost.key), 54);
        return (
          <div
            className="pointer-events-none fixed z-[97] animate-tin rounded-md border border-accent bg-panel/95 px-2 py-1 shadow-[0_14px_34px_rgba(0,0,0,.6)] backdrop-blur-sm"
            style={{ left: Math.max(6, Math.min(ghost.x + 12, window.innerWidth - w - 12)), top: Math.max(6, ghost.y - 40), width: w }}
          >
            <div className="flex items-center gap-[3px] overflow-hidden whitespace-nowrap font-sans text-[11.5px] font-semibold text-accent">
              <GripIcon />
              <span className="truncate">{d.label}</span>
            </div>
            <div className="mt-[3px] h-[3px] rounded-full bg-accent/70" />
          </div>
        );
      })()}
    </div>
  );
}
