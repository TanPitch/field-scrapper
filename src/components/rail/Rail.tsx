import { Layers, List, Map as MapIcon, MapPin, PenTool, Pentagon, Circle, Settings2, Spline, type LucideIcon } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BASEMAPS, HEADER_H, RAIL_GAP } from '../../data/constants';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { startDrawTool } from '../../map/drawEngine';
import { setBasemap, setLeft, setRight, setRpView, showRight, updateOverlay } from '../../store/actions';
import { patchApp, useApp } from '../../store/useApp';
import type { DrawTool, RightView } from '../../types';
import { Switch } from '../ui/Switch';

type RailId = 'results' | 'basemap' | 'pins' | 'overlay' | 'draw';
const BUTTONS: { id: RailId; title: string; Icon: LucideIcon }[] = [
  { id: 'results', title: 'ผลการค้นหา', Icon: List },
  { id: 'basemap', title: 'แผนที่ฐาน — เลือกด่วน', Icon: MapIcon },
  { id: 'pins', title: 'ปักหมุด — ที่ดิน / CCTV / เซ็นเซอร์น้ำ', Icon: MapPin },
  { id: 'overlay', title: 'โอเวอร์เลย์ — สลับเลย์เยอร์', Icon: Layers },
  { id: 'draw', title: 'เครื่องมือวาด', Icon: PenTool },
];
const POPUP_IDS: RailId[] = ['basemap', 'pins', 'overlay', 'draw'];

const sdG = 'flex items-center gap-[7px] px-[7px] pb-1.5 pt-[5px] text-[10px] font-semibold uppercase tracking-[.08em] text-dim2';
const bmp = (on: boolean, ghost = false) =>
  `mb-1.5 flex w-full cursor-pointer items-center gap-[9px] rounded-[9px] border p-[9px] text-left text-[12.5px] font-medium text-ink hover:border-line2 ${
    ghost ? 'justify-center border-dashed border-line bg-transparent text-accent' : on ? 'border-accent bg-accent-dim' : 'border-line'}`;
const rowBtn = 'grid size-6 flex-none cursor-pointer place-items-center rounded-[7px] border border-line2 text-dim2 transition hover:border-accent hover:text-accent';

function BasemapPop({ close }: { close: () => void }) {
  const bm = useApp(s => s.basemap);
  const item = (id: 'road' | 'sat', th: string, en: string) => (
    <button className={bmp(bm === id)} onClick={() => { setBasemap(id); close(); }}>
      <span className="h-5 w-[30px] flex-none rounded-md border border-line2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]" style={{ background: BASEMAPS[id].sw }} />
      {th}<span className="ml-auto font-display text-[10px] font-normal text-dim2">{en}</span>
    </button>
  );
  return <><div className={sdG}>แผนที่ฐาน</div>{item('road', 'ถนน', 'Roadmap')}{item('sat', 'ดาวเทียม', 'Satellite')}</>;
}

function OverlayPop({ close }: { close: () => void }) {
  const overlays = useApp(s => s.overlays);
  return (
    <>
      <div className={sdG}>โอเวอร์เลย์</div>
      {overlays.map(ov => (
        <div key={ov.id} className="flex items-center gap-2 rounded-lg px-1.5 py-[7px]">
          <span className="size-[9px] flex-none rounded-[3px]" style={{ background: ov.color }} />
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]" {...useTipProps(ov.desc)}>{ov.name}</span>
          <button className={rowBtn} {...useTipProps('ตั้งค่าเลย์เยอร์นี้ในแผงขวา')} onClick={() => { patchApp({ overlaySel: ov.id }); close(); showRight('overlay'); }}><Settings2 size={12} /></button>
          <Switch checked={ov.visible} onChange={v => updateOverlay(ov.id, { visible: v }, true)} />
        </div>
      ))}
    </>
  );
}

function PinsPop({ close }: { close: () => void }) {
  const landOn = useApp(s => s.landOn), cctvOn = useApp(s => s.cctvOn), sensOn = useApp(s => s.sensOn), transportOn = useApp(s => s.transportOn);
  const row = (color: string, label: string, on: boolean, set: (v: boolean) => void, gear?: ReactNode) => (
    <div className="flex items-center gap-2 rounded-lg px-1.5 py-[7px]">
      <span className="size-[9px] flex-none rounded-[3px]" style={{ background: color }} />
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">{label}</span>
      {gear}<Switch checked={on} onChange={set} />
    </div>
  );
  return (
    <>
      <div className={sdG}>หมุดบนแผนที่</div>
      {row('#B8F13F', 'ที่ดิน', landOn, v => patchApp({ landOn: v }))}
      {row('#FFC94D', 'กล้อง CCTV', cctvOn, v => patchApp({ cctvOn: v }))}
      {row('#4C9AFF', 'เซ็นเซอร์น้ำ/เขื่อน', sensOn, v => patchApp({ sensOn: v }),
        <button className={rowBtn} {...useTipProps('ตั้งค่า — opacity')} onClick={() => { close(); showRight('pins-settings'); }}><Settings2 size={12} /></button>)}
      {row('#FF9F43', 'รถประจำทาง', transportOn, v => patchApp({ transportOn: v }),
        <button className={rowBtn} {...useTipProps('ตั้งค่าหมุดรถประจำทาง')} onClick={() => { close(); showRight('transport-settings'); }}><Settings2 size={12} /></button>)}
    </>
  );
}

function DrawPop({ close }: { close: () => void }) {
  const tool = (t: DrawTool, label: string, Icon: LucideIcon) => (
    <button className={bmp(false)} onClick={() => { close(); startDrawTool(t); }}><Icon size={14} className="flex-none" />{label}</button>
  );
  return (
    <>
      <div className={sdG}>เครื่องมือวาด</div>
      {tool('line', 'เส้น (polyline)', Spline)}
      {tool('poly', 'พื้นที่ (polygon)', Pentagon)}
      {tool('circle', 'วงกลม', Circle)}
      <button className={bmp(false, true)} onClick={() => { close(); setRight(true); setRpView('draw'); }}><Layers size={14} className="flex-none" />แสดงชั้นข้อมูลทั้งหมด</button>
    </>
  );
}

function RailPopup({ id, anchor, onClose }: { id: RailId; anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useOutsideClose([ref, { current: anchor }], onClose, true);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = anchor.getBoundingClientRect();
    setPos({
      left: Math.min(r.right + RAIL_GAP, window.innerWidth - el.offsetWidth - 8),
      top: Math.max(8, Math.min(r.top - 6, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [anchor, id]);
  const body = id === 'basemap' ? <BasemapPop close={onClose} /> : id === 'pins' ? <PinsPop close={onClose} /> : id === 'overlay' ? <OverlayPop close={onClose} /> : <DrawPop close={onClose} />;
  return createPortal(
    <div
      ref={ref}
      className={`fs-panel fixed z-[75] max-w-[calc(100vw-84px)] animate-tin rounded-xl border border-line2 bg-panel p-2 shadow-[0_18px_44px_rgba(0,0,0,.55)] ${id === 'pins' ? 'w-[230px]' : 'min-w-[216px]'}`}
      style={pos}
    >
      {body}
    </div>,
    document.body,
  );
}

const useSmall = (): boolean => {
  const [s, setS] = useState(() => window.matchMedia('(max-width:700px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:700px)');
    const h = () => setS(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return s;
};
export { useSmall };

export function Rail({ small, floating = false }: { small: boolean; floating?: boolean }) {
  const [pop, setPop] = useState<{ id: RailId; el: HTMLElement } | null>(null);
  const rpView = useApp(s => s.rpView);
  const rightOpen = useApp(s => s.rightOpen);
  const leftOpen = useApp(s => s.leftOpen);
  const glassLevel = useApp(s => s.glassLevel);
  const landOn = useApp(s => s.landOn);
  const bottomH = useApp(s => s.bottomH);
  const ping = useRef<HTMLSpanElement>(null);
  const [ms, setMs] = useState<number | null>(null);
  const closePop = useCallback(() => setPop(null), []);

  useEffect(() => {
    const tick = () => { if (!document.hidden) setMs(16 + Math.floor(Math.random() * 52)); };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (!rightOpen) closePop(); }, [rightOpen, closePop]);

  const isOn = (id: RailId): boolean => {
    if (id === 'basemap' || id === 'pins') return pop?.id === id;
    if (id === 'overlay') return pop?.id === 'overlay' || (rightOpen && rpView === 'overlay');
    if (id === 'draw') return pop?.id === 'draw';
    return rightOpen && rpView === id;
  };

  const click = (id: RailId, el: HTMLElement) => {
    if (POPUP_IDS.includes(id)) { setPop(p => (p?.id === id ? null : { id, el })); return; }
    setPop(null);
    setRpView(id as RightView);
    setRight(true);
  };

  /* swipe the rail left to hide (touch layouts) */
  const swipe = useRef<{ x: number; y: number; done: boolean } | null>(null);

  return (
    <nav
      className={`fs-panel relative z-40 isolate overflow-hidden rounded-[12px] border transition-all duration-300 ease-panel ${
        glassLevel === 'none' ? 'bg-panel' : 'bg-[rgba(18,21,18,.62)] backdrop-blur-lg'} ${
        floating || small ? 'border-white/10 shadow-[0_14px_34px_rgba(0,0,0,.38)]' : 'border-transparent shadow-none'
      } ${leftOpen || small || floating ? 'border-opacity-100' : 'border-transparent shadow-none'} [grid-area:rail] ${
        floating && !small ? `z-40 w-[60px] transition-all duration-300 ${leftOpen ? 'translate-x-0 opacity-100' : '-translate-x-[120%] opacity-0 pointer-events-none'}` : ''
      } ${
        small ? '' : floating ? '' : leftOpen ? 'm-2' : 'm-0'
      } ${
        small ? `fixed bottom-2 left-2 top-[calc(var(--header-h)+8px)] z-[46] w-[60px] border-white/10 shadow-[0_14px_34px_rgba(0,0,0,.38)] transition-transform ${leftOpen ? 'translate-x-0' : '-translate-x-[110%]'}` : ''
      }`}
      style={floating && !small ? { position: 'absolute', left: 8, top: HEADER_H + 8, bottom: (landOn ? bottomH : 0) + 8, width: 60, height: 'auto' } : undefined}
      onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, done: false }; }}
      onTouchMove={e => {
        const s = swipe.current; if (!s || s.done) return;
        const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
        if (Math.abs(dx) > Math.abs(dy) && dx < -48) { s.done = true; closePop(); setLeft(false); }
      }}
      onTouchEnd={() => { swipe.current = null; }}
    >
      <div className="relative z-10 flex h-full w-[60px] flex-col gap-1 py-2.5">
        {BUTTONS.map(({ id, title, Icon }) => (
          <button
            key={id}
            {...useTipProps(title)}
            onClick={e => click(id, e.currentTarget)}
            className={`mx-auto grid size-10 flex-none cursor-pointer place-items-center rounded-[10px] border transition ${
              isOn(id) ? 'border-[rgba(184,241,63,.28)] bg-accent-dim text-accent' : 'border-transparent text-dim hover:bg-panel2 hover:text-ink'}`}
          >
            <Icon size={19} />
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-[5px] pb-1.5" {...useTipProps('เซิร์ฟเวอร์: ปกติ')}>
          <span className="relative size-[7px] rounded-full bg-accent after:absolute after:-inset-1 after:animate-pulse2 after:rounded-full after:border after:border-accent after:content-['']" />
          <span ref={ping} className="font-display text-[9px] font-medium" style={{ color: ms != null && ms > 58 ? '#E5484D' : 'var(--dim2)' }}>{ms != null ? ms + 'ms' : '--'}</span>
        </div>
      </div>
      {pop && <RailPopup id={pop.id} anchor={pop.el} onClose={closePop} />}
    </nav>
  );
}
