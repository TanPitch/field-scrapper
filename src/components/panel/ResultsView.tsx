import { RES_CAP, SORT_LABELS } from '../../data/constants';
import { useMoney } from '../../hooks/useMoney';
import { useParcels } from '../../hooks/useParcels';
import { parcelDot } from '../../lib/parcelColor';
import { select } from '../../store/actions';
import { useApp } from '../../store/useApp';
import { ResCap, VPad, VStats } from './shared';

export function ResultsView() {
  const { tbl, viewRows } = useParcels();
  const fmt = useMoney();
  const sort = useApp(s => s.sort);
  const selectedId = useApp(s => s.selectedId);
  const shown = viewRows.slice(0, RES_CAP);

  return (
    <VPad>
      <VStats>
        พบ <b className="font-display font-semibold text-ink">{tbl.length.toLocaleString('th-TH')}</b> แปลง (รวมปักหมุด) · เรียงตาม {SORT_LABELS[sort.key] ?? sort.key} ({sort.dir === 'asc' ? 'น้อย→มาก' : 'มาก→น้อย'})
      </VStats>
      {shown.map(p => (
        <div
          key={p.id}
          onClick={() => select(p.id)}
          className={`flex cursor-pointer items-center gap-[9px] rounded-lg p-2 hover:bg-panel2 ${selectedId === p.id ? 'bg-accent-dim shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
        >
          <span className="inline-block size-[7px] shrink-0 rounded-full" style={{ background: parcelDot(p) }} />
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs">{p.name}</div>
            <div className="font-display text-[10.5px] text-dim2">{p.deed} · {p.province}</div>
          </div>
          <span className="shrink-0 font-display text-xs font-semibold">{fmt(p.price)}</span>
        </div>
      ))}
      <ResCap>{tbl.length > RES_CAP ? `แสดง ${RES_CAP} รายการแรก — ใช้ตารางด้านล่างเพื่อดูทั้งหมด` : 'แสดงครบทุกรายการในมุมมองปัจจุบัน'}</ResCap>
    </VPad>
  );
}
