import { ChevronDown, Search, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { menuItem, pickBtn, stDot } from './styles';
import { useTipProps } from './Tip';

export interface SelectItem { v: string; l: string; dot?: string }

interface SelectProps {
  value: string;
  items: SelectItem[];
  onChange: (v: string) => void;
  className?: string;
  /** Show a × on the trigger that clears the selection. */
  clearable?: boolean;
}

/** Dropdown button + portal menu (auto search box for long lists). */
export function Select({ value, items, onChange, className = '', clearable }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0, minWidth: 150 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setQ(''); }, []);
  useOutsideClose([btn, menu], close, open);

  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const mw = menu.current.offsetWidth, mh = menu.current.offsetHeight;
    setPos({
      minWidth: Math.max(150, r.width),
      left: Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)),
      top: r.bottom + mh > window.innerHeight ? r.top - mh : r.bottom,
    });
  }, [open, q]);

  const cur = items.find(i => i.v === value);
  const shown = q ? items.filter(i => i.l.toLowerCase().includes(q.trim().toLowerCase())) : items;

  return (
    <>
      <button ref={btn} type="button" className={`${pickBtn} ${className}`} onClick={() => setOpen(o => !o)}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {cur?.dot && <span className={stDot} style={{ background: cur.dot }} />}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{cur?.l ?? ''}</span>
        </span>
        {clearable && value ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={e => { e.stopPropagation(); onChange(''); }}
            onPointerDown={e => e.stopPropagation()}
            {...useTipProps('ล้างค่านี้')}
            className="grid size-[15px] flex-none cursor-pointer place-items-center rounded-full text-dim2 hover:bg-panel2 hover:text-ink"
          ><X size={11} /></span>
        ) : (
          <ChevronDown size={12} className="shrink-0 text-dim2" />
        )}
      </button>
      {open && createPortal(
        <div data-portal ref={menu} className="fixed z-[96] max-h-[300px] min-w-[150px] animate-tin overflow-hidden rounded-[11px] border border-line2 bg-panel p-[5px] shadow-[0_18px_44px_rgba(0,0,0,.55)]" style={pos}>
          {items.length > 6 && (
            <div className="mb-1.5 flex items-center gap-1.5 border-b border-line bg-panel px-[9px] py-[7px]">
              <Search size={13} className="shrink-0 text-dim2" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="ค้นหา…"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-dim2"
              />
              {q && <button type="button" className="px-[3px] font-display text-sm font-semibold text-dim2 hover:text-accent" onClick={() => setQ('')}>×</button>}
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto rounded-[7px]">
            {shown.map(it => (
              <div key={it.v} className={menuItem(it.v === value)} onClick={() => { onChange(it.v); close(); }}>
                {it.dot && <span className={stDot} style={{ background: it.dot }} />}
                <span className="flex-1">{it.l}</span>
                {it.v === value && '✓'}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
