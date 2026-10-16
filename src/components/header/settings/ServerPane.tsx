import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type ApiStatus } from '../../../lib/api';
import { frow, fl, setSec } from '../../ui/styles';
import { useTipProps } from '../../ui/Tip';

/** One scraper pass, as /api/status reports it. */
interface Pass {
  id: number;
  stage: string;
  province: string | null;
  startedAt: string | null;
  step: string | null;
  elapsedS: number;
  status: 'running' | 'stuck';
}

const STAGE_TH: Record<string, string> = {
  scrape: 'เก็บข้อมูล LED',
  enrich_td: 'เติมราคาประเมิน กรมธนารักย์',
  enrich_coord: 'เติมพิกัด',
  images: 'ดาวน์โหลดรูปประกาศ',
  reference: 'ข้อมูลอ้างอิง',
  other: 'งานอื่น',
};

const stageTh = (s: string) => STAGE_TH[s] ?? s;

const secs = (n: number) =>
  n < 60 ? `${n}s` : n < 3600 ? `${Math.floor(n / 60)}m${n % 60}s` : `${Math.floor(n / 3600)}h${Math.floor((n % 3600) / 60)}m`;

const hhmm = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Live scraper and API state.
 *
 * This pane used to render static sample rows so the layout could be reviewed.
 * It now reads /api/status, which is backed by scrape_runs — one row per pass,
 * written by the scrapers themselves. So what is on screen is what the bot is
 * genuinely doing, including "stuck", which means a run has been open far longer
 * than any province scrape could plausibly take.
 *
 * It polls rather than subscribes: the API has no socket, the work involved is
 * cheap, and a stale 4-second-old reading is fine for a status page.
 */
export function ServerPane() {
  const [st, setSt] = useState<ApiStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await api.get<ApiStatus>('/api/status');
    if (r.ok && r.data) {
      setSt(r.data);
      setErr(null);
    } else {
      setErr(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => clearInterval(t);
  }, [load]);

  const running: Pass[] = st?.bot.runningPasses ?? [];
  const recent = st?.recent ?? [];
  const td = st?.backlog.td;

  return (
    <>
      <div className={`${setSec} !mt-0.5`}>สถานะระบบและงานของบอท</div>

      {/* connection */}
      <div className={frow}>
        <span className={fl}>เซิร์ฟเวอร์</span>
        {err
          ? <span className="flex items-center gap-1.5 text-[11.5px] text-[#FF8B7D]"><AlertTriangle size={12} />{err}</span>
          : <span className="flex items-center gap-1.5 text-[11.5px] text-[#6BD07C]">
              <CheckCircle2 size={12} />
              {loading ? 'กำลังตรวจสอบ…' : 'เชื่อมต่อแล้ว'}
            </span>}
      </div>

      <div className={frow}>
        <span className={fl}>บอทกำลังทำงาน</span>
        <span className="flex items-center gap-2">
          {running.length > 0 && <Loader2 size={12} className="animate-spin text-accent" />}
          <b className="font-display text-[12px] font-semibold" style={{ color: running.length ? 'var(--accent)' : 'var(--dim2)' }}>
            {running.length ? `${running.length} งาน` : 'ว่าง'}
          </b>
        </span>
      </div>

      {st && (
        <>
          <div className={frow}>
            <span className={fl}>งานทั้งหมดที่รัน</span>
            <b className="text-[11.5px] font-medium font-display">{st.bot.totalRuns}</b>
          </div>
          <div className={frow}>
            <span className={fl}>รอบล่าสุด</span>
            <b className="text-[11.5px] font-medium font-display">{hhmm(st.bot.lastRun)}</b>
          </div>
          <div className={frow}>
            <span className={fl}>งานที่ค้าง / ล้มเหลว</span>
            <b className="text-[11.5px] font-medium font-display" style={{ color: st.bot.unfinishedRuns || st.bot.failedRuns ? '#E5484D' : undefined }}>
              {st.bot.unfinishedRuns} / {st.bot.failedRuns}
            </b>
          </div>
        </>
      )}

      {/* running passes */}
      {running.length > 0 && (
        <>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[.1em] text-dim">กำลังทำงาน</div>
          {running.map(p => (
            <div key={p.id} className="mt-1 rounded-[8px] border border-line bg-bg px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11.5px]">
                {p.status === 'stuck'
                  ? <AlertTriangle size={12} className="flex-none text-[#E5484D]" />
                  : <Loader2 size={12} className="flex-none animate-spin text-accent" />}
                <b className="font-semibold">{stageTh(p.stage)}</b>
                <span className="text-dim2">· {p.province ?? 'ทั้งประเทศ'}</span>
                <span className="ml-auto font-display text-[10.5px] text-dim2">{secs(p.elapsedS)}</span>
              </div>
              <div className="mt-0.5 truncate font-display text-[10.5px] text-dim">
                {p.step ?? '—'}
                {p.status === 'stuck' && (
                  <span {...useTipProps('งานนี้ค้างนานผิดปกติ — อาจถูกหยุดกลางคัน ดูคำสั่ง bun runs.js reap')} className="ml-1.5 text-[#E5484D]">
                    ค้างผิดปกติ
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* enrichment backlog */}
      {td && (
        <>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-[.1em] text-dim">คิวเติมข้อมูล กรมธนารักย์</div>
          <div className={frow}>
            <span className={fl}>เติมแล้ว</span>
            <b className="text-[11.5px] font-medium font-display">{td.enriched}</b>
          </div>
          <div className={frow}>
            <span className={fl}>ยังไม่พบข้อมูล</span>
            <b className="text-[11.5px] font-medium font-display" style={{ color: td.unresolved ? '#FF9F43' : undefined }}>{td.unresolved}</b>
          </div>
          <div className={frow}>
            <span className={fl}>ไม่มีในชั้นข้อมูล (ข้าม)</span>
            <b className="text-[11.5px] font-medium font-display text-dim2">{td.skipped}</b>
          </div>
          <div className={frow}>
            <span className={fl}>ยังไม่ได้ตรวจ</span>
            <b className="text-[11.5px] font-medium font-display text-dim2">{td.neverTried}</b>
          </div>
        </>
      )}

      {/* recent history */}
      <div className="mt-3 text-[10px] font-semibold uppercase tracking-[.1em] text-dim">ประวัติงานล่าสุด</div>
      {recent.length === 0 ? (
        <div className="py-2 text-[10.5px] text-dim2">
          {loading ? 'กำลังโหลด…' : 'ยังไม่มีประวัติการทำงาน — ลองรัน cd test; bun scrapeLED.js'}
        </div>
      ) : (
        /* Capped: 27 runs already, and the list grows forever. Scroll rather
           * than paginate - the newest is what anyone reads, and it stays at top. */
        <div className="max-h-56 overflow-y-auto pr-1">
        {recent.map(r => (
        <div key={r.id} className={`${frow} !border-b-0`}>
          <span className={fl}>
            {r.outcome === 'failed'
              ? <CircleDashed size={11} className="mr-1 inline text-[#FF8B7D]" />
              : <CheckCircle2 size={11} className="mr-1 inline text-[#6BD07C]" />}
            {stageTh(r.stage)}
            {r.province ? ` · ${r.province}` : ''}
            {r.notes ? <span className="ml-1 text-[10px] text-dim2">{r.notes}</span> : null}
          </span>
          <span className="flex items-center gap-2 font-display text-[10.5px] text-dim2">
            {r.lotsSeen != null && <span>{r.lotsSeen} แปลง</span>}
            {r.lotsNew != null && r.lotsNew !== r.lotsSeen && <span>ใหม่ {r.lotsNew}</span>}
            {r.errors > 0 && (
              <span className="text-[#FF8B7D]">พลาด {r.errors}</span>
            )}
            {r.lastStep && <span className="max-w-52 truncate">{r.lastStep}</span>}
            <span>{secs(r.durationS)}</span>
            <span>{hhmm(r.finishedAt)}</span>
          </span>
        </div>
        ))}
        </div>
      )}

      <div className="mt-2.5 flex items-start gap-1.5 text-[10.5px] leading-[1.6] text-dim2">
        <Play size={11} className="mt-[2px] flex-none" />
        <span>
          ข้อมูลนี้มาจากตาราง <b className="font-display">scrape_runs</b> ที่บอทเขียนเองระหว่างทำงาน —
          งานที่ <b className="font-display">finished_at</b> ยังว่าง แปลว่ากำลังทำอยู่
          ถ้าบอทถูกปิดกลางคัน แถวนั้นจะค้าง รัน <b className="font-display">bun runs.js reap</b> เพื่อปิด
        </span>
      </div>
    </>
  );
}
