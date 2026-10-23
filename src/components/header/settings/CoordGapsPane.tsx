import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
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
  deed_number: string | null;
  land_title: string | null;
  td_status: string | null;
  dol_status: string | null;
  td_verdict: string | null;
  dol_verdict: string | null;
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
  /** Why the resolver could not place it, in words. */
  geo_note: string | null;
}

interface Summary {
  matched: number;
  mismatch: number;
  waiting_dol: number;
  dead_end: number;
  never_tried: number;
  wrong_tambon: number;
  wrong_district: number;
  ambiguous: number;
  wrong_area: number;
  no_deed: number;
  total: number;
}

/**
 * Why a row is here, in the same terms as the summary counts above it.
 *
 * The classification mirrors /api/admin/coord-gaps exactly - matched, then
 * district_mismatch, then waiting for DOL's quota, then a dead end, then never
 * tried at all. Deriving it here from the same two verdict columns means the
 * per-row tag and the headline number can never disagree; the summary is the
 * same arithmetic done in SQL.
 *
 * `no_deed` wins over everything else, because a parcel with no deed number is
 * unresolvable by construction and labelling it "no result" would read as
 * "we looked and it was not there".
 */
type GapKind = 'no_deed' | 'never_tried' | 'waiting_dol' | 'dead_end' | 'district_mismatch'
  | 'tambon_mismatch' | 'ambiguous' | 'area_mismatch' | 'other';

const GAP_KIND: Record<GapKind, { th: string; cls: string }> = {
  no_deed: { th: 'ไม่มีเลขโฉนด', cls: 'text-err' },
  never_tried: { th: 'ยังไม่ได้ตรวจ', cls: 'text-dim2' },
  waiting_dol: { th: 'รอ DOL', cls: 'text-warn' },
  dead_end: { th: 'TD/DOL ไม่มี', cls: 'text-dim2' },
  district_mismatch: { th: 'อำเภอไม่ตรง', cls: 'text-warn' },
  tambon_mismatch: { th: 'ตำบลไม่ตรง', cls: 'text-warn' },
  ambiguous: { th: 'TD มีหลายแปลง', cls: 'text-warn' },
  area_mismatch: { th: 'ขนาดไม่ตรง', cls: 'text-err' },
  other: { th: 'อื่น ๆ', cls: 'text-dim2' },
};

function gapKind(g: Gap): GapKind {
  if (!g.deed_number) return 'no_deed';
  if (g.td_verdict === 'match' || g.dol_verdict === 'match') return 'other';
  if (g.dol_verdict === 'pending_quota') return 'waiting_dol';
  if (g.dol_verdict === 'tambon_mismatch') return 'tambon_mismatch';
  if (g.dol_verdict === 'ambiguous') return 'ambiguous';
  if (g.dol_verdict === 'area_mismatch') return 'area_mismatch';
  if (g.dol_verdict === 'district_mismatch') return 'district_mismatch';
  if (g.td_verdict === 'district_mismatch') return 'district_mismatch';
  if (g.td_verdict === 'no_result' || g.dol_verdict === 'no_result') return 'dead_end';
  if (g.td_verdict == null && g.dol_verdict == null) return 'never_tried';
  return 'other';
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
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<GapKind | ''>('');
  /* Full-screen error-lands editing: the pane normally lives inside the
     animated settings drawer, where position:fixed would anchor to the
     drawer's transform — the full-screen frame is portalled to <body> instead. */
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

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

  /* Filtered on the client because the list is already capped at 300 rows, and
     the fields a person searches on - province, district, deed, case - are all
     in the response. Paging it server-side would mean a second round trip for
     every keystroke over a list that fits in memory. */
  const needle = q.trim().toLowerCase();
  const shown = gaps.filter((g) => {
    if (only && gapKind(g) !== only) return false;
    if (!needle) return true;
    return [g.province_name, g.district_name, g.district_ref, g.deed_number, g.land_title,
      g.case_no, g.case_year, g.td_status, g.dol_status, g.dol_office]
      .some((v) => v != null && String(v).toLowerCase().includes(needle));
  });

  const body = (
    <>
      <div className={setSec}>ข้อมูลที่ยังหาไม่เจอ</div>
      {err && <p className="text-[12px] text-err">เข้าถึงข้อมูลไม่ได้: {err}</p>}
      {summary && (
        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] leading-[1.7]">
          <span className="text-dim2">ทั้งหมด</span><span className="font-display">{summary.total}</span>
          <span className="text-dim2">จับคู่แล้ว</span><span className="font-display">{summary.matched}</span>
          <span className="text-warn">อำเภอไม่ตรง</span><span className="font-display text-warn">{summary.mismatch}</span>
          <span className="text-dim2">รอ DOL (โควตาหมด)</span><span className="font-display">{summary.waiting_dol}</span>
          <span className="text-dim2">TD กับ DOL ไม่มี</span><span className="font-display">{summary.dead_end}</span>
          <span className="text-warn">ตำบลไม่ตรง</span><span className="font-display text-warn">{summary.wrong_tambon}</span>
          <span className="text-warn">อำเภอไม่ตรง</span><span className="font-display text-warn">{summary.wrong_district}</span>
          <span className="text-warn">TD มีหลายแปลง</span><span className="font-display text-warn">{summary.ambiguous}</span>
          <span className="text-err">ขนาดไม่ตรง</span><span className="font-display text-err">{summary.wrong_area}</span>
          <span className="text-dim2">ยังไม่ได้ตรวจ</span><span className="font-display">{summary.never_tried}</span>
          <span className="text-dim2">ไม่มีเลขโฉนด</span><span className="font-display">{summary.no_deed}</span>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          className={`${inp} min-w-0 flex-1`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา จังหวัด / อำเภอ / เลขโฉนด / คดี…"
        />
        <button className={btn} onClick={() => void load()} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'กำลังโหลด…' : 'โหลดใหม่'}
        </button>
        <button className={btn} onClick={() => setBig(!big)}>
          {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {big ? 'ย่อ' : 'เต็มจอ'}
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        <button
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${only === '' ? 'border-accent text-accent' : 'border-line text-dim2'}`}
          onClick={() => setOnly('')}
        >ทั้งหมด {gaps.length}</button>
        {(Object.keys(GAP_KIND) as GapKind[]).map((k) => {
          const n = gaps.filter((g) => gapKind(g) === k).length;
          if (!n) return null;
          return (
            <button key={k}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${only === k ? 'border-accent text-accent' : 'border-line text-dim2'}`}
              onClick={() => setOnly(only === k ? '' : k)}>
              {GAP_KIND[k].th} {n}
            </button>
          );
        })}
      </div>

      <table className="mt-3 w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-dim2">
            <th className="py-1 pr-2 font-medium">ปัญหา</th>
            <th className="py-1 pr-2 font-medium">จังหวัด / อำเภอ</th>
            <th className="py-1 pr-2 font-medium">เลขโฉนด</th>
            <th className="py-1 pr-2 font-medium">ขนาด (ตร.วา)</th>
            <th className="py-1 pr-2 font-medium">พิกาด (lat, lng)</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((g) => {
            const v = edit[g.id];
            const has = g.td_lat != null || g.dol_lat != null;
            const kind = gapKind(g);
            return (
              <tr key={g.id} className="border-b border-line/40 align-top">
                <td className={`py-1.5 pr-2 text-[10.5px] ${GAP_KIND[kind].cls}`}>
                  {GAP_KIND[kind].th}
                  {g.geo_note && <div className="mt-0.5 text-[10px] leading-[1.4] text-dim2">{g.geo_note}</div>}
                </td>
                <td className="py-1.5 pr-2">
                  {g.province_name ?? '-'}
                  <div className="text-[10px] text-dim2">
                    {g.district_ref ?? g.district_name ?? '-'}
                    {g.district_name && g.district_ref && g.district_name !== g.district_ref && (
                      <span className="ml-1 text-warn">LED: {g.district_name}</span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  {g.deed_number ?? <span className="text-err">ไม่มี</span>}
                  {g.case_no && <div className="text-[10px] text-dim2">{g.case_no}/{g.case_year}</div>}
                </td>
                <td className="py-1.5 pr-2 font-display">{size(g)}</td>
                <td className="py-1.5 pr-2">
                  {has && !v && <span className="font-display">{num(g.td_lat)}, {num(g.td_lon)}</span>}
                  {!has && !v && <span className="text-dim2">-</span>}
                  {v && (
                    <span className="flex gap-1">
                      <input className={`${inp} w-20 py-0.5`} placeholder="lat" value={v.lat}
                        onChange={(e) => setEdit({ ...edit, [g.id]: { ...v, lat: e.target.value } })} />
                      <input className={`${inp} w-20 py-0.5`} placeholder="lng" value={v.lon}
                        onChange={(e) => setEdit({ ...edit, [g.id]: { ...v, lon: e.target.value } })} />
                      <button className={btn} onClick={() => void save(g)}>บันทึก</button>
                      <button className={btn} onClick={() => {
                        const next = { ...edit }; delete next[g.id]; setEdit(next);
                      }}>ยกเลิก</button>
                    </span>
                  )}
                  {!v && (
                    <button className="text-[10px] text-accent underline"
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
      {!!gaps.length && !shown.length && <p className="mt-2 text-[11px] text-dim2">ไม่ตรงกับที่ค้นหา</p>}
    </>
  );

  if (big) {
    return createPortal((
      <div className="fixed inset-0 z-[120] overflow-y-auto bg-panel p-3">
        <button
          className="fixed right-3 top-3 z-[121] inline-flex size-[31px] cursor-pointer items-center justify-center rounded-lg border border-line2 bg-panel text-dim transition hover:text-ink"
          onClick={() => setBig(false)}
        ><X size={15} /></button>
        {body}
      </div>
    ), document.body);
  }
  return <div className="px-3 pb-6">{body}</div>;
}