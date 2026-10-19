import { patchApp, useApp } from '../../../store/useApp';
import { Seg } from '../../ui/Seg';
import {
  fl,
  frow,
  setSec,
} from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import { type DrawDistMode } from '../../../types';

/* รูปวาด - distance labels, circle metadata. */
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
