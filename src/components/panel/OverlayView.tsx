import { useEffect, useState } from 'react';
import { useTipProps } from '../ui/Tip';
import { rgbaStr } from '../../lib/color';
import { toast, patchApp, useApp } from '../../store/useApp';
import { updateOverlay } from '../../store/actions';
import type { FloodColorKey, FloodConfig, RGBA } from '../../types';
import { ColorButton } from '../ui/ColorButton';
import { fl, frow } from '../ui/styles';
import { Switch } from '../ui/Switch';
import { VPad } from './shared';

/** Two clickable halves over a gradient: low colour | high colour. */
function GradientBar({ lo, hi, loKey, hiKey, loTitle, hiTitle, onSet }: {
  lo: RGBA; hi: RGBA; loKey: FloodColorKey; hiKey: FloodColorKey; loTitle: string; hiTitle: string;
  onSet: (k: FloodColorKey, v: RGBA) => void;
}) {
  const half = 'absolute top-0 h-full cursor-pointer p-0 hover:shadow-[inset_0_0_0_2px_rgba(255,255,255,.55)]';
  return (
    <div
      className="relative mt-1.5 h-[22px] basis-full overflow-hidden rounded-[7px] border border-line2"
      style={{ backgroundImage: `linear-gradient(90deg, ${rgbaStr(lo)}, ${rgbaStr(hi)})` }}
    >
      <ColorButton alpha value={lo.c} alphaValue={lo.a} title={loTitle} className={`${half} left-0 w-1/2`} onChange={(c, a) => onSet(loKey, { c, a })} />
      <ColorButton alpha value={hi.c} alphaValue={hi.a} title={hiTitle} className={`${half} left-1/2 w-1/2`} onChange={(c, a) => onSet(hiKey, { c, a })} />
    </div>
  );
}
const Ends = ({ a, b }: { a: string; b: string }) => (
  <div className="mt-[3px] flex basis-full justify-between text-[9.5px] text-dim2"><span>{a}</span><span>{b}</span></div>
);

function FloodSettings() {
  const flood = useApp(s => s.flood);
  const probe = useApp(s => s.floodProbe);
  const set = (p: Partial<FloodConfig>) => patchApp({ flood: { ...useApp.getState().flood, ...p } });
  const setColor = (k: FloodColorKey, v: RGBA) => set({ [k]: v } as Partial<FloodConfig>);

  /* slider range follows the value so very high/low sea levels stay reachable */
  const spanFor = (v: number) => Math.max(10, Math.abs(v) * 0.1);
  const [range, setRange] = useState(() => ({ min: flood.sea - spanFor(flood.sea), max: flood.sea + spanFor(flood.sea) }));
  const [text, setText] = useState(String(flood.sea));
  useEffect(() => setText(String(flood.sea)), [flood.sea]);
  const syncRange = (v: number) => setRange({ min: +(v - spanFor(v)).toFixed(1), max: +(v + spanFor(v)).toFixed(1) });
  const applySea = (v: number) => set({ sea: Math.round(v * 2) / 2 });
  const commitText = () => {
    const v = parseFloat(text.replace(/[^\d.-]/g, ''));
    if (isNaN(v)) { setText(String(flood.sea)); return; }
    syncRange(v); applySea(v);
  };

  return (
    <div className="my-2.5 rounded-[10px] border border-line px-3 pb-2 pt-1">
      <div className={frow}>
        <span className={fl}>ระดับน้ำทะเล (ม.)</span>
        <div className="mt-1.5 flex basis-full items-center gap-2">
          <input
            type="range" className="flex-1" min={range.min} max={range.max} step={0.5} value={flood.sea}
            onChange={e => applySea(+e.target.value)}
            onPointerUp={() => syncRange(flood.sea)}
            onDoubleClick={() => { applySea(2); syncRange(2); }}
          />
          <div className="flex h-7 flex-[0_0_104px] items-stretch overflow-hidden rounded-lg border border-line2 bg-bg">
            <input
              inputMode="decimal" {...useTipProps('ระดับน้ำทะเล (ม.)')} value={text}
              onChange={e => setText(e.target.value)} onBlur={commitText}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="min-w-0 flex-1 border-none bg-transparent px-1 text-center font-display text-[11.5px] font-medium text-ink outline-none"
            />
          </div>
        </div>
      </div>
      <div className={frow}>
        <span className={fl}>บริเวณน้ำท่วม — ตื้นไปลึก</span>
        <GradientBar lo={flood.floodLo} hi={flood.floodHi} loKey="floodLo" hiKey="floodHi" loTitle="สีน้ำตื้น" hiTitle="สีน้ำลึก" onSet={setColor} />
        <Ends a="ตื้น" b="ลึก" />
      </div>
      <div className={frow}><span className={fl}>แสดงสีบนพื้นแห้งตามความสูง</span><Switch checked={flood.dry} onChange={v => set({ dry: v })} /></div>
      <div className={frow}>
        <span className={fl}>บริเวณพื้นแห้ง — ต่ำไปสูง</span>
        <GradientBar lo={flood.dryLo} hi={flood.dryHi} loKey="dryLo" hiKey="dryHi" loTitle="พื้นต่ำ" hiTitle="พื้นสูง" onSet={setColor} />
        <Ends a="ต่ำ" b="สูง" />
      </div>
      <div className={`${frow} !border-b-0`}>
        <span className={fl}>เครื่องวัดความสูง/ความลึก (Probe)</span>
        <Switch
          checked={probe}
          onChange={v => {
            patchApp({ floodProbe: v });
            toast(v ? 'เปิด Probe — เลื่อนเมาส์/แตะบนแผนที่เพื่อดูความลึก/ความสูง' : 'ปิด Probe แล้ว');
          }}
        />
      </div>
    </div>
  );
}

export function OverlayView() {
  const overlays = useApp(s => s.overlays);
  const sel = useApp(s => s.overlaySel);
  const ov = overlays.find(o => o.id === sel) ?? overlays[0];

  return (
    <VPad>
      <div className={`${frow} !border-none !pt-0`}>
        <span className="size-3 shrink-0 rounded" style={{ background: ov.color }} />
        <span className={`${fl} font-semibold`}>{ov.name} <span className="font-display text-[10.5px] font-normal text-dim2">{ov.en}</span></span>
        <Switch checked={ov.visible} onChange={v => updateOverlay(ov.id, { visible: v }, true)} />
      </div>
      <div className={frow}>
        <span className={fl}>ความทึบแสง</span>
        <input
          type="range" className="w-[140px]" min={0.02} max={1} step={0.02} value={ov.opacity}
          onChange={e => updateOverlay(ov.id, { opacity: +e.target.value })}
          onDoubleClick={() => updateOverlay(ov.id, { opacity: ov.id === 'flood' ? 0.75 : ov.id === 'cadastre' ? 0.7 : 0.22 })}
        />
        <span className="w-9 text-right font-display text-[11px] font-medium">{Math.round(ov.opacity * 100)}%</span>
      </div>
      {ov.type === 'flood' && <FloodSettings />}
    </VPad>
  );
}
