import { useEffect, useRef, useState } from 'react';
import { patchApp, toast, useApp } from '../../store/useApp';

/* Manual coordinate calibration, temporary.
 *
 * TD's own pin is itself a metre or two off the parcel, so "the marker is wrong"
 * is measured against a reference that is also wrong. Rather than argue about
 * whose offset is correct, this lets the user walk a known-good point onto a
 * marker by eye and read back the correction in degrees, then paste it back.
 *
 * Step is 0.00001 deg ≈ 1.1 m. The whole correction the user has described is
 * 1-15 m, so six decimals with a 1e-5 step covers it without a unit converter. */

const STEP = 0.00001;
const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(5);
const metres = (v: number) => (v * 111_320).toFixed(1);

export function OffsetPanel() {
  const off = useApp(s => s.coordOffset);
  const [pos, setPos] = useState({ x: 24, y: 120 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onHead = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos(() => ({
        x: Math.max(0, Math.min(window.innerWidth - 250, e.clientX - drag.current!.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 190, e.clientY - drag.current!.dy)),
      }));
    };
    const up = () => { drag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  /* Typed input keeps its own draft string so a half-typed "-" or "" survives
     instead of being read back as 0 on the next render. The store is written on
     every keystroke that parses, because the map should follow the number being
     typed rather than waiting for blur. */
  const [draft, setDraft] = useState<Record<'lat' | 'lng', string | null>>({ lat: null, lng: null });
  const set = (k: 'lat' | 'lng', raw: string) => {
    setDraft(d => ({ ...d, [k]: raw }));
    const v = parseFloat(raw);
    if (Number.isFinite(v)) patchApp({ coordOffset: { ...off, [k]: Number(v.toFixed(5)) } });
  };
  const clearDraft = (k: 'lat' | 'lng') => setDraft(d => ({ ...d, [k]: null }));

  const nudge = (k: 'lat' | 'lng', n: number) => {
    clearDraft(k);
    patchApp({ coordOffset: { ...off, [k]: Number((off[k] + n * STEP).toFixed(5)) } });
  };

  const copy = () => {
    const text = `${fmt(off.lat)}, ${fmt(off.lng)}`;
    navigator.clipboard?.writeText(text).then(
      () => toast(`คัดลอก offset แล้ว: ${text}`),
      () => toast(text, 'warn'),
    );
  };

  const row = (label: 'lat' | 'lng') => (
    <div className="flex items-center gap-1">
      <span className="w-7 font-mono text-[10.5px] text-dim2">{label}</span>
      <button className="w-6 rounded border border-line py-0.5 text-[12px] leading-none hover:bg-panel2"
        onClick={() => nudge(label, -1)}>-</button>
      <input type="number" step={STEP} value={draft[label] ?? off[label]}
        onChange={e => set(label, e.target.value)}
        onBlur={() => clearDraft(label)}
        className="w-[74px] rounded border border-line bg-bg px-1 py-0.5 text-center font-mono text-[11px] tabular-nums outline-none focus:border-accent" />
      <button className="w-6 rounded border border-line py-0.5 text-[12px] leading-none hover:bg-panel2"
        onClick={() => nudge(label, 1)}>+</button>
      <span className="w-12 text-right text-[10px] text-dim2">{metres(off[label])} m</span>
    </div>
  );

  return (
    <div className="absolute z-20 w-[240px] rounded-lg border border-line2 bg-panel shadow-[0_8px_22px_rgba(0,0,0,.5)]"
      style={{ left: pos.x, top: pos.y }}>
      <div ref={onHead}
        onPointerDown={e => {
          const r = onHead.current!.parentElement!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        }}
        className="cursor-grab rounded-t-lg border-b border-line bg-panel2 px-2 py-1.5 text-[11px] font-medium active:cursor-grabbing">
        เลื่อนพิกัด (ชั่วคราว)
      </div>
      <div className="space-y-1.5 p-2">
        {row('lat')}
        {row('lng')}
        <div className="flex gap-1 pt-0.5">
          <button className="flex-1 rounded border border-line py-1 text-[10.5px] hover:bg-panel2"
            onClick={copy}>คัดลอกค่า</button>
          <button className="flex-1 rounded border border-line py-1 text-[10.5px] hover:bg-panel2"
            onClick={() => patchApp({ coordOffset: { lat: 0, lng: 0 } })}>รีเซ็ต</button>
        </div>
      </div>
    </div>
  );
}
