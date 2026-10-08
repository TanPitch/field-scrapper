import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTipProps } from './Tip';
import { createPortal } from 'react-dom';
import { TH_MONTHS, TH_WEEKDAYS } from '../../data/constants';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { menuBox } from './styles';

interface DateButtonProps {
  value: number | null | undefined;
  onPick: (ts: number) => void;
  className?: string;
  children: ReactNode;
}
type Mode = 'day' | 'month' | 'year';

const nav = 'grid h-[26px] min-w-[26px] flex-none cursor-pointer place-items-center rounded-md px-1 font-display text-[13px] font-semibold text-dim hover:bg-panel2 hover:text-accent';
const jump = 'flex-none cursor-pointer rounded-md px-1.5 py-[3px] text-xs font-semibold text-ink hover:bg-panel2 hover:text-accent';
const cell = (extra = '') => `grid aspect-square cursor-pointer place-items-center rounded-[7px] font-display text-[11px] font-medium text-ink hover:bg-panel2 ${extra}`;

/** Thai Buddhist-year date picker (day → month → year drill-down) in a portal. */
export function DateButton({ value, onPick, className = '', children }: DateButtonProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose([btn, pop], close, open);

  const [mode, setMode] = useState<Mode>('day');
  const [view, setView] = useState(() => new Date());
  const [yrC, setYrC] = useState<number | null>(null);
  const sel = value != null ? new Date(value) : null;
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const toggle = () => {
    if (!open) {
      const base = value != null ? new Date(value) : new Date();
      setView(new Date(base.getFullYear(), base.getMonth(), 1));
      setMode('day');
    }
    setOpen(o => !o);
  };
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const mw = 248, mh = pop.current.offsetHeight;
    let top = r.top - mh;
    if (top < 8) top = r.bottom;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)), top: Math.min(top, window.innerHeight - mh - 8) });
  }, [open, mode, view]);

  const y = view.getFullYear(), m = view.getMonth();
  const shiftMonth = (d: number) => setView(new Date(y, m + d, 1));
  const shiftYear = (d: number) => setView(new Date(y + d, m, 1));
  const today = new Date().toDateString();

  let body: ReactNode;
  if (mode === 'day') {
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), prevDays = new Date(y, m, 0).getDate();
    const trail = (7 - ((first + days) % 7)) % 7;
    body = (
      <>
        <div className="mb-1.5 flex items-center gap-1">
          <button className={nav} onClick={() => shiftMonth(-1)}>‹</button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
            <button className={jump} {...useTipProps('เลือกเดือน')} onClick={() => { setMode('month'); setYrC(y); }}>{TH_MONTHS[m]}</button>
            <button className={jump} {...useTipProps('เลือกปี')} onClick={() => { setMode('year'); setYrC(y); }}>{y + 543}</button>
          </div>
          <button className={nav} onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {TH_WEEKDAYS.map(w => <span key={w} className="py-[3px] text-center text-[9.5px] font-medium text-dim2">{w}</span>)}
          {Array.from({ length: first }, (_, i) => <button key={'p' + i} disabled className={cell('opacity-40 !text-dim2')}>{prevDays - (first - 1 - i)}</button>)}
          {Array.from({ length: days }, (_, i) => {
            const dt = new Date(y, m, i + 1, 12);
            const isSel = sel?.toDateString() === dt.toDateString();
            return (
              <button
                key={i}
                className={cell(`${isSel ? '!bg-accent font-bold !text-accent-ink' : ''} ${dt.toDateString() === today ? 'shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`)}
                onClick={() => { close(); onPick(dt.getTime()); }}
              >{i + 1}</button>
            );
          })}
          {Array.from({ length: trail }, (_, i) => <button key={'t' + i} disabled className={cell('opacity-40 !text-dim2')}>{i + 1}</button>)}
        </div>
      </>
    );
  } else if (mode === 'month') {
    body = (
      <>
        <div className="mb-1.5 flex items-center gap-1">
          <button className={nav} onClick={() => shiftYear(-1)}>‹</button>
          <div className="flex min-w-0 flex-1 items-center justify-center"><button className={jump} onClick={() => { setMode('year'); setYrC(y); }}>{y + 543}</button></div>
          <button className={nav} onClick={() => shiftYear(1)}>›</button>
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {TH_MONTHS.map((mm, i) => (
            <button
              key={mm}
              className={`${cell(sel && sel.getFullYear() === y && sel.getMonth() === i ? '!bg-accent font-bold !text-accent-ink' : '')} !aspect-auto h-[30px]`}
              onClick={() => { setView(new Date(y, i, 1)); setMode('day'); }}
            >{mm}</button>
          ))}
        </div>
      </>
    );
  } else {
    const cy = yrC ?? y;
    body = (
      <>
        <div className="mb-1.5 flex items-center gap-1">
          <button className={nav} onClick={() => setYrC(cy - 16)}>‹</button>
          <span className="flex-1 text-center text-xs font-semibold">{cy - 8 + 543} – {cy + 7 + 543}</span>
          <button className={nav} onClick={() => setYrC(cy + 16)}>›</button>
        </div>
        <div className="grid grid-cols-4 gap-0.5">
          {Array.from({ length: 16 }, (_, i) => cy - 8 + i).map(yy => (
            <button
              key={yy}
              className={`${cell(sel?.getFullYear() === yy ? '!bg-accent font-bold !text-accent-ink' : '')} !aspect-auto h-[30px]`}
              onClick={() => { setView(new Date(yy, m, 1)); setMode('month'); }}
            >{yy + 543}</button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <button ref={btn} type="button" className={className} onClick={toggle}>{children}</button>
      {open && createPortal(
        <div data-portal ref={pop} className={`${menuBox} !z-[97] w-[248px] !max-h-none p-2`} style={pos}>{body}</div>,
        document.body,
      )}
    </>
  );
}
