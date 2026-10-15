import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { toast } from '../../../store/useApp';
import { btn, inp, setSec } from '../../ui/styles';

/** One parcel the resolve cascade could not place, as /api/admin/coord-gaps returns it. */
interface Gap {
  id: number;
  province_name: string | null;
  district_name: string | null;
  district_ref: string | null;
  td_match_method: string | null;
  tumbol: string | null;
  deed_number: string | null;
  land_title: string | null;
  td_status: string | null;
  dol_status: string | null;
  td_rawang: string | null;
  td_lat: number | null;
  td_lon: number | null;
  dol_lat: number | null;
  dol_lon: number | null;
  dol_office: string | null;
  size_rai: number | null;
  size_ngan: number | null;
  size_wa: number | null;
  case_no: string | null;
  case_year: string | null;
}

interface Summary {
  td_resolved: number;
  dol_resolved: number;
  unresolved: number;
  no_coords: number;
  no_deed: number;
  total: number;
}

/**
 * Parcels LED listed that neither TD nor DOL could place, for an admin to
 * correct by hand.
 *
 * Read-only on purpose by default: the coordinates an admin types in are a guess
 * from a map, and writing them straight into td_lat would make the resolver
 * treat that guess as authoritative on the next pass. So a row is marked
 * resolved only when someone fills the coordinate in.
 *
 * The size column is the giveaway. LED's rai/ngan/wa against DOL's is the check
 * that caught the subwa scaling bug (LED 58.60 against DOL 58.06), so it is on
 * screen rather than only in the resolver's log.
 */
export function CoordGapsPane() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<number, { lat: string; lon: string }>>({});

  const load = useCallback(async () => {
    setBusy(true);
    const r = await api.get<{ gaps: Gap[]; summary: Summary }>('/api/admin/coord-gaps?limit=300');
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr(null);
    setGaps(r.data!.gaps);
    setSummary(r.data!.summary);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (g: Gap) => {
    const v = edit[g.id];
    if (!v) return;
    const lat = Number(v.lat), lon = Number(v.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast('กรอกพิกาดให้ถูกต้อง', 'warn'); return; }
    const r = await api.patch(`/api/admin/coord-gaps/${g.id}`, { td_lat: lat, td_lon: lon, td_status: 'resolved' });
    if (!r.ok) { toast(r.error ?? 'บันทึกไม่สำเร็จ', 'warn'); return; }
    toast(`บันทึกพิกาดแล้ว — ${g.deed_number ?? g.id}`);
    void load();
  };

  const num = (v: number | null) => (v == null ? '-' : String(v));
  const size = (g: Gap) => [g.size_rai, g.size_ngan, g.size_wa].some((x) => x != null) ? `${num(g.size_rai)}-${num(g.size_ngan)}-${num(g.size_wa)}` : '-';

  return (
    <div className="px-3 pb-6">
      <div className={setSec}>ข้อมูลที่ยังหาไม่เจอ</div>
      {err && <p className="text-[12px] text-err">เข้าถึงข้อมูลไม่ได้: {err}</p>}
      {summary && (
        <p className="mb-2 text-[11px] leading-[1.7] text-dim2">
          ทั้งหมด {summary.total} แปลง — TD ให้ {summary.td_resolved} · DOL ให้ {summary.dol_resolved} ·
          ยังไม่ได้ {summary.unresolved} · ไม่มีพิกาด {summary.no_coords} · ไม่มีเลขโฉนด {summary.no_deed}
        </p>
      )}

      <button className={btn} onClick={() => void load()} disabled={busy}>
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'กำลังโหลด…' : 'โหลดใหม่'}
      </button>

      <table className="mt-3 w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-dim2">
            <th className="py-1 pr-2 font-medium">เลขโฉนด</th>
            <th className="py-1 pr-2 font-medium">อำเภอ / ตำบล</th>
            <th className="py-1 pr-2 font-medium">ขนาด (ตร.วา)</th>
            <th className="py-1 pr-2 font-medium">ระวาง</th>
            <th className="py-1 pr-2 font-medium">พิกาด (lat, lng)</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => {
            const v = edit[g.id];
            const has = g.td_lat != null || g.dol_lat != null;
            return (
              <tr key={g.id} className="border-b border-line/40 align-top">
                <td className="py-1.5 pr-2">
                  {g.deed_number ?? <span className="text-err">ไม่มี</span>}
                  {g.case_no && <div className="text-[10px] text-dim2">{g.case_no}/{g.case_year}</div>}
                </td>
                <td className="py-1.5 pr-2">
                  {g.district_ref ?? g.district_name ?? '-'}
                  <div className="text-[10px] text-dim2">{g.tumbol ?? '-'}</div>
                  {g.district_name && g.district_ref && g.district_name !== g.district_ref && (
                    <div className="flex items-center gap-1 text-[10px] text-warn">
                      <AlertTriangle size={10} /> LED: {g.district_name}
                    </div>
                  )}
                </td>
                <td className="py-1.5 pr-2 font-display">{size(g)}</td>
                <td className="py-1.5 pr-2 text-dim2">{g.td_rawang ?? g.dol_office ?? '-'}</td>
                <td className="py-1.5 pr-2">
                  {has && !v && <span className="font-display">{num(g.td_lat)}, {num(g.td_lon)}</span>}
                  {!has && !v && <span className="text-dim2">-</span>}
                  {v && (
                    <span className="flex gap-1">
                      <input className={`${inp} w-24 py-0.5`} placeholder="lat" value={v.lat}
                        onChange={(e) => setEdit({ ...edit, [g.id]: { ...v, lat: e.target.value } })} />
                      <input className={`${inp} w-24 py-0.5`} placeholder="lng" value={v.lon}
                        onChange={(e) => setEdit({ ...edit, [g.id]: { ...v, lon: e.target.value } })} />
                      <button className={btn} onClick={() => void save(g)}>บันทึก</button>
                    </span>
                  )}
                  {!v && (
                    <button className="ml-1 text-[10px] text-accent underline"
                      onClick={() => setEdit({ ...edit, [g.id]: { lat: '', lon: '' } })}>
                      แก้ไข
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!gaps.length && !busy && !err && <p className="mt-2 text-[11px] text-dim2">ไม่มีรายการที่ค้างอยู่</p>}
    </div>
  );
}