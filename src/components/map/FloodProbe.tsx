import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { elevAt } from '../../map/protocols';
import { useApp } from '../../store/useApp';

export interface ProbeHit { x: number; y: number; el: number }

/** Floating elevation read-out; the parent feeds it pointer events through `setPoint`. */
export function FloodProbe({ hit, dot, size }: { hit: ProbeHit | null; dot: { x: number; y: number } | null; size: { w: number; h: number } }) {
  const sea = useApp(s => s.flood.sea);
  const box = useRef<HTMLDivElement>(null);
  if (!dot) return null;
  const diff = hit ? hit.el - sea : 0, under = diff < 0;
  const left = hit ? Math.min(hit.x + 14, size.w - (box.current?.offsetWidth ?? 160) - 8) : 0;
  const top = hit ? Math.min(hit.y + 14, size.h - (box.current?.offsetHeight ?? 90) - 8) : 0;
  return (
    <>
      <div className="pointer-events-none absolute z-[18] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#7FD4FF] shadow-[0_0_6px_rgba(0,0,0,.5)]" style={{ left: dot.x, top: dot.y }} />
      {hit && (
        <div
          ref={box}
          className={`pointer-events-none absolute z-[17] min-w-[150px] whitespace-nowrap rounded-[11px] border px-3 py-2 text-[10.5px] leading-normal ${
            under ? 'border-[#2F6FB5] bg-[rgba(8,26,48,.94)]' : 'border-line2 bg-[rgba(11,13,11,.94)]'
          } ${under ? 'text-[#EAF4FF]' : 'text-white'}`}
          style={{ left, top }}
        >
          <div className="font-display text-xl font-bold leading-[1.1]" style={{ color: under ? '#7FD4FF' : '#E9EDF3' }}>
            {Math.abs(diff).toFixed(2)} <span className="text-xs">ม.</span>
          </div>
          <div className={`mb-[5px] text-[10px] ${under ? 'text-[#BFE8FF]/70' : 'text-white/65'}`}>{under ? 'ความลึกใต้น้ำ' : 'สูงเหนือระดับน้ำ'}</div>
          <div className={`mt-[3px] flex justify-between gap-3.5 border-t pt-[3px] ${under ? 'border-[#7FD4FF]/20' : 'border-white/[.14]'}`}><span>ระดับน้ำ (ตั้งค่า)</span><b className="font-display font-medium text-[#BFE8FF]">{sea} ม.</b></div>
          <div className={`mt-[3px] flex justify-between gap-3.5 border-t pt-[3px] ${under ? 'border-[#7FD4FF]/20' : 'border-white/[.14]'}`}><span>ความสูงจริง</span><b className="font-display font-medium text-[#BFE8FF]">{hit.el.toFixed(2)} ม.</b></div>
        </div>
      )}
    </>
  );
}

/** Hook-style helper: resolve elevation for a pointer event. */
export function useFloodProbe(wrapRef: React.RefObject<HTMLElement | null>) {
  const [hit, setHit] = useState<ProbeHit | null>(null);
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seq = useRef(0);

  useEffect(() => {
    if (!useApp.getState().floodProbe) { setHit(null); setDot(null); }
  }, []);

  const onPointer = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent, zoom: number, maxZ: number) => {
    setDot({ x: e.point.x, y: e.point.y });
    setSize({ w: wrapRef.current?.clientWidth ?? 0, h: wrapRef.current?.clientHeight ?? 0 });
    const my = ++seq.current;
    const z = Math.min(maxZ, Math.max(5, Math.floor(zoom)));
    elevAt(e.lngLat.lng, e.lngLat.lat, z)
      .then(el => { if (my === seq.current) setHit({ x: e.point.x, y: e.point.y, el }); })
      .catch(() => { /* tile failed — keep last value */ });
  };
  const clear = () => { seq.current++; setHit(null); setDot(null); };
  return { hit, dot, size, onPointer, clear };
}
