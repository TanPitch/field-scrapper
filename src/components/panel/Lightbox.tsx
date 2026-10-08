import { RotateCcw, X } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { LB_FIELDS, STATUS } from '../../data/constants';
import { PARCEL_BY_ID } from '../../data/mockData';
import { useMoney } from '../../hooks/useMoney';
import { fdate, fmtRai } from '../../lib/format';
import { popupKind } from '../../map/popups';
import { useApp } from '../../store/useApp';
import { useLightbox } from '../../store/useLightbox';
import { landImg } from './DetailView';

interface T { scale: number; x: number; y: number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const navCls = 'absolute top-1/2 z-[3] grid size-[30px] -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/25 bg-black/45 font-display text-lg leading-none text-white backdrop-blur hover:bg-black/70';
const topBtn = 'absolute top-3.5 z-[4] grid size-[38px] cursor-pointer place-items-center rounded-lg border border-white/20 bg-black/50 text-white';

/** Full-screen zoom/pan viewer (wheel, drag, pinch, double-tap). */
export function Lightbox() {
  const { open, index, close, setIndex } = useLightbox();
  const id = useApp(s => s.selectedId);
  const cfg = useApp(s => s.lbCfg);
  const fmt = useMoney();
  const p = id != null ? PARCEL_BY_ID.get(id) : undefined;

  const [t, setT] = useState<T>({ scale: 1, x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ scale: number; x: number; y: number; dist: number; mx: number; my: number } | null>(null);
  const lastTap = useRef(0);

  const apply = useCallback((n: T) => {
    const s = stage.current, im = img.current;
    let { x, y } = n;
    if (s && im) {
      const mw = Math.max(0, (im.offsetWidth * n.scale - s.clientWidth) / 2 + 20);
      const mh = Math.max(0, (im.offsetHeight * n.scale - s.clientHeight) / 2 + 20);
      x = clamp(x, -mw, mw); y = clamp(y, -mh, mh);
    }
    setT({ scale: n.scale, x, y });
  }, []);
  const reset = useCallback(() => apply({ scale: 1, x: 0, y: 0 }), [apply]);
  const step = useCallback((d: number) => { if (p) { setIndex((index + d + p.imgs) % p.imgs); reset(); } }, [p, index, setIndex, reset]);

  useEffect(() => { if (open) reset(); }, [open, reset]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, close, step]);

  const zoomAt = (cx: number, cy: number, f: number) => {
    const cur = tRef.current, s = stage.current; if (!s) return;
    const ns = clamp(cur.scale * f, 1, 8);
    const r = s.getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2), k = ns / cur.scale;
    apply(ns === 1 ? { scale: 1, x: 0, y: 0 } : { scale: ns, x: ox - k * (ox - cur.x), y: oy - k * (oy - cur.y) });
  };

  /* wheel must be non-passive to preventDefault */
  useEffect(() => {
    const el = stage.current; if (!el || !open) return;
    const w = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setGesturing(true);
    const cur = tRef.current;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { scale: cur.scale, x: cur.x, y: cur.y, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag.current = null;
    } else if (ptrs.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, ox: cur.x, oy: cur.y };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = stage.current; if (!s) return;
    if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()], pc = pinch.current;
      const ns = clamp(pc.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pc.dist), 1, 8);
      const r = s.getBoundingClientRect();
      const mx = pc.mx - (r.left + r.width / 2), my = pc.my - (r.top + r.height / 2), k = ns / pc.scale;
      apply(ns === 1 ? { scale: 1, x: 0, y: 0 } : { scale: ns, x: mx - k * (mx - pc.x), y: my - k * (my - pc.y) });
    } else if (drag.current) {
      const d = drag.current;
      apply({ scale: tRef.current.scale, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
    }
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0) {
      const now = performance.now();
      if (now - lastTap.current < 320) reset();
      lastTap.current = now; drag.current = null; setGesturing(false);
    } else if (ptrs.current.size === 1) {
      const [pt] = [...ptrs.current.values()], cur = tRef.current;
      drag.current = { x: pt.x, y: pt.y, ox: cur.x, oy: cur.y };
    }
  };

  if (!open || !p) return null;
  const i = ((index % p.imgs) + p.imgs) % p.imgs;
  const any = LB_FIELDS.some(([f]) => cfg[f]);
  const row = (l: string, v: string) => (
    <div key={l} className="flex justify-between gap-4 border-t border-white/[.12] py-[2.5px] text-[11px]"><span>{l}</span><b className="font-display font-medium">{v}</b></div>
  );

  return (
    <div className="fixed inset-0 z-[99] bg-black/90 backdrop-blur-md" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      {any && (
        <div className="absolute left-4 top-4 z-[3] max-w-[min(340px,70vw)] rounded-[10px] border border-white/[.14] bg-[rgba(10,12,10,.72)] px-3 py-2 text-white backdrop-blur-md">
          <div className="mb-[3px] font-display text-[10px] font-semibold text-accent">{i + 1}/{p.imgs}</div>
          {cfg.name && <div className="mb-0.5 text-[13px] font-semibold">{p.name}</div>}
          {cfg.price && row('ราคา', fmt(p.price))}
          {cfg.size && row('ขนาด', fmtRai(p.wah))}
          {cfg.status && row('สถานะ', STATUS[popupKind(p)].th)}
          {cfg.deed && row('เลขโฉนด', p.deed)}
          {cfg.soldTs && p.soldTs && row('ขายออก', fdate(p.soldTs))}
        </div>
      )}
      <button className={`${topBtn} right-3.5`} onClick={close}><X size={17} /></button>
      <button className={`${topBtn} right-[60px]`} {...useTipProps('รีเซ็ตการซูม')} onClick={reset}><RotateCcw size={17} /></button>
      {p.imgs > 1 && (
        <>
          <button className={`${navCls} left-2`} onClick={() => step(-1)}>‹</button>
          <button className={`${navCls} right-2`} onClick={() => step(1)}>›</button>
        </>
      )}
      <div
        ref={stage}
        className="absolute inset-0 grid cursor-grab touch-none place-items-center overflow-hidden active:cursor-grabbing"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={e => zoomAt(e.clientX, e.clientY, tRef.current.scale > 1 ? 1 / tRef.current.scale : 2.2)}
      >
        <img
          ref={img} src={landImg(p, i, 1280, 720)} alt="ภาพขยายแปลงที่ดิน" draggable={false}
          className="pointer-events-none max-h-[82vh] max-w-[92vw] will-change-transform"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, transition: gesturing ? 'none' : 'transform .18s ease' }}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3.5 z-[3] text-center text-[11px] text-white/55">
        ลากเพื่อเลื่อน · สกอลล์/บีบนิ้วเพื่อซูม · ดับเบิลคลิก/แตะสองนิ้วซูม · ปุ่ม ↺ รีเซ็ต · Esc ปิด
      </div>
    </div>
  );
}
