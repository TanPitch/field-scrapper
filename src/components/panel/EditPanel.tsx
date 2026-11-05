import { X } from 'lucide-react';
import { PARCEL_BY_ID } from '../../data/liveData';
import { useApp, patchApp } from '../../store/useApp';
import { iconBtn } from '../ui/styles';
import { useTipProps } from '../ui/Tip';
import { AdminEditor } from './ParcelReport';

/**
 * แก้ไขข้อมูล (แอดมิน) — the small panel that sits beside the right detail
 * panel (grid area `ep`), so the editor no longer takes the tail of the detail
 * panel and pushes the price chart off screen. It simply follows the right
 * panel's selected parcel; the map-click placement code lives with it.
 */
export function EditPanel({ small }: { small: boolean }) {
  const open = useApp(s => s.editOpen);
  const id = useApp(s => s.selectedId);
  const p = id != null ? PARCEL_BY_ID.get(id) : undefined;

  return (
    <aside
      className={`fs-panel z-30 overflow-hidden border-l border-line bg-panel [grid-area:ep] transition-all duration-300 ease-panel ${
        small
          ? `fixed bottom-0 right-0 top-[var(--header-h)] z-[48] w-[min(92vw,380px)] border-line2 shadow-[-16px_0_40px_rgba(0,0,0,.5)] transition-transform ${open ? 'translate-x-0' : 'translate-x-[105%]'}`
          : open ? '' : 'hidden'
      }`}
    >
      <div className="flex h-full w-[300px] max-w-full flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-line px-3.5 py-1.5">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">แก้ไขข้อมูล (แอดมิน)</span>
          <button className={`${iconBtn} ml-auto`} {...useTipProps('ปิดแผงแก้ไข')} onClick={() => patchApp({ editOpen: false })}><X size={17} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5">
          {p ? <AdminEditor p={p} /> : (
            <div className="px-3 py-8 text-center text-[12px] leading-[1.8] text-dim">
              ยังไม่ได้เลือกแปลง<br />
              <span className="text-[11px] text-dim2">คลิกจุดบนแผนที่หรือแถวในตาราง เพื่อแก้ไขข้อมูลของแปลงนั้น</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
