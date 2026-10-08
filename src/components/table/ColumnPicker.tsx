import { Pin, X } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { COL_DEFS } from '../../data/constants';
import { useAboveBelow } from '../../hooks/usePlacement';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { resetColumns, toggleColPin } from '../../store/actions';
import { patchApp, toast, useApp } from '../../store/useApp';
import type { ColKey } from '../../types';
import { btn, iconBtn } from '../ui/styles';
import { Switch } from '../ui/Switch';

const Grip = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-[11px]">
    <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" />
    <circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
  </svg>
);

interface DragState { key: ColKey; refKey: ColKey | null; before: boolean; moved: boolean }

export function ColumnPicker({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose([ref, { current: anchor }], onClose, true);
  const pos = useAboveBelow(ref, anchor, 280);
  const order = useApp(s => s.colOrder);
  const hidden = useApp(s => s.colHidden);
  const pinned = useApp(s => s.colPinned);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const set = (d: DragState | null) => { dragRef.current = d; setDrag(d); };

  const setHidden = (k: ColKey, show: boolean) => {
    const next = new Set(useApp.getState().colHidden);
    if (show) next.delete(k); else next.add(k);
    patchApp({ colHidden: next });
  };

  const down = (e: RPointerEvent<HTMLElement>, key: ColKey) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    set({ key, refKey: null, before: false, moved: false });
  };
  const move = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current; if (!d || !ref.current) return;
    const rows = [...ref.current.querySelectorAll<HTMLElement>('[data-ck]')];
    let refKey: ColKey | null = null, before = false;
    for (const r of rows) {
      if (r.dataset.ck === d.key) continue;
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top) { refKey = r.dataset.ck as ColKey; before = true; break; }
      if (e.clientY <= b.bottom) { refKey = r.dataset.ck as ColKey; before = e.clientY < b.top + b.height / 2; break; }
    }
    set({ ...d, refKey, before, moved: true });
  };
  const end = () => {
    const d = dragRef.current; if (!d) return;
    set(null);
    if (!d.moved) return;
    const arr = useApp.getState().colOrder.filter(k => k !== d.key);
    const i = d.refKey ? arr.indexOf(d.refKey) : arr.length;
    arr.splice(d.before ? i : i + 1, 0, d.key);
    patchApp({ colOrder: arr });
  };

  return createPortal(
    <div ref={ref} data-portal className="fs-panel fixed z-[78] flex max-h-[min(70vh,470px)] w-[280px] animate-tin flex-col overflow-hidden rounded-xl border border-line2 bg-panel shadow-[0_18px_44px_rgba(0,0,0,.55)]" style={pos}>
      <div className="flex flex-none items-center bg-panel px-3 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-dim">
        แสดงคอลัมน์ · ปักหมุด · ลากสลับ
        <button className={`${iconBtn} ml-auto`} onClick={onClose}><X size={17} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
        {order.map(k => {
        const isDrag = drag?.key === k;
        const mark = drag && drag.refKey === k ? (drag.before ? 'shadow-[inset_0_2px_0_var(--accent)]' : 'shadow-[inset_0_-2px_0_var(--accent)]') : '';
        return (
          <div
            key={k} data-ck={k}
            className={`relative flex touch-none items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-panel2 ${isDrag ? 'rounded-md opacity-50 outline outline-1 outline-accent' : ''} ${mark}`}
            onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          >
            <span className="inline-flex flex-none cursor-grab p-0.5 text-dim2" {...useTipProps('ลากเพื่อสลับลำดับ')} onPointerDown={e => down(e, k)}><Grip /></span>
            <button
              type="button" {...useTipProps('ปักหมุดคอลัมน์นี้ไว้ซ้าย')} onClick={() => toggleColPin(k)}
              className={`inline-flex cursor-pointer border-none bg-transparent p-0.5 ${pinned.has(k) ? 'text-accent' : 'text-dim2 opacity-55 hover:text-ink'}`}
            ><Pin size={10} /></button>
            <Switch checked={!hidden.has(k)} onChange={v => setHidden(k, v)} />
            <span>{COL_DEFS[k].label}</span>
          </div>
        );
      })}
      </div>
      <div className="sticky bottom-0 z-[2] flex flex-none gap-2 border-t border-line bg-panel px-2.5 py-[9px]">
        <button className={`${btn} flex-1 justify-center`} onClick={() => patchApp({ colHidden: new Set<ColKey>() })}>แสดงทั้งหมด</button>
        <button className={`${btn} flex-1 justify-center`} onClick={() => { resetColumns(); toast('รีเซ็ตคอลัมน์แล้ว'); }}>รีเซ็ต</button>
      </div>
    </div>,
    document.body,
  );
}
