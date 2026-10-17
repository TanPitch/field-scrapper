import { ChevronDown, Eye, EyeOff, RotateCcw, ScanLine } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import RELEASE_NOTES from '../../../../RELEASE_NOTES.md?raw';
import {
  LB_FIELDS, POP_FIELDS, POP_KINDS, SETTINGS_SECRET, STATUS, STATUS_KEYS,
} from '../../../data/constants';
import { resetAll } from '../../../store/actions';
import { DETAIL_ROWS } from '../../../lib/detailRows';
import type { CondoUnitOrder } from '../../../lib/condoUnits';
import { showRight } from '../../../store/actions';
import { patchApp, toast, useApp } from '../../../store/useApp';
import { changelogVersion, parseChangelog, parseInline } from '../../../lib/changelog';
import { formatMoney } from '../../../lib/format';
import { nominatimTest, tileTest, wmsTileUrl } from '../../../map/protocols';
import { ColorButton } from '../../ui/ColorButton';
import { Seg } from '../../ui/Seg';
import {
  btn, fl, frow, hint, inp, pillCls, setSec, stDot,
} from '../../ui/styles';
import { Stepper } from '../../ui/Stepper';
import { Switch } from '../../ui/Switch';
import { useTipProps } from '../../ui/Tip';
import { THEMES, type Cascade, type ChartTick, type DrawDistMode, type GlassLevel, type LayoutMode, type MarkerSize, type PopupMode, type Theme } from '../../../types';

const Hint = ({ children }: { children: React.ReactNode }) => <div className={hint}>{children}</div>;
// const B = ({ children }: { children: React.ReactNode }) => <b className="text-ink">{children}</b>;

/* ======================= แผนที่ ======================= */
export function MapPane() {
  const markerSize = useApp(s => s.markerSize);
  const searchLimit = useApp(s => s.searchLimit);
  const showApiSettings = useApp(s => s.showApiSettings);
  const persistMapView = useApp(s => s.persistMapView);
  const [secret, setSecret] = useState('');

  const submitSecret = () => {
    if (secret.trim().toLowerCase() === SETTINGS_SECRET) {
      patchApp({ showApiSettings: true });
      setSecret('');
      toast('ปลดล็อกเมนู ค้นหา & API แล้ว');
    } else {
      toast('รหัสไม่ถูกต้อง');
      setSecret('');
    }
  };

  return (
    <>
    
      <div className={`${setSec} !mt-0.5`}>แผนที่</div>
      <div className={frow}>
        <span className={fl}>จำตำแหน่งแผนที่ล่าสุด</span>
        <Switch checked={persistMapView} onChange={v => patchApp({ persistMapView: v, lastView: v ? useApp.getState().lastView : null })}/>
      </div>

      <div className={setSec}>หมุดบนแผนที่</div>
      <div className={frow}>
        <span className={fl}>ขนาดหมุด</span>
        <Seg<MarkerSize> items={[['small', 'เล็ก'], ['normal', 'ปกติ'], ['large', 'ใหญ่']]} value={markerSize} onChange={v => patchApp({ markerSize: v })} />
      </div>

      <div className={setSec}>การค้นหา</div>
      <div className={frow}>
        <span className={fl}>จำนวนผลลัพธ์</span>
        <Stepper compact value={searchLimit} step={1} onChange={(v: number | null) => patchApp({ searchLimit: Math.max(1, Math.min(50, v ?? 1)) })} />
      </div>

      {/* the API tab stays hidden until the local unlock code is entered */}
      <div className={setSec}>ปลดล็อกเมนูขั้นสูง</div>
      <div className={frow}>
        <span className={fl}>รหัสปลดล็อก</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            className={`${inp} flex-1`}
            type="password"
            placeholder="กรอกรหัสปลดล็อก"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitSecret(); }}
          />
          <button className={`${btn} flex-none`} onClick={submitSecret}>ปลดล็อก</button>
        </div>
      </div>
      {showApiSettings && (
        <div className="flex items-center gap-2 text-[11.5px] text-dim pt-2">
          <b className="text-accent">ปลดล็อกแล้ว</b>
          <button className={`${btn} ml-auto`} onClick={() => patchApp({ showApiSettings: false })}>ซ่อน</button>
        </div>
      )}
    </>
  );
}

/* ======================= รูปลักษณ์ ======================= */
export function LookPane() {
  const theme = useApp(s => s.theme);
  const accentColor = useApp(s => s.accentColor);
  const bath = useApp(s => s.priceBath);
  const space = useApp(s => s.priceSpace);
  const reduce = useApp(s => s.reduceMotion);
  const glassLevel = useApp(s => s.glassLevel);
  const lbCfg = useApp(s => s.lbCfg);
  const layoutMode = useApp(s => s.layoutMode);

  return (
    <>
    <div className={`${setSec} !mt-0.5`}>รูปแบบหน้าจอ และธีมสี</div>
    <div className={frow}><span className={fl}>ธีมสี</span><Seg<Theme> items={THEMES} value={theme} onChange={v => patchApp({ theme: v })} /></div>
    <div className={frow}>
      <span className={fl}>สีหลัก (Primary)</span>
      <div className="flex items-center gap-2">
        <ColorButton
          title="เลือกสีหลัก"
          value={accentColor || getThemeAccent(theme)}
          onChange={hex => patchApp({ accentColor: hex })}
          className="h-[26px] w-[34px] flex-none cursor-pointer rounded-md border border-line2 p-0"
          style={{ background: accentColor || getThemeAccent(theme) }}
        />
        {accentColor && (
          <button type="button" className={`${btn} flex-none`} onClick={() => patchApp({ accentColor: '' })}>รีเซ็ต</button>
        )}
      </div>
    </div>
    <div className={frow}><span className={fl}>เมนูด้านซ้ายมือ</span><Seg<LayoutMode> items={[['docked', 'ชิดขอบ'], ['floating', 'ลอย']]} value={layoutMode} onChange={v => patchApp({ layoutMode: v })} /></div>
    <div className={frow}><span className={fl}>พื้นหลังแบบทึบ/โปร่งใส</span><Seg<GlassLevel> items={[['none', 'ทึบ'], ['transparent', 'โปร่งใส']]} value={glassLevel} onChange={v => patchApp({ glassLevel: v })} /></div>
    <div className={setSec}>การแสดงราคา</div>
    <div className={frow}><span className={fl}>แสดง ฿ นำหน้าราคา</span><Switch checked={bath} onChange={v => patchApp({ priceBath: v })} /></div>
    <div className={frow}><span className={fl}>เว้นวรรคระหว่าง comma</span><Switch checked={space} onChange={v => patchApp({ priceSpace: v })} /></div>
    <Hint>ตัวอย่าง: <b className="text-xs font-semibold">{formatMoney(1234567, { bath, space })}</b></Hint>
    <div className={setSec}>การเคลื่อนไหว</div>
    <div className={frow}><span className={fl}>ลดการเคลื่อนไหว (Reduce Motion)</span><Switch checked={reduce} onChange={v => patchApp({ reduceMotion: v })} /></div>
    <div className={setSec}>Lightbox — ข้อมูลที่แสดงเหนือภาพขยาย</div>
    <div className="flex flex-wrap gap-1.5 pb-0.5 pt-2">
      {LB_FIELDS.map(([f, l]) => (
        <button key={f} type="button" className={pillCls(lbCfg[f])} onClick={() => { const cur = useApp.getState().lbCfg; patchApp({ lbCfg: { ...cur, [f]: !cur[f] } }); }}>{l}</button>
      ))}
    </div>
    <Hint>ปิดทั้งหมดเพื่อไม่แสดงข้อมูลใดใน Lightbox</Hint>
    </>
  );
}

/* ======================= ที่ดิน ======================= */
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
  const labelNextDate = useApp(s => s.labelNextDate);
  const hlSold = useApp(s => s.highlightSoldRounds);
  const condoUnitOrder = useApp(s => s.condoUnitOrder);
  
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

      <div className={setSec}>ห้องชุด</div>
      <div className={frow}>
        <span className={fl}>หน่วยที่แสดงบนจุด</span>
        <Seg<CondoUnitOrder>
          items={[
            ['statusFirst', 'กำลังขายก่อน'],
            ['sizeDesc', 'ใหญ่สุด'],
            ['sizeAsc', 'เล็กสุด'],
            ['priceAsc', 'ราคาต่ำสุด'],
            ['priceDesc', 'ราคาสูงสุด'],
            ['orderLabel', 'ลำดับแรก'],
          ]}
          value={condoUnitOrder}
          onChange={v => patchApp({ condoUnitOrder: v })}
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

/* ======================= รูปวาด ======================= */
export function DrawSettingsPane() {
  const ddist = useApp(s => s.drawDistMode);
  const circleMeta = useApp(s => s.showCircleMeta);

  return (
    <>
      <div className={setSec}>เส้น และพื้นที่</div>
      <div className={frow}>
        <span className={fl}>ป้ายบอกระยะ</span>
        <Seg<DrawDistMode> items={[['both', 'ทั้งหมด'], ['seg', 'ช่วง'], ['round', 'ตัวเลขหลัก'], ['off', 'ซ่อน']]} value={ddist} onChange={v => patchApp({ drawDistMode: v })} />
      </div>
      <div className={setSec}>วงกลม</div>
      <div className={frow}>
        <span className={fl}>จุดศูนย์กลาง และป้ายรัศมี</span>
        <Switch checked={circleMeta} onChange={v => patchApp({ showCircleMeta: v })} />
      </div>
    </>
  );
}

/* ======================= ค้นหา & API ======================= */
type TestState = { status: 'idle' | 'busy' | 'ok' | 'fail'; msg: string };
/** The short result, rendered as thin opaque text inside the button. */
function testResult(t: TestState): string {
  if (t.status === 'ok') return t.msg ? `ผ่าน ${t.msg}` : 'ผ่าน';
  if (t.status === 'fail') return 'ไม่ผ่าน';
  return '';
}
/** The actionable half of the label: plain "ทดสอบ" until a result exists. */
function testAction(t: TestState): string {
  if (t.status === 'busy') return 'ทดสอบ…';
  if (t.status === 'idle') return 'ทดสอบ';
  return 'ทดสอบใหม่';
}
/* blue = not run yet, muted blue = running, green = pass, red = fail.
   All four carry their colour at rest — hover only deepens it. */
const TEST_CLS = {
  idle: 'border-[#3A6EA5] bg-[#3A6EA5]/15 text-[#7FB3F0] hover:border-[#4C82BC] hover:bg-[#3A6EA5]/25',
  busy: 'cursor-progress border-[#3A6EA5] bg-[#3A6EA5]/10 text-[#6C9FD8]',
  ok: 'border-[#2E7D32] bg-[#2E7D32]/20 text-[#6BD07C] hover:border-[#3E9143] hover:bg-[#2E7D32]/32',
  fail: 'border-[#E5484D] bg-[#E5484D]/20 text-[#FF8B7D] hover:border-[#FF7A6B] hover:bg-[#E5484D]/32',
} as const;

function ApiTestRow({ label, run }: { label: string; run: () => Promise<string> }) {
  const [t, setT] = useState<TestState>({ status: 'idle', msg: '' });
  const go = () => {
    setT({ status: 'busy', msg: '' });
    const t0 = performance.now();
    run()
      .then(() => setT({ status: 'ok', msg: `${Math.round(performance.now() - t0)}ms` }))
      .catch(() => setT({ status: 'fail', msg: '' }));
  };
  const res = testResult(t);
  return (
    <div className="flex items-center gap-2 border-b border-line py-[9px]">
      <span className={fl}>{label}</span>
      <button
        className={`${btn} ml-auto gap-1.5 whitespace-nowrap ${TEST_CLS[t.status]}`}
        onClick={go}
        disabled={t.status === 'busy'}
      >
        {res && <span className="font-display text-[10px] font-light leading-none opacity-70">{res}</span>}
        {testAction(t)}
      </button>
    </div>
  );
}
/** Default accent per theme, used when the user has not picked a primary colour. */
const THEME_ACCENT: Record<Theme, string> = {
  graphite: '#B8F13F', oled: '#B8F13F', slate: '#58A6FF',
  sand: '#FFB454', forest: '#3DDC97', rose: '#FF7AA2', mono: '#FFFFFF',
};
const getThemeAccent = (t: Theme): string => THEME_ACCENT[t] ?? '#B8F13F';

/** Masks an API key for display: keeps the head and the last few characters. */
function maskKey(k: string): string {
  if (k.length <= 10) return k ? '•'.repeat(Math.max(k.length, 4)) : '';
  return `${k.slice(0, 5)}•••${k.slice(-4)}`;
}

export function SearchApiPane() {
  const cascade = useApp(s => s.cascade);
  const gkey = useApp(s => s.gkey);
  const [showKey, setShowKey] = useState(false);
  const [keyTest, setKeyTest] = useState<TestState>({ status: 'idle', msg: '' });
  const testKey = () => {
    setKeyTest({ status: 'busy', msg: '' });
    const t0 = performance.now();
    (gkey ? new Promise<string>(res => setTimeout(() => res('200 OK (จำลอง)'), 650)) : Promise.reject(new Error('ไม่พบ API Key — ใส่คีย์ก่อน')))
      .then(() => setKeyTest({ status: 'ok', msg: `${Math.round(performance.now() - t0)}ms` }))
      .catch(() => setKeyTest({ status: 'fail', msg: '' }));
  };
  const keyRes = testResult(keyTest);
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>การค้นหา</div>
      <div className={frow}>
        <span className={fl}>ลำดับการค้นหา</span>
        <Seg<Cascade> items={[['google', 'Google → Nominatim'], ['nominatim', 'Nominatim เท่านั้น']]} value={cascade} onChange={v => { patchApp({ cascade: v }); toast('ลำดับการค้นหา: ' + (v === 'google' ? 'Google → Nominatim' : 'Nominatim เท่านั้น')); }} />
      </div>
      {/* single line: label · input (+ eye) · test button */}
      <div className="flex items-center gap-2 border-b border-line py-[9px]">
        <span className={`${fl} flex-none`}>API คีย์</span>
        <div className="relative min-w-0 flex-1">
          <input
            className={`${inp} pr-7 font-display`}
            placeholder="Google Search API Key"
            value={showKey ? gkey : maskKey(gkey)}
            onChange={e => patchApp({ gkey: e.target.value.trim() })}
            onFocus={() => { if (!showKey) setShowKey(true); }}
            spellCheck={false}
          />
          <button
            type="button"
            title={showKey ? 'ซ่อนคีย์' : 'แสดงคีย์เต็ม'}
            onClick={() => setShowKey(v => !v)}
            className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded text-dim2 hover:bg-panel2 hover:text-ink"
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button
          className={`${btn} ml-auto flex-none gap-1.5 whitespace-nowrap ${TEST_CLS[keyTest.status]}`}
          onClick={testKey}
          disabled={keyTest.status === 'busy'}
        >
          {keyRes && <span className="font-display text-[10px] font-light leading-none opacity-70">{keyRes}</span>}
          {testAction(keyTest)}
        </button>
      </div>
      <div className={`${setSec}`}>API อื่นๆ</div>
      <ApiTestRow label="Nominatim (OSM)" run={nominatimTest} />
      <ApiTestRow
        label="แผนที่ฐาน (Map Tiles)"
        run={async () => {
          const one = (u: string) => tileTest(u).then(() => undefined);
          await one('https://mt0.google.com/vt/lyrs=m&x=6&y=3&z=3');
          await one('https://mt0.google.com/vt/lyrs=y&x=6&y=3&z=3');
          return 'ผ่าน';
        }}
      />
      <ApiTestRow label="ขอบเขตที่ดิน กรมที่ดิน" run={() => tileTest(wmsTileUrl(6, 49, 29))} />
      <ApiTestRow label="ความสูง แผนที่น้ำท่วม" run={() => tileTest('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/64/33.png')} />
    </>
  );
}

/* ======================= เกี่ยวกับ ======================= */
/** RELEASE_NOTES.md inline markup: **bold** and `code`. */
function Md({ text }: { text: string }): React.ReactNode {
  return <>{parseInline(text).map((c, i) =>
    c.t === 'b' ? <b key={i} className="font-semibold text-ink">{c.v}</b>
      : c.t === 'c' ? <code key={i} className="rounded bg-panel2 px-[3px] py-px font-display text-[10.5px] text-accent">{c.v}</code>
        : <span key={i}>{c.v}</span>,
  )}</>;
}

/** RELEASE_NOTES.md, inlined at build time and rendered as a scrollable list. */
function Changelog() {
  const groups = useMemo(() => parseChangelog(RELEASE_NOTES), []);
  return (
    <div className="my-2 max-h-[260px] overflow-y-auto overscroll-contain rounded-[10px] border border-line px-3 pb-2 text-[11.5px] leading-[1.65] text-dim">
      {groups.map(g => (
        <div key={g.version} className="mb-2.5 last:mb-0">
          <div className="sticky top-0 z-[1] mb-1.5 bg-panel px-3 pt-4 pb-2 font-display text-[11px] font-semibold text-ink">
            {changelogVersion(g.version) === g.version ? g.version : `${changelogVersion(g.version)} — ${g.version.slice(changelogVersion(g.version).length + 2).trim()}`}
          </div>
          {g.sections.map((s, i) => (
            <div key={i} className="mb-1.5 last:mb-0">
              {s.heading && <div className="mb-0.5 pl-1 text-[10.5px] font-semibold text-dim2">{s.heading}</div>}
              <ul className="m-0 list-none space-y-[3px] pl-3.5">
                {s.items.map((it, j) => (
                  <li key={j} className="relative before:absolute before:-left-2.5 before:top-[.55em] before:size-[3px] before:rounded-full before:bg-dim2 before:content-['']">
                    <Md text={it} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AboutPane() {
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>บันทึกการเปลี่ยนแปลง</div>
      <Changelog />
      {/* <div className={setSec}>ข้อมูลจำลอง</div>
      <div className={frow}><span className={fl}>แปลงที่ดินทั้งหมด</span><b className="text-xs font-semibold">{ALL_PARCELS.length.toLocaleString('th-TH')} แปลง</b></div>
      <div className={frow}><span className={fl}>จังหวัด</span><b className="text-xs font-semibold">{PROVINCES.length} จังหวัด</b></div> */}
      <button className={`${btn} mt-3`} onClick={resetAll}><RotateCcw size={14} />รีเซ็ตตัวกรอง คอลัมน์ และการปักหมุด</button>
    </>
  );
}
