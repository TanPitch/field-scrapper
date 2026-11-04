/* ReportsPane — the admin's queue of parcel reports.
 *
 * Users flag a parcel from its detail panel (ParcelReport.tsx); the rows land
 * here. The badge in the header polls this endpoint every 30 s while someone
 * is signed in as admin, so a fresh report is visible without touching the
 * settings drawer.
 */
import { useCallback, useEffect, useState } from 'react';
import { Flag, MapPin, Check } from 'lucide-react';
import { api } from '../../../lib/api';
import { toast, useApp, patchApp } from '../../../store/useApp';
import { btn } from '../../ui/styles';
import { useTipProps } from '../../ui/Tip';
import { select } from '../../../store/actions';

interface ReportRow {
  id: number; parcel_id: number; topic: string; detail: string; status: string;
  created_at: string; handled_at: string | null;
  reporter: string | null; reporter_name: string | null;
  deed_number: string | null; province: string | null; amphur: string | null;
  case_no: string | null;
}

export interface OpenReports {
  count: number;
  reports: ReportRow[];
}

/** Signed-in admins poll every 30 s; everyone else gets {count:0}. The Header
 *  badge and this pane share the poll so the drawer and the dot cannot
 *  disagree. */
export function useOpenReports(): OpenReports {
  const signedIn = useApp(s => s.signedIn);
  const isAdmin = useApp(s => s.role === 'admin');
  const [reports, setReports] = useState<ReportRow[]>([]);
  useEffect(() => {
    if (!signedIn || !isAdmin) { setReports([]); return; }
    let dead = false;
    const load = async () => {
      const r = await api.get<{ reports: ReportRow[] }>('/api/admin/parcel-reports');
      if (!dead && r.ok) setReports(r.data?.reports ?? []);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { dead = true; clearInterval(t); };
  }, [signedIn, isAdmin]);
  return { count: reports.length, reports };
}

const dt = (s: string): string => {
  const d = new Date(s);
  return `${d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
};

export function ReportsPane() {
  /* Bus, not a store: the pane refetches when the drawer mounts and after
   * handling. The badge picks the count up on its own next tick. */
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [bucket, setBucket] = useState<'open' | 'handled'>('open');  const load = useCallback(async (what: 'open' | 'handled') => {
    setBusy(true);
    const r = await api.get<{ reports: ReportRow[] }>(`/api/admin/parcel-reports?status=${what}`);
    setBusy(false);
    if (r.ok) setRows(r.data?.reports ?? []);
    else toast(r.error ?? 'โหลดรายการไม่สำเร็จ', 'warn');
  }, []);

  useEffect(() => { void load(bucket); }, [bucket, load]);
  /* Selection goes through the app's own select(): panel opens, dot rings,
     map flies — no second way to "go to a parcel". */

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <Flag size={15} className="text-accent" /> รายงานข้อมูลจากผู้ใช้
        <div className="ml-auto flex gap-1">
          {(['open', 'handled'] as const).map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`rounded-md border px-2 py-1 text-[11px] ${bucket === b ? 'border-accent bg-accent-dim text-accent' : 'border-line2 text-dim hover:text-ink'}`}
            >{b === 'open' ? 'ยังไม่จัดการ' : 'จัดการแล้ว'}</button>
          ))}
        </div>
      </div>

      {busy && <div className="text-[11.5px] text-dim2">กำลังโหลด…</div>}
      {!busy && rows.length === 0 && (
        <div className="text-[11.5px] text-dim2">
          {bucket === 'open' ? 'ไม่มีรายงานรอจัดการ' : 'ไม่มีรายการที่จัดการแล้ว'}
        </div>
      )}

      {rows.map(r => (
        <div key={r.id} className="rounded-[10px] border border-line2 bg-panel2 p-2.5 text-[11.5px] leading-[1.6]">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 py-[1px] text-[10px] font-semibold text-accent">{r.topic}</span>
            <span {...useTipProps(r.deed_number ?? undefined)} className="text-dim">
              {r.case_no ?? 'ไม่มีคดี'} {r.deed_number ? `· โฉนด ${r.deed_number}` : ''} {r.province ? `· ${r.province}${r.amphur ? ` ${r.amphur}` : ''}` : ''}
            </span>
            <span className="ml-auto whitespace-nowrap text-[10px] text-dim2">{dt(r.created_at)} · {r.reporter ?? r.reporter_name}</span>
          </div>
          <div className="mt-1 text-ink">{r.detail}</div>
          <div className="mt-2 flex gap-1.5">
            <button
              className={btn}
              {...useTipProps('เลือกแปลงนี้บนแผนที่และเปิดแผงรายละเอียด')}
              onClick={() => {
                patchApp({ settingsOpen: false });
                select(r.parcel_id);
              }}
            ><MapPin size={13} /> เปิดแปลง</button>
            {r.status === 'open' && (
              <button
                className={btn}
                onClick={async () => {
                  const res = await api.post(`/api/admin/parcel-reports/${r.id}/handle`);
                  if (res.ok) { toast('จัดการรายงานแล้ว'); void load('open'); }
                  else toast(res.error ?? 'บันทึกไม่สำเร็จ', 'warn');
                }}
              ><Check size={13} /> จัดการแล้ว</button>
            )}
            {r.handled_at && <span className="ml-auto self-center text-[10px] text-dim2">จัดการ {dt(r.handled_at)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
