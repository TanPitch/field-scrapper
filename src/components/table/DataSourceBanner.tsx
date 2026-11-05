import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { useParcels, useRefreshParcels } from '../../hooks/useParcels';
import { useTipProps } from '../ui/Tip';

/**
 * Says out loud which dataset is on screen, and says it honestly while the
 * first fetch is in flight. The seeded mockup set was removed, so while the
 * server has not answered the map is empty — this banner is what keeps that
 * from reading as "no land exists". An error stays until a reload succeeds.
 */
export function DataSourceBanner() {
  const { origin, loadError, loading } = useParcels();
  const count = useParcels().vis.length;
  const refresh = useRefreshParcels();

  /* Loading: the spinner line replaces the data bar. Saying "กำลังโหลด" here
     is the popup alert the user asked for without a modal blocking the map. */
  if (loading && origin === 'loading') {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px] text-dim">
        <RefreshCw size={11} className="animate-spin" />
        กำลังโหลดข้อมูลแปลงจากเซิร์ฟเวอร์…
      </div>
    );
  }

  /* Loaded successfully: a slim confirmation rather than nothing. When the map
     "works at home but not elsewhere", the first question is always
     "which set am I looking at, and how big is it". */
  if (origin === 'api' && !loadError) {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1 text-[10.5px] text-dim2">
        <Database size={11} className="flex-none text-[#6BD07C]" />
        <span>
          ข้อมูลจริงจากเซิร์ฟเวอร์ — <b className="font-display text-dim">{count}</b> แปลงในมุมมองนี้
        </span>
        <button
          onClick={refresh}
          {...useTipProps('โหลดข้อมูลใหม่')}
          className="ml-auto inline-flex items-center gap-1 rounded-[5px] px-1.5 py-[1px] text-[10px] text-dim2 hover:bg-panel2 hover:text-ink"
        >
          <RefreshCw size={10} />รีเฟรช
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 border-b border-[#7A5B1F] bg-[#241C0C] px-3 py-1.5 text-[11px] text-[#FFD93D]"
      {...useTipProps(loadError ?? undefined)}
    >
      <AlertTriangle size={12} className="flex-none" />
      <span className="min-w-0 flex-1 truncate">
        <b>โหลดข้อมูลไม่ได้</b>{loadError ? ` — ${loadError}` : ' — เซิร์ฟเวอร์ยังไม่ตอบกลับ'}
        <span className="ml-1 text-[#FFD93D]/80">แผนที่จะว่างจนกว่าข้อมูลจริงมาถึง เริ่มเซิร์ฟเวอร์ด้วย <b className="font-display">bun server/index.js</b></span>
      </span>
      <span className="flex-none">
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded-[5px] border border-[#7A5B1F] px-1.5 py-[2px] text-[10.5px] text-[#FFD93D] hover:bg-[#3A2D12]"
        >
          <RefreshCw size={10} />ลองใหม่
        </button>
      </span>
    </div>
  );
}

/** Compact positive confirmation, for the settings pane. Real data, and how much. */
export function DataSourceBadge() {
  const { origin, loading } = useParcels();
  if (loading && origin === 'loading') return <span className="text-dim2">กำลังโหลด…</span>;
  return origin === 'api' ? (
    <span className="inline-flex items-center gap-1 text-[#6BD07C]">
      <Database size={11} />ข้อมูลจริงจากเซิร์ฟเวอร์
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[#FFD93D]">
      <AlertTriangle size={11} />โหลดข้อมูลไม่ได้ (ต่อเซิร์ฟเวอร์ไม่ได้)
    </span>
  );
}
