import { LB_FIELDS, THEME_ACCENT } from '../../../data/constants';
import { patchApp, useApp } from '../../../store/useApp';
import { formatMoney } from '../../../lib/format';
import { ColorButton } from '../../ui/ColorButton';
import { Seg } from '../../ui/Seg';
import {
  btn,
  fl,
  frow,
  pillCls,
  setSec,
} from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import {
  THEMES,
  type GlassLevel,
  type LayoutMode,
  type Theme,
} from '../../../types';
import { Hint } from './shared';

/* รูปลักษณ์ - theme, accent colour, lightbox chrome. Holds the per-theme default accent. */
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
/** The theme's own accent for the picker's reset value. One table, one source
 *  of truth — the copy used to live here while the chart and the map needed
 *  the same values, and the two had to be edited in lockstep. */
const getThemeAccent = (t: Theme): string => THEME_ACCENT[t] ?? THEME_ACCENT.graphite;
