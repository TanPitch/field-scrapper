import { useState } from 'react';
import { SETTINGS_SECRET } from '../../../data/constants';
import {
  patchApp,
  toast,
  useApp,
} from '../../../store/useApp';
import { Seg } from '../../ui/Seg';
import {
  btn,
  fl,
  frow,
  inp,
  setSec,
} from '../../ui/styles';
import { Stepper } from '../../ui/Stepper';
import { Switch } from '../../ui/Switch';
import { type MarkerSize } from '../../../types';

/* แผนที่ - base map, marker size, label density. */
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
