import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { useParcels, useRefreshParcels } from '../../hooks/useParcels';
import { useTipProps } from '../ui/Tip';

/**
 * Says out loud which dataset is on screen.
 *
 * This exists because the app can show either real scraped parcels or seeded
 * fixtures, and the two are indistinguishable without it. A user looking for
 * Khon Kaen land who cannot find any deserves to be told "the API is not
 * answering, these are samples" rather than concluding the scraper is broken —
 * or worse, believing the samples are real.
 *
 * Shown when there IS a problem. Once live data arrives it disappears, because a
 * permanent green banner is noise.
 */
export function DataSourceBanner() {
  const { origin, loadError, loading } = useParcels();
  const count = useParcels().vis.length;
  const refresh = useRefreshParcels();

  /* Loaded successfully: a slim confirmation rather than nothing. When the map
     "works with fixtures but not with real data", the first question is always
     "which set am I looking at, and how big is it" — and that was previously
     unanswerable from the UI. */
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

  if (loading && origin === 'fixtures') {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px] text-dim">
        <RefreshCw size={11} className="animate-spin" />
        กำลังโหลดข้อมูลจริงจากเซิร์ฟเวอร์…
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 border-b border-[#7A5B1F] bg-[#241C0C] px-3 py-1.5 text-[11px] text-[#FFD93D]"
      {...useTipProps(loadError ?? 'fallback')}
    >
      <AlertTriangle size={12} className="flex-none" />
      <span className="min-w-0 flex-1 truncate">
        <b>กำลังแสดงข้อมูลตัวอย่าง</b>
        {loadError ? ` ไม่ได้เชื่อมต่อเซิร์ฟเวอร์: ${loadError}` : ''}
        <span className="ml-1 text-[#FFD93D]/80">— ข้อมูลจริงจะโหลดเมื่อรัน <b className="font-display">bun server/index.js</b></span>
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
  if (loading && origin === 'fixtures') return <span className="text-dim2">กำลังตรวจสอบ…</span>;
  return origin === 'api' ? (
    <span className="inline-flex items-center gap-1 text-[#6BD07C]">
      <Database size={11} />ข้อมูลจริงจากเซิร์ฟเวอร์
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[#FFD93D]">
      <AlertTriangle size={11} />ข้อมูลตัวอย่าง (ต่อเซิร์ฟเวอร์ไม่ได้)
    </span>
  );
}
