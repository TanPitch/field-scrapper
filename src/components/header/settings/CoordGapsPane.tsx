import { createPortal } from 'react-dom';
import { ClipboardPaste, Crosshair, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { patchApp, toast } from '../../../store/useApp';
import { btn, inp, setSec } from '../../ui/styles';
import { useRefreshParcels } from '../../../hooks/useParcels';
import { useTipProps } from '../../ui/Tip';
import { getMap } from '../../../map/mapRef';

/* "เลือกบนแผนที่" has to close the drawer to expose the map — and closing
   the drawer unmounts this pane, taking every React state along. The picked
   point therefore travels through module scope: the one-shot click handler
   writes it here, the drawer reopens, and the mount effect turns it back
   into popup state. */
let mapPick: { gap: Gap; lat: number; lng: number } | null = null;

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
  /** Admin's reviewed verdict from the [ผิดพลาด] button — the parcel is bad
   *  data, not missing data. Hidden from the map/table payload server-side;
   *  shown here only under the error chip. */
  reviewed_error: boolean | null;
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
  no_deed: { th: 'ไม่มีเลขโฉนด', cls: 'text-warn' },
  never_tried: { th: 'ยังไม่ได้ตรวจ', cls: 'text-warn' },
  waiting_dol: { th: 'รอ DOL', cls: 'text-warn' },
  dead_end: { th: 'TD/DOL ไม่มี', cls: 'text-warn' },
  district_mismatch: { th: 'อำเภอไม่ตรง', cls: 'text-warn' },
  tambon_mismatch: { th: 'ตำบลไม่ตรง', cls: 'text-warn' },
  ambiguous: { th: 'TD มีหลายแปลง', cls: 'text-warn' },
  area_mismatch: { th: 'ขนาดไม่ตรง', cls: 'text-ewarnrr' },
  other: { th: 'อื่น ๆ', cls: 'text-warn' },
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

/* ---------- bulk paste mode ----------
 *
 * The admin copies lines from another source, one parcel per line:
 *   72956 0-0-32 [12.72002572,99.94910112] ชะอำ ชะอำ เพชรบุรี
 *   เลขโฉนด ไร่-งาน-ตร.วา [lat, lng]            ตำบล อำเภอ จังหวัด
 * The line is parsed into an editable preview table first (so a broken line
 * can be fixed or dropped before anything moves), sent to
 * POST /api/admin/coord-gaps/parse for the per-field verdict, and only rows
 * that come back clean can be written through the existing PATCH endpoint.
 */
interface PRow {
  deed: string; size: string; lat: string; lon: string;
  tambol: string; amphur: string; city: string;
  verdict: null | { ok: boolean; parcelId: number | null; verdict: Record<string, string> };
}

const PLACE = /^(\S+)\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*(.*)$/;

function parsePaste(src: string, into: PRow[] = []): PRow[] {
  const rows = into;
  for (const line of src.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = PLACE.exec(line);
    if (!m) continue; /* silently dropped: the preview only shows rows it understood */
    const [tambol = '', amphur = '', ...city] = m[7]!.trim().split(/\s+/);
    rows.push({
      deed: m[1]!, size: `${m[2]}-${m[3]}-${m[4]}`, lat: m[5]!, lon: m[6]!,
      tambol, amphur, city: city.join(' '), verdict: null,
    });
  }
  return rows;
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
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<GapKind | ''>('');
  /* [error] chip: reviewed-error rows are hidden until the admin asks for
     them — unselected shows the normal work list. */
  const [showErr, setShowErr] = useState(false);
  /* Small edit popup per the [แก้ไข] button: read-only context fields, two
     coordinate inputs, save/cancel. Populated from the row it opened on. */
  const [pop, setPop] = useState<Gap | null>(null);
  const [popLat, setPopLat] = useState('');
  const [popLon, setPopLon] = useState('');
  /* Apply a point a one-shot map click delivered while this pane was
     unmounted (mapPick is module scope precisely for that gap in time). */
  useEffect(() => {
    if (!mapPick) return;
    setPop(mapPick.gap);
    setPopLat(String(mapPick.lat));
    setPopLon(String(mapPick.lng));
    mapPick = null;
  }, []);
  const refreshParcels = useRefreshParcels();
  /* Full-screen error-lands editing: the pane normally lives inside the
     animated settings drawer, where position:fixed would anchor to the
     drawer's transform — the full-screen frame is portalled to <body> instead. */
  const [big, setBig] = useState(false);
  /* Bulk paste mode (see parsePaste above). */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [pRows, setPRows] = useState<PRow[]>([]);
  const [pBusy, setPBusy] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* Capture on window, ahead of the settings drawer's document-level
         Escape handler: minimising the pane should not close the whole
         settings panel the user opened it from. */
      e.stopPropagation();
      setBig(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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

  /* The [ผิดพลาด] button: one PATCH carrying the boolean. false un-marks —
     the endpoint treats both real states, so the button is its own undo. */
  const toggleError = async (g: Gap) => {
    const mark = !g.reviewed_error;
    const r = await api.patch(`/api/admin/coord-gaps/${g.id}`, { reviewed_error: mark });
    if (!r.ok) { toast(r.error ?? 'บันทึกไม่สำเร็จ', 'warn'); return; }
    toast(mark ? `ขึ้นสถานะผิดพลาด — ${g.deed_number ?? g.id}` : `ยกเลิกผิดพลาด — ${g.deed_number ?? g.id}`);
    void load();
    /* The features payload excludes reviewed rows, so the map's dataset must
       drop the dot the moment the verdict lands — the download is cheap and
       the refresh button does the same. */
    refreshParcels();
  };

  /* Save from the edit popup — same PATCH the inline editor used. Coordinates
     come back in whatever shape the clipboard held: "16.46796629,102.83515227"
     pasted into either box, two numbers split across the boxes, or a stray
     comma/space between them. Every separator between two decimals is a split
     point, so both boxes' content can merge into one lat,lng pair. */
  const parsePop = (): [number, number] | null => {
    const nums: number[] = [];
    for (const f of [popLat, popLon]) {
      for (const piece of f.split(/[,\s;|]+/)) {
        if (!piece.trim()) continue;
        const n = Number(piece);
        if (!Number.isFinite(n)) continue;
        nums.push(n);
      }
    }
    /* Swapped or unit-text pastes fail loudly rather than placing land in the
       Gulf of Thailand. */
    if (nums.length < 2) return null;
    const [lat, lon] = nums;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
  };

  const savePop = async () => {
    if (!pop) return;
    const parsed = parsePop();
    if (!parsed) { toast('กรอกพิกัดให้ถูกต้อง', 'warn'); return; }
    const [lat, lon] = parsed;
    /* The server writes the geography the map serves (features read
       ST_Y(p.geom)) and stamps the verdict the data gate needs, so a hand
       coord needs nothing else to appear. */
    const r = await api.patch(`/api/admin/coord-gaps/${pop.id}`, { td_lat: lat, td_lon: lon, td_status: 'resolved' });
    if (!r.ok) { toast(r.error ?? 'บันทึกไม่สำเร็จ', 'warn'); return; }
    toast(`บันทึกพิกัดแล้ว — ${pop.deed_number ?? pop.id}`);
    setPop(null);
    void load();
    refreshParcels();
  };

  /* Edit popup opens on the row it is about, coordinates pre-filled with
     whatever the resolver cascade already has. */
  const openPop = (g: Gap) => {
    setPop(g);
    setPopLat(g.td_lat != null ? String(g.td_lat) : '');
    setPopLon(g.td_lon != null ? String(g.td_lon) : '');
  };

  const num = (v: number | null) => (v == null ? '-' : String(v));
  const size = (g: Gap) => [g.size_rai, g.size_ngan, g.size_wa].some((x) => x != null) ? `${num(g.size_rai)}-${num(g.size_ngan)}-${num(g.size_wa)}` : '-';

  /* Escape closes the edit popup — before the drawer's own handler, same as
     the fullscreen frame above. */
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPop(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pop]);

  /* Paste → editable preview (no server yet): broken lines are dropped, good
     ones wait in a table the admin can still fix by hand. */
  const parseRows = () => {
    const rows = parsePaste(raw);
    setPRows(rows);
    toast(rows.length ? `แปลงได้ ${rows.length} แถว` : 'ไม่เข้าใจบรรทัดใดเลย', rows.length ? undefined : 'warn');
  };

  /* Send the preview to the server for the per-field verdict. */
  const checkRows = async () => {
    if (!pRows.length) return;
    setPBusy(true);
    const r = await api.post<{ results: NonNullable<PRow['verdict']>[] }>('/api/admin/coord-gaps/parse', { rows: pRows });
    setPBusy(false);
    if (!r.ok) { toast(r.error ?? 'ตรวจสอบไม่สำเร็จ', 'warn'); return; }
    setPRows(pRows.map((row, i) => ({ ...row, verdict: r.data!.results[i] ?? null })));
  };

  /* Write every clean row through the existing single-row PATCH. */
  const saveOkRows = async () => {
    const ok = pRows.filter((row) => row.verdict?.ok && row.verdict.parcelId != null);
    if (!ok.length) { toast('ไม่มีแถวที่ผ่านทั้งหมด', 'warn'); return; }
    setPBusy(true);
    let done = 0;
    for (const row of ok) {
      const r = await api.patch(`/api/admin/coord-gaps/${row.verdict!.parcelId}`, {
        td_lat: Number(row.lat), td_lon: Number(row.lon), td_status: 'resolved',
      });
      if (r.ok) done++;
    }
    setPBusy(false);
    if (done) refreshParcels();
    toast(`บันทึกแล้ว ${done}/${ok.length} แถว`);
    setPRows(pRows.filter((row) => !ok.includes(row)));
    void load();
  };

  /* Filtered on the client because the list is already capped at 300 rows, and
     the fields a person searches on - province, district, deed, case - are all
     in the response. Paging it server-side would mean a second round trip for
     every keystroke over a list that fits in memory. */
  const needle = q.trim().toLowerCase();
  const errCount = gaps.filter((g) => g.reviewed_error).length;
  const shown = gaps.filter((g) => {
    /* Reviewed-error rows live behind the chip: hidden by default, shown
       alone when the chip is on — the work list stays about rows an admin
       can still do something with. */
    if (showErr) return !!g.reviewed_error;
    if (g.reviewed_error) return false;
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-dim2">ทั้งหมด</span><span className="font-display">{summary.total}</span>
            <span className="text-dim2">จับคู่แล้ว</span><span className="font-display">{summary.matched} ({(100 *summary.matched/summary.total).toFixed(2)}%)</span>
            {/* <span className="text-dim2">อำเภอไม่ตรง</span><span className="font-display text-warn">{summary.mismatch}</span> */}
            <span className="text-dim2">ไม่มีทั้ง TD และ DOL</span><span className="font-display">{summary.dead_end}</span>
            <span className="text-dim2">ตำบลไม่ตรง</span><span className="font-display text-warn">{summary.wrong_tambon}</span>
            <span className="text-dim2">อำเภอไม่ตรง</span><span className="font-display text-warn">{summary.wrong_district}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-dim2">รอ DOL (โควตาหมด)</span><span className="font-display">{summary.waiting_dol}</span>
            <span className="text-dim2">TD มีหลายแปลง</span><span className="font-display text-warn">{summary.ambiguous}</span>
            <span className="text-dim2">ขนาดไม่ตรง</span><span className="font-display text-err">{summary.wrong_area}</span>
            <span className="text-dim2">ยังไม่ได้ตรวจสอบ</span><span className="font-display">{summary.never_tried}</span>
            <span className="text-dim2">ไม่มีเลขโฉนด</span><span className="font-display">{summary.no_deed}</span>
          </div>
        </div>
      )}

      {/* In fullscreen this row sticks to the top of the frame, so the filter
          the user picked stays visible while three hundred rows scroll under
          it. Full-bleed (-mx/px) so the sticky surface reads as the pane's own
          header bar rather than a floating card. */}
      <div className={`${big
        ? 'sticky top-0 z-[2] -mx-3 bg-panel px-3 pb-2 pt-3'
        : 'mb-2'}`}>
      <div className={'flex flex-wrap items-center gap-1.5 pr-10'}>
        <input
          className={`${inp} min-w-0 flex-1`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา จังหวัด / อำเภอ / เลขโฉนด / คดี…"
        />
        <button className={btn} {...useTipProps(busy ? 'กำลังโหลด…' : 'โหลดใหม่')} onClick={() => void load()} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        </button>
        <button className={btn} {...useTipProps(big ? 'ย่อ' : 'เต็มจอ')} onClick={() => setBig(!big)}>
          {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button className={btn} {...useTipProps('แปะข้อความ')} onClick={() => setPasteOpen(!pasteOpen)} disabled={busy}>
          <ClipboardPaste size={13} />
        </button>
      </div>

      {pasteOpen && (
        <div className="mb-2 rounded-[9px] border border-line2 bg-panel2 p-2">
          <div className="mb-1 text-[10.5px] text-dim2">
            บรรทัดละแปลง: <span className="font-display">เลขโฉนด ไร่-งาน-วา [lat, lng] ตำบล อำเภอ จังหวัด</span>
          </div>
          <textarea
            className={`${inp} h-24 w-full font-mono`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="72956 0-0-32 [12.72002572,99.94910112] ชะอำ ชะอำ เพชรบุรี"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button className={btn} onClick={parseRows} disabled={!raw.trim()}>แปลงข้อความ</button>
            <button className={btn} onClick={() => { setRaw(''); setPRows([]); }} disabled={!raw && !pRows.length}>ล้าง</button>
            {!!pRows.length && (
              <>
                <button className={btn} onClick={() => void checkRows()} disabled={pBusy}>
                  ส่งตรวจ {pRows.length} แถว
                </button>
                <button className={btn} onClick={() => void saveOkRows()} disabled={pBusy}>
                  บันทึกแถวที่ผ่าน
                </button>
              </>
            )}
          </div>

          {!!pRows.length && (
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-b border-line text-left text-dim2">
                  {['เลขโฉนด', 'ร-ง-วา', 'lat', 'lng', 'ตำบล', 'อำเภอ', 'จังหวัด', 'ผลตรวจ'].map((h) => (
                    <th key={h} className="py-1 pr-1.5 font-medium">{h}</th>
                  ))}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {pRows.map((row, i) => (
                  <tr key={i} className="border-b border-line/40 align-top">
                    {(['deed', 'size', 'lat', 'lon', 'tambol', 'amphur', 'city'] as const).map((k) => (
                      <td key={k} className="py-1 pr-1.5">
                        {/* Every cell editable: a mismatch found by the server is
                            often fixed right here, then re-checked. */}
                        <input
                          className={`${inp} ${(k === 'lat' || k === 'lon') ? 'w-24' : k === 'size' ? 'w-20' : 'w-16 min-w-14'} py-0.5`}
                          value={row[k]}
                          onChange={(e) => setPRows(pRows.map((x, j) => (j === i ? { ...x, [k]: e.target.value, verdict: null } : x)))}
                        />
                      </td>
                    ))}
                    <td className="py-1 pr-1.5 text-[10px] whitespace-nowrap">
                      {row.verdict && (row.verdict.ok
                        ? <span className="text-accent">✓ ตรงทุกช่อง</span>
                        : Object.entries(row.verdict.verdict).map(([k, v]) => (
                            <span key={k} className="block text-err">{v}</span>
                          )))}
                    </td>
                    <td className="py-1">
                      <button
                        className="text-dim2 transition hover:text-ink"
                        onClick={() => setPRows(pRows.filter((_, j) => j !== i))}
                      ><X size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        <button
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${only === '' ? 'border-accent text-accent' : 'border-line text-dim2'}`}
          onClick={() => setOnly('')}
        >ทั้งหมด {gaps.length}</button>
        <button
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${showErr ? 'border-err text-err' : 'border-line text-dim2'}`}
          {...useTipProps('ข้อมูลที่ผู้ดูแลตรวจแล้วและระบุว่าเป็นข้อมูลผิดพลาด — ถูกซ่อนจากแผนที่และตาราง')}
          onClick={() => setShowErr(!showErr)}
        >error {errCount}</button>
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
      </div>

      <table className="mt-3 w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-dim2">
            <th className="py-1 pr-2 font-medium">ปัญหา</th>
            <th className="py-1 pr-2 font-medium">จังหวัด / อำเภอ</th>
            <th className="py-1 pr-2 font-medium">เลขโฉนด</th>
            <th className="py-1 pr-2 font-medium">ขนาด (ตร.วา)</th>
            <th className="py-1 pr-2 font-medium">พิกัด (lat, lng)</th>
            <th className="w-[104px]" />
          </tr>
        </thead>
        <tbody>
          {shown.map((g) => {
            const has = g.td_lat != null || g.dol_lat != null;
            const kind = gapKind(g);
            return (
              /* markError review rows tint by the same verdict colour the row
                 already carries; hover highlight is the row's only new
                 affordance, so scanning 300 rows never loses the cursor. */
              <tr key={g.id} className={`${g.reviewed_error ? 'bg-err/5' : ''} hover:bg-panel2 transition-colors border-b border-line/40 align-top`}>
                <td className={`py-1.5 pr-2 text-[10.5px] ${GAP_KIND[kind].cls}`}>
                  {GAP_KIND[kind].th}
                  {g.reviewed_error && <span className="ml-1 text-err">· error</span>}
                  {/* The resolver's own note ("TD has deed …") is what an admin
                      needs while hand-fixing rows, but three hundred wrapped
                      explanations make the normal pane unreadable — so the
                      note shows only in fullscreen. */}
                  {big && g.geo_note && <div className="mt-0.5 text-[10px] leading-[1.4] text-dim2">{g.geo_note}</div>}
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
                <td className="py-1.5 pr-2 font-display whitespace-nowrap">{size(g)}</td>
                <td className="py-1.5 pr-2 font-display whitespace-nowrap">
                  {has && <span>{num(g.td_lat)}, {num(g.td_lon)}</span>}
                  {!has && <span className="text-dim2">-</span>}
                </td>
                <td className="py-1.5 pr-2">
                  <span className="flex justify-end gap-1 whitespace-nowrap">
                    <button className={btn} {...useTipProps('เปิดแผงแก้พิกัด — ข้อมูลที่อ้างอิงของแถวนี้พร้อมช่อง lat, lng')} onClick={() => openPop(g)}>edit</button>
                    <button
                      className={g.reviewed_error ? `${btn} text-err` : btn}
                      {...useTipProps(g.reviewed_error ? 'ยกเลิกการขึ้นสถานะผิดพลาด (แถวกลับเข้ารายการปกติ)' : 'ขึ้นสถานะว่าเป็นข้อมูลผิดพลาด — ซ่อนจากแผนที่และตาราง')}
                      onClick={() => void toggleError(g)}
                    >{g.reviewed_error ? 'un-error' : 'error'}</button>
                  </span>
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

  /* The edit popup — a small fixed card centred in the viewport, portal'd to
   * body so no drawer transform can re-anchor it. Left side is what the
   * reviewer needs to judge the row (gap head, resolver's note, LED district
   * reading, deed, case, size); right side the two coordinate inputs the save
   * writes through the same PATCH the pane has always used. */
  const editPop = createPortal(
    <div data-portal className="fixed inset-0 z-[130]">
      <div className="absolute inset-0 bg-black/30" onClick={() => setPop(null)} />
      {pop && (
        <div data-selectable className="absolute left-1/2 top-1/2 w-[min(94vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line2 bg-panel p-3 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className={`text-[11px] font-medium ${GAP_KIND[gapKind(pop)].cls}`}>{GAP_KIND[gapKind(pop)].th}</div>
              {pop.geo_note && <div className="mt-0.5 text-[10.5px] leading-[1.45] text-dim2">{pop.geo_note}</div>}
            </div>
            <button className="text-dim transition hover:text-ink" onClick={() => setPop(null)}><X size={14} /></button>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
            <dt className="text-dim2">อำเภอ</dt><dd>{pop.district_name ?? pop.district_ref ?? '-'}</dd>
            <dt className="text-dim2">จังหวัด</dt><dd>{pop.province_name ?? '-'}</dd>
            <dt className="text-dim2">เลขโฉนด</dt><dd className="font-display">{pop.deed_number ?? 'ไม่มี'}</dd>
            <dt className="text-dim2">คดี</dt><dd>{pop.case_no ? `${pop.case_no}/${pop.case_year}` : '-'}</dd>
            <dt className="text-dim2">ขนาด</dt><dd className="font-display">{size(pop)}</dd>
          </dl>
          <div className="mt-2.5 flex items-center gap-1">
            <input className={`${inp} w-24 py-1`} placeholder="lat" value={popLat} onChange={(e) => setPopLat(e.target.value)} />
            <input className={`${inp} w-24 py-1`} placeholder="lng" value={popLon} onChange={(e) => setPopLon(e.target.value)} />
            {/* Close the drawer to expose the map, arm ONE click; the click's
                point lands back here through module-scope mapPick when the
                drawer reopens.*/}
            <button
              {...useTipProps('ปิดหน้านี้ชั่วคราว แล้วคลิกบนแผนที่เพื่อวางพิกัด — กลับมาพร้อมพิกัดที่คลิก')}
              className={btn}
              onClick={() => {
                const map = getMap();
                if (!map) { toast('ไม่มีแผนที่ให้คลิก', 'warn'); return; }
                map.once('click', (e) => {
                  mapPick = { gap: pop!, lat: e.lngLat.lat, lng: e.lngLat.lng };
                  patchApp({ settingsOpen: true, setTab: 'gaps' });
                });
                patchApp({ settingsOpen: false });
                toast('คลิกบนแผนที่เพื่อวางพิกัด');
              }}
            ><Crosshair size={13} /> เลือกบนแผนที่</button>
            <button className={btn} onClick={() => void savePop()}>บันทึก</button>
            <button className={btn} onClick={() => setPop(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );

  if (big) {
    return createPortal((
      /* data-portal: the settings drawer's outside-click handler skips
         [data-portal] targets, so a click anywhere in this frame no longer
         closes the drawer that hosts the pane — it used to read as "click
         anything and it all vanished". */
      <div data-portal className="fixed inset-0 z-[120] overflow-y-auto bg-panel p-3" data-selectable>
        <button
          className="fixed right-3 top-3 z-[121] inline-flex size-[31px] cursor-pointer items-center justify-center rounded-lg border border-line2 bg-panel text-dim transition hover:text-ink"
          onClick={() => setBig(false)}
        ><X size={15} /></button>
        {body}
        {pop && editPop}
      </div>
    ), document.body);
  }
  /* data-selectable: the missing-data rows (deed numbers, districts, notes)
     are exactly what an admin copies elsewhere, so the pane opts out of the
     body-wide user-select:none. */
  return <div className="px-3 pb-6" data-selectable>{body}{pop && editPop}</div>;
}