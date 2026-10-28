import {
  ChevronDown,
  RotateCcw,
  ScanLine,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  POP_FIELDS,
  POP_KINDS,
  STATUS,
  STATUS_KEYS,
} from '../../../data/constants';
import { DETAIL_ROWS } from '../../../lib/detailRows';
import type { CondoUnitOrder } from '../../../lib/condoUnits';
import { showRight } from '../../../store/actions';
import {
  patchApp,
  toast,
  useApp,
} from '../../../store/useApp';
import { ColorButton } from '../../ui/ColorButton';
import { Seg } from '../../ui/Seg';
import { Select } from '../../ui/Select';
import {
  btn,
  fl,
  frow,
  pillCls,
  setSec,
  stDot,
} from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import { useTipProps } from '../../ui/Tip';
import { type ChartTick, type PopupMode } from '../../../types';
import { Hint } from './shared';

/* ที่ดิน - which fields the marker popup shows, and in what order. */
export function PopupPane({ onClose }: { onClose: () => void }) {
  const restrict = useApp(s => s.restrict);
  const override = useApp(s => s.override);
  const areas = useApp(s => s.areas);
  const setRestrict = (on: boolean) => {
    patchApp(on ? { restrict: true } : { restrict: false, override: false });
    if (on && !areas.length) toast('ยังไม่มีพื้นที่กรอง — กด "วาดพื้นที่กรอง" ในแผงพื้นที่กรองจุด', 'warn');
  };
  const popupMode = useApp(s => s.popupMode);
  const allPops = popupMode === 'all';
  const labelOverlap = useApp(s => s.labelOverlap);
  const popColors = useApp(s => s.popColors);
  const statusVisible = useApp(s => s.statusVisible);
  const popupCfg = useApp(s => s.popupCfg);
  const reColor = useApp(s => s.reColor);
  const chartTick = useApp(s => s.chartTick);
  const showLandKindIcon = useApp(s => s.showLandKindIcon);
  const chartTodayLine = useApp(s => s.chartTodayLine);
  const chartForecast = useApp(s => s.chartForecast);
  const chartForecastSolid = useApp(s => s.chartForecastSolid);
  const labelNextDate = useApp(s => s.labelNextDate);
  const hlSold = useApp(s => s.highlightSoldRounds);
  const condoUnitOrder = useApp(s => s.condoUnitOrder);
  const soldPriceHeadline = useApp(s => s.soldPriceHeadline);
  
  const sectionsCollapsed = useApp(s => s.sectionsCollapsed);
  const detailRowHidden = useApp(s => s.detailRowHidden);
  const detailRowOrder = useApp(s => s.detailRowOrder);

  /* Shown order = the saved order for rows it names, then anything it does not
     mention in built-in order. Appending the leftovers rather than sorting the
     whole set keeps a partial saved order from scattering rows it never
     mentioned, and guarantees every row has a control — a row absent from both
     lists would render in the panel with no way to hide or move it. */
  const detailRowList: string[] = [];
  for (const k of detailRowOrder) if (DETAIL_ROWS.includes(k as never) && !detailRowList.includes(k)) detailRowList.push(k);
  for (const k of DETAIL_ROWS) if (!detailRowList.includes(k)) detailRowList.push(k);

  /* Drag to reorder, by pointer so one implementation covers mouse and touch.
     The list is not mutated while dragging: `overIdx` only previews, and the
     stored order is written once on release. Reordering on every pointermove
     would fight the drag — the row under the cursor would move out from under
     it, and the list would shuffle instead of following the pointer.
     Row heights are measured at drag start because they are uniform, so one
     midpoint test decides which slot the pointer has entered. */
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const dragStart = (e: React.PointerEvent, i: number) => {
    /* Only the grip starts a drag, so the switches and labels stay clickable. */
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    rowEls.current = rowEls.current.slice(0, detailRowList.length);
    setDragIdx(i);
    setOverIdx(i);
  };
  const dragMove = (e: React.PointerEvent, i: number) => {
    if (dragIdx == null) return;
    let target = i;
    for (let k = 0; k < detailRowList.length; k++) {
      const el = rowEls.current[k];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = k; break; }
      target = k;
    }
    setOverIdx(target);
  };
  const dragEnd = () => {
    if (dragIdx != null && overIdx != null && dragIdx !== overIdx) {
      const next = [...detailRowList];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      patchApp({ detailRowOrder: next });
    }
    setDragIdx(null);
    setOverIdx(null);
  };
  const toggleRow = (k: string, on: boolean) => patchApp({
    detailRowHidden: on ? detailRowHidden.filter(x => x !== k) : [...detailRowHidden, k],
  });

  return (
    <>
      <div className={`${setSec} !mt-0.5`}>หมุดบนแผนที่</div>
      <div className={frow}><span className={fl}>แสดงหมุดเฉพาะจุดในพื้นที่</span><button className={btn} {...useTipProps('เปิดแผงพื้นที่กรองจุด')} onClick={() => { onClose(); showRight('area'); }}><ScanLine size={14} />ตั้งค่าพื้นที่</button><Switch checked={restrict} onChange={setRestrict} /></div>
      <div className={frow}><span className={fl}>แสดงหมุดแม้อยู่นอกจอ</span><Switch checked={override} disabled={!restrict} onChange={v => patchApp({ override: v })} /></div>

      <div className={setSec}>ป็อปอัพ</div>
      <div className={frow}><span className={fl}>ป็อปอัพหมุดที่ดิน</span><Seg<PopupMode> items={[['active', 'แสดงเมื่อเลือก'], ['all', 'แสดงทุกจุด']]} value={popupMode} onChange={v => patchApp({ popupMode: v })} /></div>
      <div className={`${frow} ${allPops ? '' : 'pointer-events-none opacity-40'}`}><span className={fl}>ซ้อนกันได้</span><Switch checked={labelOverlap} onChange={v => patchApp({ labelOverlap: v })} /></div>
      <div className={`${frow} ${allPops ? '' : 'pointer-events-none opacity-40'}`}><span className={fl}>วันที่นัดถัดไป</span><Switch checked={labelNextDate} onChange={v => patchApp({ labelNextDate: v })} /></div>
      <div className={frow}><span className={fl}>ไอคอนประเภท</span><Switch checked={showLandKindIcon} onChange={v => patchApp({ showLandKindIcon: v })} /></div>
      
      <div className="flex mt-6">
        <div className={`${setSec} !mb-0`}>แผงรายละเอียด</div>
        <button
          type="button"
          {...useTipProps('แสดง/ซ่อนแผงรายละเอียด')}
          onClick={() => patchApp({ sectionsCollapsed: !sectionsCollapsed })}
          className="mb-1.5 ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-line2 px-2.5 text-[11px] text-dim hover:border-line3 hover:text-ink"
        >
          <ChevronDown size={13} className={`flex-none transition-transform ${sectionsCollapsed ? '' : 'rotate-180'}`} />
          <span>{sectionsCollapsed ? 'แสดง' : 'ซ่อน'}</span>
        </button>
      </div>
      {!sectionsCollapsed && (
      <>
        <div className="py-1 px-2 rounded-lg border border-line2">
          {detailRowList.map((k, i) => {
            const on = !detailRowHidden.includes(k);
            const dragging = dragIdx === i;
            const dropping = overIdx === i && dragIdx != null && dragIdx !== i;
            return (
              <div
                key={k}
                ref={el => { rowEls.current[i] = el; }}
                className={`flex items-center gap-1.5 rounded py-[3px] text-[11.5px] ${on ? '' : 'opacity-55'} ${dragging ? 'opacity-35' : ''} ${dropping ? 'bg-accent/15 ring-1 ring-accent/40' : ''}`}
              >
                <button
                  type="button"
                  aria-label={`ลากเพื่อจัดลำดับ ${k}`}
                  {...useTipProps(`ลากเพื่อจัดลำดับ ${k}`)}
                  onPointerDown={e => dragStart(e, i)}
                  onPointerMove={e => dragMove(e, i)}
                  onPointerUp={dragEnd}
                  onPointerCancel={dragEnd}
                  className="size-[20px] flex-none cursor-grab touch-none rounded text-[11px] leading-none text-dim2 hover:bg-panel2 hover:text-ink active:cursor-grabbing"
                >⠿</button>
                <span className={`min-w-0 flex-1 truncate ${on ? 'text-ink' : 'text-dim2 line-through'}`}>{k}</span>
                <Switch checked={on} onChange={v => toggleRow(k, v)} />
              </div>
            );
          })}
        </div>
        <div className="flex mt-1.5">
          <Hint>ลากที่ ⠿ เพื่อจัดลำดับ</Hint>
          {(detailRowOrder.length > 0 || detailRowHidden.length > 0) && (
            <button
            type="button"
            className="mb-2 ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-line2 px-2.5 text-[11px] text-dim hover:border-line3 hover:text-ink"
            onClick={() => patchApp({ detailRowOrder: [], detailRowHidden: [] })}
            >
              <RotateCcw size={11} /> รีเซ็ต
            </button>
          )}
        </div>
      </>
      )}
      {sectionsCollapsed && (<div className='text-[10.5px] leading-[1.6] text-dim2'>แผงรายละเอียดซ่อนอยู่ - เลือกแสดงแผงรายละเอียด</div>)}

      {/* Sold lands arrange headline prices per user's preference: big winning bid
          (what the report sheet says was paid) or big open price (the announce
          anchor — committee figure when LED has one) with the bid demoted.
          Outside the collapse block above so the control is reachable even when
          the row list is folded away. */}
      <div className={setSec}>ราคาแปลงที่ขายแล้ว</div>
      <div className={frow}>
        <span className={fl}>ตัวเลขเด่น</span>
        <Select
          value={soldPriceHeadline}
          items={[
            { v: 'sold', l: 'ราคาขายได้เป็นตัวใหญ่' },
            { v: 'open', l: 'ราคาเปิดเป็นตัวใหญ่' },
          ]}
          onChange={v => patchApp({ soldPriceHeadline: v as 'sold' | 'open' })}
        />
      </div>
      <Hint>มีผลเฉพาะแปลงที่ขายได้ราคาแล้ว — ปกติตัวเลขใหญ่คือราคาที่ขายได้ (ราคาเปิด = ราคาที่กำหนดโดยคณะกรรมการ หรือราคาประกาศเริ่ม)</Hint>

      <div className={setSec}>ตารางรอบขาย</div>
      <div className={frow}>
        <span className={fl}>สีรอบถัดไปอ่อนลง</span>
        <Switch checked={hlSold} onChange={v => patchApp({ highlightSoldRounds: v })} />
      </div>

      <div className={setSec}>กราฟราคา</div>
      <div className={frow}>
        <span className={fl}>เส้นเวลา</span>
        <Seg<ChartTick>
          items={[['none', 'ไม่แสดง'], ['year', 'ทุกปี'], ['m6', '6 เดือน'], ['m4', '4 เดือน'], ['m3', '3 เดือน']]}
          value={chartTick}
          onChange={v => patchApp({ chartTick: v })}
        />
      </div>
      <div className={frow}><span className={fl}>เส้นวันนี้</span><Switch checked={chartTodayLine} onChange={v => patchApp({ chartTodayLine: v })} /></div>
      <div className={frow}><span className={fl}>ราคารอบถัดไป</span><Switch checked={chartForecast} onChange={v => patchApp({ chartForecast: v })} /></div>
      {/* เส้นรอบถัดไปสีทึบเหมือนรอบที่ผ่านแล้ว — ปกติวาดจาง+เส้นประ เพื่อแยก "ผ่านแล้ว/ยังไม่ถึง" */}
      <div className={frow}><span className={fl}>รอบถัดไปแบบทึบ</span><Switch checked={chartForecastSolid} onChange={v => patchApp({ chartForecastSolid: v })} /></div>

      <div className={setSec}>ห้องชุด</div>
      <div className={frow}>
        <span className={fl}>จุดในแผนที่</span>
        {/* Six labels, each long enough to wrap in a segmented control inside this
            narrow panel. Select is the one already used for the unit cycler and
            the pin forms, so the trigger stays readable and the list drops down. */}
        <Select
          value={condoUnitOrder}
          items={[
            { v: 'statusFirst', l: 'กำลังขาย' },
            { v: 'sizeDesc', l: 'ใหญ่สุด' },
            { v: 'sizeAsc', l: 'เล็กสุด' },
            { v: 'priceAsc', l: 'ราคาต่ำสุด' },
            { v: 'priceDesc', l: 'ราคาสูงสุด' },
            { v: 'orderLabel', l: 'ลำดับแรก' },
          ]}
          onChange={v => patchApp({ condoUnitOrder: v as CondoUnitOrder })}
        />
      </div>
      <Hint>อาคารห้องชุดหนึ่งหลังคือที่ดินหนึ่งแปลง แต่ขายแยกเป็นหน่วยยอด จุดบนแผนที่จึงแสดงเพียงหน่วยเดียวแทนทั้งอาคาร และแผงรายละเอียดมีตัวเลือกสลับหน่วยยอด</Hint>

      <div className={setSec}>สถานะและสี</div>
      {STATUS_KEYS.map(k => (
        <div key={k} className={frow}>
          <ColorButton
            {...useTipProps('เลือกสี')}
            value={popColors[k]}
            onChange={hex => patchApp({ popColors: { ...useApp.getState().popColors, [k]: hex } })}
            className="h-[22px] w-[30px] shrink-0 cursor-pointer rounded-md border border-line2 p-0 hover:border-accent"
            style={{ background: popColors[k] }}
          />
          <span className={fl}>{STATUS[k].th}</span>
          <Switch checked={statusVisible[k]} onChange={v => patchApp({ statusVisible: { ...useApp.getState().statusVisible, [k]: v } })} />
        </div>
      ))}
      <div className={frow}>
        <ColorButton
          {...useTipProps('เลือกสี')}
          value={popColors.re}
          onChange={hex => patchApp({ popColors: { ...useApp.getState().popColors, re: hex }, reColor: hex })}
          className="h-[22px] w-[30px] shrink-0 cursor-pointer rounded-md border border-line2 p-0 hover:border-accent"
          style={{ background: popColors.re }}
        />
        <span className={fl}>นำกลับมาขายใหม่</span>
        <Switch
          checked={popupCfg.re.resale}
          onChange={v => {
            const cur = useApp.getState().popupCfg;
            patchApp({ popupCfg: { ...cur, re: { ...cur.re, resale: v } } });
          }}
        />
      </div>

      <div className={setSec}>เนื้อหาป๊อป — แยกตามชนิดหมุด</div>
      {POP_KINDS.map(([k, lab, ck]) => (
        <div key={k} className="border-b border-line py-[9px]">
          <div className="flex items-center gap-2 text-xs font-medium"><span className={stDot} style={{ background: k === 're' ? reColor : popColors[ck] }} />{lab}</div>
          <div className="flex flex-wrap gap-1.5 pb-0.5 pt-2">
            {POP_FIELDS.map(([f, fl2]) => (
              <button
                key={f}
                type="button"
                className={pillCls(popupCfg[k][f])}
                onClick={() => {
                  const cur = useApp.getState().popupCfg;
                  patchApp({ popupCfg: { ...cur, [k]: { ...cur[k], [f]: !cur[k][f] } } });
                }}
              >{fl2}</button>
            ))}
          </div>
        </div>
      ))}
      
    </>
  );
}
