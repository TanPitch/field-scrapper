import { RotateCcw, ScanLine } from 'lucide-react';
import { useState } from 'react';
import {
  LB_FIELDS, POP_FIELDS, POP_KINDS, STATUS, STATUS_KEYS,
} from '../../../data/constants';
import { ALL_PARCELS, PROVINCES } from '../../../data/mockData';
import { resetAll } from '../../../store/actions';
import { showRight } from '../../../store/actions';
import { patchApp, toast, useApp } from '../../../store/useApp';
import { formatMoney } from '../../../lib/format';
import { nominatimTest, tileTest, wmsTileUrl } from '../../../map/protocols';
import { ColorButton } from '../../ui/ColorButton';
import { Seg } from '../../ui/Seg';
import {
  btn, fl, frow, hint, inp, pillCls, setSec, stDot,
} from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import { useTipProps } from '../../ui/Tip';
import type { Cascade, ChartTick, DrawDistMode, GlassLevel, LayoutMode, MarkerSize, PopupMode, Theme } from '../../../types';

const Hint = ({ children }: { children: React.ReactNode }) => <div className={hint}>{children}</div>;
// const B = ({ children }: { children: React.ReactNode }) => <b className="text-ink">{children}</b>;

/* ======================= แผนที่ ======================= */
export function MapPane() {
  const markerSize = useApp(s => s.markerSize);

  return (
    <>
      <div className={`${setSec} !mt-0.5`}>หมุดบนแผนที่</div>
      <div className={frow}>
        <span className={fl}>ขนาดหมุด</span>
        <Seg<MarkerSize> items={[['normal', 'ปกติ'], ['large', 'ใหญ่']]} value={markerSize} onChange={v => patchApp({ markerSize: v })} />
      </div>
    </>
  );
}

/* ======================= ป๊อปอัพ ======================= */
export function PopupPane({ onClose }: { onClose: () => void }) {
  const restrict = useApp(s => s.restrict);
  const override = useApp(s => s.override);
  const areas = useApp(s => s.areas);
  const setRestrict = (on: boolean) => {
    patchApp(on ? { restrict: true } : { restrict: false, override: false });
    if (on && !areas.length) toast('ยังไม่มีพื้นที่กรอง — กด "วาดพื้นที่กรอง" ในแผงพื้นที่กรองจุด', 'warn');
  };
  const popupMode = useApp(s => s.popupMode);
  const labelOverlap = useApp(s => s.labelOverlap);
  const labelSold = useApp(s => s.labelSold);
  const popColors = useApp(s => s.popColors);
  const statusVisible = useApp(s => s.statusVisible);
  const popupCfg = useApp(s => s.popupCfg);
  const reColor = useApp(s => s.reColor);
  const chartTick = useApp(s => s.chartTick);

  return (
    <>
      <div className={`${setSec} !mt-0.5`}>หมุดบนแผนที่</div>
      <div className={frow}>
        <span className={fl}>แสดงหมุดเฉพาะจุดในพื้นที่</span>
        <button className={btn} {...useTipProps('เปิดแผงพื้นที่กรองจุด')} onClick={() => { onClose(); showRight('area'); }}><ScanLine size={14} />ตั้งค่าพื้นที่</button>
        <Switch checked={restrict} onChange={setRestrict} />
      </div>
      <div className={frow}>
        <span className={fl}>แสดงหมุดแม้อยู่นอกจอ</span>
        <Switch checked={override} disabled={!restrict} onChange={v => patchApp({ override: v })} />
      </div>

      <div className={setSec}>ป็อปอัพ</div>
      <div className={frow}>
        <span className={fl}>ป็อปอัพหมุดที่ดิน</span>
        <Seg<PopupMode> items={[['active', 'แสดงเมื่อเลือก'], ['all', 'แสดงทุกจุด']]} value={popupMode} onChange={v => patchApp({ popupMode: v })} />
      </div>
      <div className={frow}><span className={fl}>ป๊อปอัพ แสดงซ้อนกันได้</span><Switch checked={labelOverlap} onChange={v => patchApp({ labelOverlap: v })} /></div>
      <div className={frow}><span className={fl}>ป๊อปอัพ แสดงวันที่ขาย</span><Switch checked={labelSold} onChange={v => patchApp({ labelSold: v })} /></div>

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
          value={reColor}
          onChange={hex => patchApp({ reColor: hex })}
          className="h-[22px] w-[30px] shrink-0 cursor-pointer rounded-md border border-line2 p-0 hover:border-accent"
          style={{ background: reColor }}
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

      <div className={setSec}>กราฟราคา</div>
      <div className={frow}>
        <span className={fl}>เส้นขีดเวลา</span>
        <Seg<ChartTick>
          items={[['none', 'ไม่แสดง'], ['year', 'ทุกปี'], ['m6', '6 เดือน'], ['m4', '4 เดือน'], ['m3', '3 เดือน']]}
          value={chartTick}
          onChange={v => patchApp({ chartTick: v })}
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

/* ======================= ค้นหา & API ======================= */
type TestState = { status: 'idle' | 'busy' | 'ok' | 'fail'; msg: string };
function ApiTestRow({ label, run }: { label: string; run: () => Promise<string> }) {
  const [t, setT] = useState<TestState>({ status: 'idle', msg: '' });
  const go = () => {
    setT({ status: 'busy', msg: 'กำลังทดสอบ…' });
    const t0 = performance.now();
    run()
      .then(m => setT({ status: 'ok', msg: `✓ ${m} · ${Math.round(performance.now() - t0)}ms` }))
      .catch((e: Error) => setT({ status: 'fail', msg: '✕ ' + (e.message || 'ล้มเหลว') }));
  };
  const resCls = { idle: '', busy: 'border border-dashed border-line2 text-dim', ok: 'bg-accent-dim text-accent', fail: 'bg-[#E5484D] text-white' }[t.status];
  return (
    <div className="flex items-center gap-2 border-b border-line py-[9px]">
      <span className={fl}>{label}</span>
      <button className={btn} onClick={go}>ทดสอบ</button>
      {t.status !== 'idle' && <span className={`whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] font-medium ${resCls}`}>{t.msg}</span>}
    </div>
  );
}
export function SearchApiPane() {
  const cascade = useApp(s => s.cascade);
  const gkey = useApp(s => s.gkey);
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>ลำดับการค้นหาสถานที่ออนไลน์ (Search Cascade)</div>
      <div className={frow}>
        <Seg<Cascade> items={[['google', 'Google → Nominatim'], ['nominatim', 'Nominatim เท่านั้น']]} value={cascade} onChange={v => { patchApp({ cascade: v }); toast('ลำดับการค้นหา: ' + (v === 'google' ? 'Google → Nominatim' : 'Nominatim เท่านั้น')); }} />
      </div>
      <div className={setSec}>คีย์และการทดสอบ API</div>
      <div className="border-b border-line py-[9px]">
        <input className={inp} placeholder="Google Search API Key (จำลอง — ไม่บังคับ)" value={gkey} onChange={e => patchApp({ gkey: e.target.value.trim() })} />
      </div>
      <ApiTestRow label="Google Search Key (จำลอง)" run={() => (gkey ? new Promise(res => setTimeout(() => res('200 OK (จำลอง)'), 650)) : Promise.reject(new Error('ไม่พบ API Key — ใส่คีย์ก่อน')))} />
      <ApiTestRow label="Nominatim Geocoding (OSM)" run={nominatimTest} />
      <ApiTestRow label="Google Road Tiles (lyrs=m)" run={() => tileTest('https://mt0.google.com/vt/lyrs=m&x=6&y=3&z=3')} />
      <ApiTestRow label="Google Satellite Tiles (lyrs=y)" run={() => tileTest('https://mt0.google.com/vt/lyrs=y&x=6&y=3&z=3')} />
      <ApiTestRow label="WMS กรมที่ดิน (dol_hd)" run={() => tileTest(wmsTileUrl(6, 49, 29))} />
      <ApiTestRow label="Terrarium DEM (elevation)" run={() => tileTest('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/64/33.png')} />
      <Hint>คีย์ใช้เพื่อสาธิตลำดับการค้นหาเท่านั้น — หากไม่มีคีย์ ระบบจะสำรองด้วย Nominatim อัตโนมัติ · กล่องค้นหาด้านบนค้นหา "เฉพาะกรอบมองเห็นปัจจุบัน" ทั้งแปลงในระบบและออนไลน์ (Nominatim ใช้ viewbox+bounded) — เลื่อนแผนที่แล้วกดปุ่มลอย "ค้นหาในพื้นที่นี้" เพื่อค้นหาใหม่ · หาก Google tiles โหลดไม่ได้ ระบบจะแสดงแผนที่สำรอง (CARTO) อัตโนมัติ</Hint>
    </>
  );
}

/* ======================= รูปลักษณ์ ======================= */
export function LookPane() {
  const theme = useApp(s => s.theme);
  const bath = useApp(s => s.priceBath);
  const space = useApp(s => s.priceSpace);
  const reduce = useApp(s => s.reduceMotion);
  const glassLevel = useApp(s => s.glassLevel);
  const lbCfg = useApp(s => s.lbCfg);
  const layoutMode = useApp(s => s.layoutMode);
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>รูปแบบหน้าจอ และธีมสี</div>
      <div className={frow}>
        <span className={fl}>ธีมสี</span>
        <Seg<Theme> items={[['graphite', 'เทาเข้ม'], ['oled', 'ดำสนิท (OLED)']]} value={theme} onChange={v => patchApp({ theme: v })} />
      </div>
      <div className={frow}>
        <span className={fl}>เมนูด้านซ้ายมือ</span>
        <Seg<LayoutMode> items={[['docked', 'ชิดขอบ'], ['floating', 'ลอย']]} value={layoutMode} onChange={v => patchApp({ layoutMode: v })} />
      </div>
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

/* ======================= รูปวาด ======================= */
export function DrawSettingsPane() {
  const ddist = useApp(s => s.drawDistMode);
  const circleMeta = useApp(s => s.showCircleMeta);

  return (
    <>
      <div className={setSec}>เครื่องมือวาด — การวัดบนแผนที่</div>
      <div className={frow}>
        <span className={fl}>เส้น/พื้นที่ ป้ายบอกระยะ</span>
        <Seg<DrawDistMode> items={[['both', 'ทั้งหมด'], ['seg', 'ช่วง'], ['round', 'ตัวเลขหลัก'], ['off', 'ซ่อน']]} value={ddist} onChange={v => patchApp({ drawDistMode: v })} />
      </div>
      <div className={frow}>
        <span className={fl}>วงกลม แสดงจุดศูนย์กลางและป้ายรัศมี</span>
        <Switch checked={circleMeta} onChange={v => patchApp({ showCircleMeta: v })} />
      </div>
    </>
  );
}

/* ======================= เกี่ยวกับ ======================= */
export function AboutPane() {
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>บันทึกการเปลี่ยนแปลง</div>
      <div className="my-2 rounded-[10px] border border-line px-[13px] py-2.5 text-[11.5px] leading-[1.9] text-dim">
        <b className="text-[11px] font-semibold text-ink">v2.1.0</b> — ข้อมูลประมูลครบ (ศาล/คดี/หลักประกัน/ราคา/นัด 1-8) · ตาราง: นัดล่าสุด ลำดับที่ 12-716 · ลากคอลัมน์แบบ ghost · ตัวกรอง ขนาด ≥/≤ + ชิป จังหวัด/ตำบล/อำเภอ/ประเภททรัพย์ · แถบเลือกช่วงวันที่ใต้กราฟ · ข้อมูลจังหวัด-อำเภอ-ตำบลแบบลิงก์กัน<br />
        <b className="text-[11px] font-semibold text-ink">v2.0.1</b> — ย้ายไป Vite + React + TypeScript + Tailwind · state รวมศูนย์ด้วย zustand · เลเยอร์แผนที่แยกเป็นโมดูล<br />
        <b className="text-[11px] font-semibold text-ink">v1.1.8</b> — แก้แผนที่ฐานหาย (RCA): ensureAreaLayers() · harden load · แผนที่สำรอง CARTO<br />
        <b className="text-[11px] font-semibold text-ink">v1.1.7</b> — ค้นหา bbox (RCA) · หมุดตัวเลขกลมทึบ + ป้ายหมุนตามมุม · ลบชั้นแล้วเลขเรียงใหม่
      </div>
      <Hint>รายการเปลี่ยนแปลงแบบเต็มอยู่ใน <b className="text-ink">RELEASE_NOTES.md</b></Hint>
      <div className={setSec}>ข้อมูลจำลอง</div>
      <div className={frow}><span className={fl}>แปลงที่ดินทั้งหมด</span><b className="text-xs font-semibold">{ALL_PARCELS.length.toLocaleString('th-TH')} แปลง</b></div>
      <div className={frow}><span className={fl}>จังหวัด</span><b className="text-xs font-semibold">{PROVINCES.length} จังหวัด</b></div>
      <button className={`${btn} mt-3`} onClick={resetAll}><RotateCcw size={14} />รีเซ็ตตัวกรอง คอลัมน์ และการปักหมุด</button>
    </>
  );
}
