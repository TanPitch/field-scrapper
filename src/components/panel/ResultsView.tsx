import { poiIcon } from '../../lib/onlineSearch';
import { lucideSvgByName } from '../../map/pins';
import { useSearch, type SearchRow } from '../../store/useSearch';
import { VPad, VStats } from './shared';

/** Display order and sticky header per group. */
const GROUPS: { kind: SearchRow['kind']; label: string; Icon: keyof typeof ICON }[] = [
  { kind: 'land', label: 'ที่ดิน', Icon: 'map-pin' },
  { kind: 'transport', label: 'รถประจำทาง', Icon: 'bus' },
  { kind: 'cctv', label: 'กล้อง CCTV', Icon: 'cctv' },
  { kind: 'sensor', label: 'เซ็นเซอร์น้ำ/เขื่อน', Icon: 'waves' },
  { kind: 'place', label: 'ออนไลน์', Icon: 'online' },
];

const ICON = {
  'map-pin': 'map-pin',
  bus: 'bus',
  cctv: 'video',
  waves: 'waves',
  online: 'globe',
} as const;

/* sticks just under the VStats strip, which is itself sticky at top-0 —
   plain `top-0` would park it behind VStats and hide it while scrolling */
const groupCls =
  'sticky top-[38px] z-[1] -mx-3.5 flex items-center gap-1.5 border-b border-line bg-panel px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-dim2';

/** ผลการค้นหา — every hit from the title-bar search, grouped by kind. */
export function ResultsView() {
  const rows = useSearch(s => s.rows);
  const query = useSearch(s => s.query);
  const online = useSearch(s => s.online);
  const stale = useSearch(s => s.onlineStale);
  const pickRid = useSearch(s => s.onPick);

  if (!query.trim()) {
    return (
      <VPad>
        <VStats>ยังไม่ได้ค้นหา</VStats>
        <div className="rounded-lg border border-line px-3 py-3 text-[11.5px] leading-[1.7] text-dim">
          พิมพ์คำค้นในช่องด้านบน ผลลัพธ์ทั้งหมดจะแสดงที่นี่
        </div>
      </VPad>
    );
  }

  return (
    <VPad>
      <VStats>
        พบ <b className="font-display font-semibold text-ink">{rows.length}</b> รายการ
        {/* {online.status === 'done' && online.list.length > 0 && (
          <> · ออนไลน์ผ่าน <b className="text-ink">{online.list[0].src}</b></>
        )} */}
      </VStats>

      {online.status === 'loading' && (
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] text-dim">
          <span className="spin-keep inline-block size-3 flex-none animate-spin2 rounded-full border-2 border-line2 border-t-accent" />
          กำลังค้นหาออนไลน์…
        </div>
      )}
      {online.status === 'error' && (
        <div className="rounded-lg bg-[#E5484D]/10 px-2 py-1.5 text-[11.5px] text-[#FF7A6B]">ค้นหาออนไลน์ล้มเหลว</div>
      )}
      {stale && (
        <div className="rounded-lg px-2 py-1.5 text-[11.5px] text-dim">
          พื้นที่มองเห็นเปลี่ยน — กด “ค้นหาในพื้นที่นี้” เพื่อค้นหาใหม่
        </div>
      )}

      {GROUPS.map(g => {
        const list = rows.filter(r => r.kind === g.kind);
        if (!list.length) return null;
        return (
          <section key={g.kind} className="min-w-0">
            <div className={groupCls}>
              <span className="grid size-[13px] place-items-center text-dim2" dangerouslySetInnerHTML={{ __html: lucideSvgByName(ICON[g.Icon]) }} />
              {g.label}
              <span className="font-display text-[10px] font-medium text-dim2">({list.length})</span>
            </div>
            {list.map(r => (
              <div
                key={r.id}
                className="flex cursor-pointer items-center gap-[6px] rounded-lg p-2 hover:bg-panel2"
                onClick={() => pickRid?.(r.id)}
              >
                {r.kind === 'place' ? (
                  /* internet hits get a small lucide glyph — never both children
                     and dangerouslySetInnerHTML on the same element */
                  <span
                    className="grid size-[13px] flex-none place-items-center text-dim2"
                    dangerouslySetInnerHTML={{ __html: lucideSvgByName(poiIcon(r.place?.cat)) }}
                  />
                ) : (
                  <span className="size-[6px] flex-none rounded-full" style={{ background: r.dot ?? 'var(--dim2)' }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs">{r.name}</div>
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2">
                    {r.kind === 'place' ? r.sub : ''}
                  </div>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {!rows.length && online.status !== 'loading' && (
        <div className="rounded-lg border border-line px-3 py-3 text-[11.5px] text-dim">
          ไม่พบผลลัพธ์สำหรับ “{query.trim()}” ในกรอบมองเห็นนี้
        </div>
      )}
    </VPad>
  );
}