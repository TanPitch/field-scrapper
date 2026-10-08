import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { PRESET_COLORS } from '../../data/constants';
import { hexRgb, hexToHsv, hsvToHex, rgbaStr, type HSV } from '../../lib/color';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { popupBox } from './styles';
import { useTipProps } from './Tip';

interface ColorButtonProps {
  value: string;
  /** Alpha in 0..1 — only when `alpha` is set. */
  alphaValue?: number;
  alpha?: boolean;
  onChange: (hex: string, a: number) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const dotCls = 'pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,.6)]';

/** Drag helper that keeps tracking while the pointer is captured. */
function useDrag(onMove: (e: RPointerEvent<HTMLDivElement>) => void) {
  return {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      onMove(e);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e);
    },
  };
}

/** A swatch button that opens an HSV(+alpha) picker in a portal. */
export function ColorButton({ value, alphaValue = 1, alpha = false, onChange, className = '', style, title }: ColorButtonProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose([btn, pop], close, open);
  const [cur, setCur] = useState<HSV & { a: number }>(() => ({ ...hexToHsv(value), a: alphaValue }));
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const toggle = () => {
    if (!open) setCur({ ...hexToHsv(value), a: alphaValue });
    setOpen(o => !o);
  };
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const mw = 224, mh = pop.current.offsetHeight;
    let top = r.top - mh - 8;
    if (top < 8) top = r.bottom + 8;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)), top: Math.min(top, window.innerHeight - mh - 8) });
  }, [open]);

  const update = (next: HSV & { a: number }) => { setCur(next); onChange(hsvToHex(next.h, next.s, next.v), next.a); };
  const hex = hsvToHex(cur.h, cur.s, cur.v);
  const [r, g, b] = hexRgb(hex);

  const svDrag = useDrag(e => {
    const rect = e.currentTarget.getBoundingClientRect();
    update({ ...cur, s: clamp01((e.clientX - rect.left) / rect.width), v: clamp01(1 - (e.clientY - rect.top) / rect.height) });
  });
  const hueDrag = useDrag(e => {
    const rect = e.currentTarget.getBoundingClientRect();
    update({ ...cur, h: clamp01((e.clientX - rect.left) / rect.width) * 360 });
  });
  const alphaDrag = useDrag(e => {
    const rect = e.currentTarget.getBoundingClientRect();
    update({ ...cur, a: clamp01((e.clientX - rect.left) / rect.width) });
  });

  return (
    <>
      <button ref={btn} type="button" {...useTipProps(title)} onClick={toggle} className={className} style={style} />
      {open && createPortal(
        <div data-portal ref={pop} className={`${popupBox} w-56`} style={pos}>
          <div className="relative h-[130px] cursor-crosshair touch-none overflow-hidden rounded-lg" style={{ background: `hsl(${cur.h},100%,50%)` }} {...svDrag}>
            <div className="absolute inset-0 bg-gradient-to-r from-white to-white/0" />
            <div className="absolute inset-0 bg-gradient-to-t from-black to-black/0" />
            <span className={dotCls} style={{ left: `${cur.s * 100}%`, top: `${(1 - cur.v) * 100}%`, background: hex }} />
          </div>
          <div
            className="relative mt-2.5 h-3.5 cursor-pointer touch-none rounded-[7px]"
            style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
            {...hueDrag}
          >
            <span className={`${dotCls} top-1/2`} style={{ left: `${(cur.h / 360) * 100}%`, background: `hsl(${cur.h},100%,50%)` }} />
          </div>
          {alpha && (
            <div
              className="relative mt-2 h-3.5 cursor-pointer touch-none rounded-[7px] border border-line2"
              style={{ backgroundImage: 'linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,0 4px,4px -4px,-4px 0' }}
              {...alphaDrag}
            >
              <span className="absolute inset-0 rounded-md" style={{ background: `linear-gradient(90deg, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))` }} />
              <span className={`${dotCls} top-1/2 z-[2]`} style={{ left: `${cur.a * 100}%`, background: hex }} />
            </div>
          )}
          <div className="mt-2.5 grid grid-cols-9 gap-[5px]">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className="aspect-square cursor-pointer rounded-[5px] border border-white/10 p-0 hover:scale-110"
                style={{ background: c }}
                onClick={() => update({ ...hexToHsv(c), a: cur.a })}
              />
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-[7px]">
            <span className="size-[26px] flex-none rounded-[7px] border border-line2" style={{ background: alpha ? rgbaStr({ c: hex, a: cur.a }) : hex }} />
            <span className="flex-1 font-display text-xs font-medium text-dim">{hex.toUpperCase()}{alpha ? ` · ${Math.round(cur.a * 100)}%` : ''}</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
