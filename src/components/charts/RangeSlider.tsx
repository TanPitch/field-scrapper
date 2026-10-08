import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { dfmtShort, numDate } from '../../lib/format';
import { tickLabel, tickValues } from './PriceChart';
import { patchApp, useApp } from '../../store/useApp';
import type { Parcel } from '../../types';

const DAY = 864e5;
type Handle = 'min' | 'max';

/**
 * Dual-handle range slider under the price chart. Dragging a handle writes
 * `chartRange` directly, so it stays in sync with the date buttons above the chart.
 */
export function RangeSlider({ parcel: p }: { parcel: Parcel }) {
  const chartRange = useApp(s => s.chartRange);
  const chartTick = useApp(s => s.chartTick);
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);

  const f0 = p.hist[0].d, f1 = p.hist[p.hist.length - 1].d;
  const span = Math.max(DAY, f1 - f0);
  const min = Math.max(f0, Math.min(chartRange?.min ?? f0, f1));
  const max = Math.min(f1, Math.max(chartRange?.max ?? f1, min + DAY));
  const loPct = ((min - f0) / span) * 100;
  const hiPct = ((max - f0) / span) * 100;
  const isFull = loPct <= 0.5 && hiPct >= 99.5;

  /* Month markers span the whole timeline, so they stay put while a handle moves. */
  const markers = useMemo(() => {
    if (chartTick === 'none') return [];
    return tickValues(f0, f1, chartTick).map(ts => ({ ts, pct: ((ts - f0) / span) * 100 }));
  }, [chartTick, f0, f1, span]);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ts = f0 + t * span;
      const cur = useApp.getState().chartRange ?? { min: f0, max: f1 };
      if (drag === 'min') patchApp({ chartRange: { min: Math.min(ts, cur.max - DAY), max: cur.max } });
      else patchApp({ chartRange: { min: cur.min, max: Math.max(ts, cur.min + DAY) } });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, f0, f1, span]);

  const start = (h: Handle) => (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(h);
  };

  return (
    <div className="mt-1.5 select-none px-[2px]">
      <div className="relative">
        {/* marker lines sit above the track; their labels hang below it */}
        {markers.map(m => (
          <span key={m.ts} className="pointer-events-none absolute bottom-full h-[7px] w-px bg-dim2" style={{ left: `${m.pct}%` }} />
        ))}
      </div>
      <div ref={track} className="relative h-1.5 w-full cursor-pointer rounded-full bg-line2">
        <div className="absolute inset-y-0 rounded-full bg-accent/45" style={{ left: `${loPct}%`, width: `${Math.max(hiPct - loPct, 0.5)}%` }} />
        <button
          type="button" aria-label="วันที่เริ่ม"
          onPointerDown={start('min')}
          className={`absolute top-1/2 z-[2] size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-accent bg-panel shadow-[0_1px_4px_rgba(0,0,0,.5)] transition hover:scale-110 ${drag === 'min' ? 'scale-125' : ''}`}
          style={{ left: `${loPct}%` }}
        />
        <button
          type="button" aria-label="วันที่สิ้นสุด"
          onPointerDown={start('max')}
          className={`absolute top-1/2 z-[2] size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-accent bg-panel shadow-[0_1px_4px_rgba(0,0,0,.5)] transition hover:scale-110 ${drag === 'max' ? 'scale-125' : ''}`}
          style={{ left: `${hiPct}%` }}
        />
      </div>
      <div className="relative h-[13px] w-full">
        {markers.map(m => (
          <span key={m.ts} className="pointer-events-none absolute top-0 whitespace-nowrap text-[9px] text-dim2" style={{ left: `${m.pct}%`, transform: 'translateX(-50%)' }}>
            {tickLabel(m.ts, chartTick)}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] text-dim2">
        <span>{dfmtShort.format(f0)}</span>
        <span className={isFull ? 'text-dim2' : 'text-accent'}>
          {isFull ? 'ลากที่จุดกลมเพื่อเลือกช่วงวันที่' : `${numDate(min)} – ${numDate(max)}`}
        </span>
        <span>{dfmtShort.format(f1)}</span>
      </div>
    </div>
  );
}