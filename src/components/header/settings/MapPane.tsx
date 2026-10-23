import {
  patchApp,
  useApp,
} from '../../../store/useApp';
import { ACCENT } from '../../../data/constants';
import { ColorButton } from '../../ui/ColorButton';
import { Seg } from '../../ui/Seg';
import {
  fl,
  frow,
  setSec,
} from '../../ui/styles';
import { Stepper } from '../../ui/Stepper';
import { Switch } from '../../ui/Switch';
import { type MarkerSize } from '../../../types';

/* แผนที่ - base map, marker size, label density. */
export function MapPane() {
  const markerSize = useApp(s => s.markerSize);
  const searchLimit = useApp(s => s.searchLimit);
  const persistMapView = useApp(s => s.persistMapView);
  const ringColor = useApp(s => s.ringColor);

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
      <div className={frow}>
        <span className={fl}>สีวงแหวนแปลงที่เลือก</span>
        <span className="flex items-center gap-1.5">
          {/* Empty = follow the accent, so the swatch shows what is live now. */}
          <ColorButton
            value={ringColor || ACCENT}
            title="สีวงแหวนแปลงที่เลือก (ทึบ) และแปลงที่ขายรวมกัน (เส้นประ)"
            onChange={hex => patchApp({ ringColor: hex })}
            className="size-[19px] flex-none rounded-[4px] border border-line2"
            style={{ background: ringColor || ACCENT }}
          />
          {ringColor && (
            <button className="text-[10.5px] text-dim2 underline" onClick={() => patchApp({ ringColor: '' })}>ตามสีหลัก</button>
          )}
        </span>
      </div>

      <div className={setSec}>การค้นหา</div>
      <div className={frow}>
        <span className={fl}>จำนวนผลลัพธ์</span>
        <Stepper compact value={searchLimit} step={1} onChange={(v: number | null) => patchApp({ searchLimit: Math.max(1, Math.min(50, v ?? 1)) })} />
      </div>
    </>
  );
}
