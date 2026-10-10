import { X } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useEffect, type ReactNode } from 'react';
import { deselectPin, setRight } from '../../store/actions';
import { clearSearchSelection } from '../../map/pins';
import { useApp } from '../../store/useApp';
import type { RightView } from '../../types';
import { iconBtn } from '../ui/styles';
import { AreaView } from './AreaView';
import { DetailView } from './DetailView';
import { DrawView } from './DrawView';
import { OverlayView } from './OverlayView';
import { CctvView, PinSettingsView, SearchView, SensorView, TransportSettingsView, TransportView } from './PinViews';
import { ResultsView } from './ResultsView';

const TITLES: Record<RightView, string> = {
  results: 'ผลการค้นหา', overlay: 'ตั้งค่าเลย์เยอร์', draw: 'เครื่องมือวาด', area: 'ตั้งค่าพื้นที่', detail: 'รายละเอียดที่ดิน',
  cctv: 'กล้อง CCTV', sensor: 'เซ็นเซอร์น้ำ', 'pins-settings': 'เซ็นเซอร์น้ำ/เขื่อน — ตั้งค่า', transport: 'รถประจำทาง', 'transport-settings': 'รถประจำทาง — ตั้งค่า', search: 'ค้นหาที่ดิน',
};

export function RightPanel({ small }: { small: boolean }) {
  const view = useApp(s => s.rpView);
  const open = useApp(s => s.rightOpen);
  const overlaySel = useApp(s => s.overlaySel);
  const overlays = useApp(s => s.overlays);
  const pinSel = useApp(s => s.pinSel);
  const cctv = useApp(s => s.cctvList.find(p => p.id === pinSel));
  const sens = useApp(s => s.sensList.find(p => p.id === pinSel));
  const transport = useApp(s => s.transportList.find(p => p.id === pinSel));

/* Closing the panel drops every green ring: the search ring for internet hits,
     and the cctv / water / bus ring. Whatever fired the close — the X button,
     the header toggle or the small-screen swipe — the effect covers all of them. */
useEffect(() => { if (!open) { deselectPin(); clearSearchSelection(); } }, [open]);

  let title = TITLES[view];
  if (view === 'overlay') title = 'เลย์เยอร์: ' + (overlays.find(o => o.id === overlaySel)?.name ?? '');
  if (view === 'cctv' && cctv) title = 'กล้อง CCTV — ' + cctv.name;
  if (view === 'sensor' && sens) title = (sens.type === 'dam' ? 'เขื่อน/อัตราไหล — ' : 'เซ็นเซอร์น้ำ — ') + sens.name;
  if (view === 'transport' && transport) title = 'รถประจำทาง — ' + transport.name;

  const body: Record<RightView, ReactNode> = {
    results: <ResultsView />, overlay: <OverlayView />, draw: <DrawView />, area: <AreaView />, detail: <DetailView />,
    cctv: <CctvView />, sensor: <SensorView />, 'pins-settings': <PinSettingsView />, transport: <TransportView />, 'transport-settings': <TransportSettingsView />, search: <SearchView />,
  };

  return (
    <aside
      className={`fs-panel z-30 overflow-hidden border-l border-line bg-panel [grid-area:rp] transition-all duration-300 ease-panel ${
        small
          ? `fixed bottom-0 right-0 top-[var(--header-h)] z-[47] w-[min(92vw,380px)] border-line2 shadow-[-16px_0_40px_rgba(0,0,0,.5)] transition-transform ${open ? 'translate-x-0' : 'translate-x-[105%]'}`
          : ''
      }`}
    >
      <div className="flex h-full w-[400px] max-w-full flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-line px-3.5 py-1.5">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">{title}</span>
          <button className={`${iconBtn} ml-auto`} {...useTipProps('ปิดแผง')} onClick={() => setRight(false)}><X size={17} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">{body[view]}</div>
      </div>
    </aside>
  );
}
